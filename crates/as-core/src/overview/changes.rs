//! What each agent changed in its working folder: diff size, untracked files, commits not pushed
//! and the state of its pull request (the Overview's "Ready for review" facts).
//!
//! Reading them means running `git` (and `gh`), which the 2 s Overview poll must never wait for.
//! [`ChangesCache`] therefore only hands out the last value it has and, when that is old, starts a
//! background job that fills it for a later poll. Git facts are re-read at most every 45 s, or
//! sooner (after a short debounce) when the agent's status changed, since that is when its work
//! tends to change. The pull request state, which needs the network, at most every 5 minutes.
//! At most [`MAX_CONCURRENT_JOBS`] jobs run at once; the rest wait for the next poll.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::Value;

use super::types::{AgentChanges, OverviewStatus, PrState, PrSummary};
use crate::git::{GitDiffStats, GitRunner, GitStatus};

/// Git facts are re-read at most this often.
pub const GIT_REFRESH_MS: i64 = 45_000;
/// A status change brings the next read forward, but not closer than this to the previous one.
pub const STATUS_DEBOUNCE_MS: i64 = 5_000;
/// The pull request state is re-read at most this often.
pub const PR_REFRESH_MS: i64 = 5 * 60_000;
/// Background reads running at the same time.
pub const MAX_CONCURRENT_JOBS: usize = 2;
/// Timeout of one `gh` call.
const GH_TIMEOUT: Duration = Duration::from_secs(10);

/// Combines `git status` and `git diff --numstat` results. `None` when the folder is no repository.
pub fn facts_from(status: &GitStatus, stats: &GitDiffStats) -> Option<AgentChanges> {
    if !status.is_repo {
        return None;
    }
    let untracked = status.files.iter().filter(|f| f.untracked).count();
    let has_upstream = status.upstream.is_some();
    Some(AgentChanges {
        added: stats.additions,
        removed: stats.deletions,
        files: stats.files,
        untracked: u32::try_from(untracked).unwrap_or(u32::MAX),
        ahead: has_upstream.then_some(status.ahead),
        behind: has_upstream.then_some(status.behind),
        pr: None,
    })
}

/// Tolerant parse of `gh pr view --json number,state,isDraft,url`. `None` for anything else.
pub fn parse_pr_summary(json: &str) -> Option<PrSummary> {
    let v: Value = serde_json::from_str(json).ok()?;
    let number = u32::try_from(v.get("number")?.as_u64()?).ok()?;
    let url = v.get("url")?.as_str()?.trim();
    if url.is_empty() {
        return None;
    }
    let draft = v.get("isDraft").and_then(Value::as_bool).unwrap_or(false);
    let state = match v.get("state")?.as_str()?.to_ascii_uppercase().as_str() {
        "OPEN" if draft => PrState::Draft,
        "OPEN" => PrState::Open,
        "MERGED" => PrState::Merged,
        "CLOSED" => PrState::Closed,
        _ => return None,
    };
    Some(PrSummary {
        number,
        state,
        url: url.to_string(),
    })
}

/// Reads the git facts of a folder (injectable for tests). `None` when it is no repository.
pub type ChangesReader = Arc<dyn Fn(&Path) -> Option<AgentChanges> + Send + Sync>;
/// Reads the pull request of a folder's branch (injectable for tests). `None` when there is none
/// or it cannot be told.
pub type PrReader = Arc<dyn Fn(&Path) -> Option<PrSummary> + Send + Sync>;
/// A background read.
pub type Job = Box<dyn FnOnce() + Send>;
/// Runs a background job (a thread in production, inline in tests).
pub type JobSpawner = Arc<dyn Fn(Job) + Send + Sync>;

/// The real git reader.
pub fn read_changes(dir: &Path) -> Option<AgentChanges> {
    let runner = GitRunner::new();
    let status = runner.status(dir).ok()?;
    if !status.is_repo {
        return None;
    }
    let stats = runner.diff_stats(dir).ok()?;
    facts_from(&status, &stats)
}

/// Whether the GitHub CLI is on `PATH`; looked up once.
fn gh_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| which::which("gh").is_ok())
}

/// The real pull request reader: `gh pr view` in the folder, nothing when `gh` is missing, not
/// signed in, or the branch has no pull request.
pub fn read_pr(dir: &Path) -> Option<PrSummary> {
    if !gh_available() {
        return None;
    }
    let runner = GitRunner::new().with_timeout(GH_TIMEOUT);
    let out = runner
        .gh(
            dir,
            &["pr", "view", "--json", "number,state,isDraft,url"].map(std::ffi::OsString::from),
        )
        .ok()?;
    parse_pr_summary(&out)
}

fn spawn_thread(job: Job) {
    let spawned = std::thread::Builder::new()
        .name("overview-changes".into())
        .spawn(job);
    if let Err(e) = spawned {
        tracing::warn!(error = %e, "could not start the changes reader");
    }
}

#[derive(Default)]
struct Entry {
    changes: Option<AgentChanges>,
    pr: Option<PrSummary>,
    git_at: Option<i64>,
    pr_at: Option<i64>,
    /// Last status of each agent working in this folder (several agents can share one).
    statuses: HashMap<String, OverviewStatus>,
    /// An agent's status changed since the last read started.
    dirty: bool,
    in_flight: bool,
}

impl Entry {
    fn value(&self) -> Option<AgentChanges> {
        self.changes.clone().map(|mut c| {
            c.pr = self.pr.clone();
            c
        })
    }
}

/// Frees the job slot when the job ends, also when it panics.
struct Slot(Arc<AtomicUsize>);
impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

type Entries = Arc<Mutex<HashMap<String, Entry>>>;

/// Clears the folder's `in_flight` flag when the job ends, also when it panics or never runs
/// (a thread that could not be started drops the job unrun).
struct InFlight {
    entries: Entries,
    dir: String,
}
impl Drop for InFlight {
    fn drop(&mut self) {
        if let Some(entry) = self.entries.lock().get_mut(&self.dir) {
            entry.in_flight = false;
        }
    }
}

/// Per working folder: the last [`AgentChanges`], refreshed in the background.
pub struct ChangesCache {
    entries: Entries,
    running: Arc<AtomicUsize>,
    read: ChangesReader,
    read_pr: PrReader,
    spawn: JobSpawner,
}

impl Default for ChangesCache {
    fn default() -> Self {
        Self::new(
            Arc::new(read_changes),
            Arc::new(read_pr),
            Arc::new(spawn_thread),
        )
    }
}

impl ChangesCache {
    pub fn new(read: ChangesReader, read_pr: PrReader, spawn: JobSpawner) -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(AtomicUsize::new(0)),
            read,
            read_pr,
            spawn,
        }
    }

    /// The last known changes of `dir`, never waiting for git. Starts a background read when the
    /// value is old, the status of agent `agent_id` changed, or nothing was read yet.
    pub fn get(
        &mut self,
        dir: &str,
        agent_id: &str,
        status: OverviewStatus,
        now: i64,
    ) -> Option<AgentChanges> {
        if dir.is_empty() {
            return None;
        }
        let mut entries = self.entries.lock();
        let entry = entries.entry(dir.to_string()).or_default();
        if let Some(prev) = entry.statuses.insert(agent_id.to_string(), status)
            && prev != status
        {
            entry.dirty = true;
        }
        let due = match entry.git_at {
            None => true,
            Some(at) => {
                now - at >= GIT_REFRESH_MS || (entry.dirty && now - at >= STATUS_DEBOUNCE_MS)
            }
        };
        let mut job = None;
        if due && !entry.in_flight && self.try_take_slot() {
            entry.in_flight = true;
            entry.dirty = false;
            job = Some(entry.pr_at.is_none_or(|at| now - at >= PR_REFRESH_MS));
        }
        let value = entry.value();
        drop(entries); // the spawner may run the job right here
        if let Some(with_pr) = job {
            self.start(dir.to_string(), with_pr, now);
        }
        value
    }

    fn try_take_slot(&self) -> bool {
        // Only the polling thread takes slots, so taking and giving back cannot race with another taker.
        if self.running.fetch_add(1, Ordering::SeqCst) < MAX_CONCURRENT_JOBS {
            return true;
        }
        self.running.fetch_sub(1, Ordering::SeqCst);
        false
    }

    fn start(&self, dir: String, with_pr: bool, now: i64) {
        let slot = Slot(self.running.clone());
        let in_flight = InFlight {
            entries: self.entries.clone(),
            dir: dir.clone(),
        };
        let entries = self.entries.clone();
        let (read, read_pr) = (self.read.clone(), self.read_pr.clone());
        (self.spawn)(Box::new(move || {
            let _slot = slot;
            let _in_flight = in_flight;
            let path = Path::new(&dir);
            let changes = read(path);
            // No pull request lookup for a folder that is no repository.
            let pr = (with_pr && changes.is_some()).then(|| read_pr(path));
            let mut entries = entries.lock();
            let Some(entry) = entries.get_mut(&dir) else {
                return; // dropped by `retain` meanwhile
            };
            entry.git_at = Some(now);
            entry.changes = changes;
            if let Some(pr) = pr {
                entry.pr = pr;
                entry.pr_at = Some(now);
            } else if entry.changes.is_none() {
                entry.pr = None;
            }
        }));
    }

    /// Drops the folders not in `dirs`.
    pub fn retain<'a>(&mut self, dirs: impl IntoIterator<Item = &'a str>) {
        let keep: std::collections::HashSet<&str> = dirs.into_iter().collect();
        self.entries.lock().retain(|d, _| keep.contains(d.as_str()));
    }
}

#[cfg(test)]
mod tests;
