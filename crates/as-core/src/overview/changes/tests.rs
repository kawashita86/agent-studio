use std::sync::atomic::AtomicI64;

use super::*;
use crate::git::GitFileStatus;
use crate::git::GitStatusKind;

fn file(untracked: bool) -> GitFileStatus {
    GitFileStatus {
        path: "a".into(),
        orig_path: None,
        kind: GitStatusKind::Modified,
        index: None,
        worktree: None,
        staged: false,
        unstaged: !untracked,
        untracked,
        conflicted: false,
    }
}

#[test]
fn facts_combine_status_and_stats() {
    let status = GitStatus {
        is_repo: true,
        upstream: Some("origin/x".into()),
        ahead: 2,
        behind: 1,
        files: vec![file(true), file(false), file(true)],
        ..GitStatus::default()
    };
    let stats = GitDiffStats {
        files: 6,
        additions: 142,
        deletions: 37,
    };
    assert_eq!(
        facts_from(&status, &stats),
        Some(AgentChanges {
            added: 142,
            removed: 37,
            files: 6,
            untracked: 2,
            ahead: Some(2),
            behind: Some(1),
            pr: None
        })
    );
}

#[test]
fn no_upstream_means_no_ahead_and_a_non_repo_means_nothing() {
    let status = GitStatus {
        is_repo: true,
        ahead: 5,
        ..GitStatus::default()
    };
    let facts = facts_from(&status, &GitDiffStats::default()).unwrap();
    assert_eq!((facts.ahead, facts.behind), (None, None));
    assert_eq!(
        facts_from(&GitStatus::default(), &GitDiffStats::default()),
        None
    );
}

#[test]
fn parses_pr_states() {
    let pr = |json: &str| parse_pr_summary(json).map(|p| (p.number, p.state, p.url));
    let url = "https://github.com/o/r/pull/31";
    let json = |state: &str, draft: bool| {
        format!(r#"{{"number":31,"state":"{state}","isDraft":{draft},"url":"{url}"}}"#)
    };
    assert_eq!(
        pr(&json("OPEN", false)),
        Some((31, PrState::Open, url.into()))
    );
    assert_eq!(
        pr(&json("OPEN", true)),
        Some((31, PrState::Draft, url.into()))
    );
    assert_eq!(
        pr(&json("MERGED", false)),
        Some((31, PrState::Merged, url.into()))
    );
    assert_eq!(
        pr(&json("closed", false)),
        Some((31, PrState::Closed, url.into()))
    );
    // isDraft missing: not a draft.
    assert_eq!(
        pr(r#"{"number":4,"state":"OPEN","url":"u"}"#),
        Some((4, PrState::Open, "u".into()))
    );
}

#[test]
fn garbage_pr_output_gives_none() {
    for text in [
        "",
        "no pull requests found for branch \"x\"",
        "[]",
        "null",
        r#"{"number":"x","state":"OPEN","url":"u"}"#,
        r#"{"number":1,"state":"WEIRD","url":"u"}"#,
        r#"{"number":1,"state":"OPEN"}"#,
        r#"{"number":1,"state":"OPEN","url":" "}"#,
        r#"{"number":99999999999,"state":"OPEN","url":"u"}"#,
    ] {
        assert_eq!(parse_pr_summary(text), None, "{text}");
    }
}

#[test]
fn serializes_camel_case_and_skips_empty_options() {
    let json = serde_json::to_value(AgentChanges {
        added: 1,
        files: 1,
        ..AgentChanges::default()
    })
    .unwrap();
    assert_eq!(
        json,
        serde_json::json!({"added":1,"removed":0,"files":1,"untracked":0})
    );
    let old: AgentChanges = serde_json::from_value(json).unwrap();
    assert_eq!(old.ahead, None);
}

type Queue = Arc<Mutex<Vec<Job>>>;

struct Rig {
    cache: ChangesCache,
    git_calls: Arc<AtomicUsize>,
    pr_calls: Arc<AtomicUsize>,
    /// Jobs not run yet (the deferred spawner).
    queue: Queue,
    added: Arc<AtomicI64>,
}

fn rig(deferred: bool) -> Rig {
    let git_calls = Arc::new(AtomicUsize::new(0));
    let pr_calls = Arc::new(AtomicUsize::new(0));
    let added = Arc::new(AtomicI64::new(10));
    let queue: Queue = Arc::new(Mutex::new(Vec::new()));
    let (g, a) = (git_calls.clone(), added.clone());
    let read: ChangesReader = Arc::new(move |dir| {
        g.fetch_add(1, Ordering::SeqCst);
        (dir != "/not-a-repo").then(|| AgentChanges {
            added: u32::try_from(a.load(Ordering::SeqCst)).unwrap(),
            files: 1,
            ..AgentChanges::default()
        })
    });
    let p = pr_calls.clone();
    let read_pr: PrReader = Arc::new(move |_| {
        p.fetch_add(1, Ordering::SeqCst);
        Some(PrSummary {
            number: 7,
            state: PrState::Open,
            url: "u".into(),
        })
    });
    let q = queue.clone();
    let spawn: JobSpawner = Arc::new(move |job| {
        if deferred {
            q.lock().push(job);
        } else {
            job();
        }
    });
    Rig {
        cache: ChangesCache::new(read, read_pr, spawn),
        git_calls,
        pr_calls,
        queue,
        added,
    }
}

fn run_queue(q: &Queue) {
    let jobs: Vec<_> = q.lock().drain(..).collect();
    for j in jobs {
        j();
    }
}

use OverviewStatus as S;

#[test]
fn first_get_returns_nothing_and_the_value_arrives_later() {
    let mut r = rig(true);
    assert_eq!(r.cache.get("/a", "a1", S::Idle, 0), None);
    assert_eq!(
        r.git_calls.load(Ordering::SeqCst),
        0,
        "not read on the caller's path"
    );
    run_queue(&r.queue);
    let got = r.cache.get("/a", "a1", S::Idle, 1_000).unwrap();
    assert_eq!(got.added, 10);
    assert_eq!(got.pr.map(|p| p.number), Some(7));
}

#[test]
fn refreshes_git_every_45_s_and_the_pr_every_5_min() {
    let mut r = rig(false);
    r.cache.get("/a", "a1", S::Idle, 0);
    r.cache.get("/a", "a1", S::Idle, 44_000);
    assert_eq!(r.git_calls.load(Ordering::SeqCst), 1);
    r.added.store(20, Ordering::SeqCst);
    r.cache.get("/a", "a1", S::Idle, 45_000); // starts the second read
    assert_eq!(r.git_calls.load(Ordering::SeqCst), 2);
    assert_eq!(r.cache.get("/a", "a1", S::Idle, 45_001).unwrap().added, 20);
    assert_eq!(r.pr_calls.load(Ordering::SeqCst), 1);
    r.cache.get("/a", "a1", S::Idle, 90_000);
    assert_eq!(r.pr_calls.load(Ordering::SeqCst), 1);
    r.cache.get("/a", "a1", S::Idle, 300_000);
    assert_eq!(r.pr_calls.load(Ordering::SeqCst), 2);
}

#[test]
fn a_status_change_refreshes_early_but_debounced() {
    let mut r = rig(false);
    r.cache.get("/a", "a1", S::Working, 0);
    r.cache.get("/a", "a1", S::Idle, 2_000); // changed, but only 2 s after the read
    assert_eq!(r.git_calls.load(Ordering::SeqCst), 1);
    r.cache.get("/a", "a1", S::Idle, 5_000); // debounce over
    assert_eq!(r.git_calls.load(Ordering::SeqCst), 2);
    r.cache.get("/a", "a1", S::Idle, 12_000); // no new change: waits for 45 s
    assert_eq!(r.git_calls.load(Ordering::SeqCst), 2);
}

#[test]
fn does_not_start_a_second_read_of_the_same_folder_while_one_runs() {
    let mut r = rig(true);
    for t in 0..5 {
        r.cache.get("/a", "a1", S::Idle, t * 100);
    }
    assert_eq!(r.queue.lock().len(), 1);
}

#[test]
fn caps_concurrent_reads_and_picks_the_rest_up_later() {
    let mut r = rig(true);
    for dir in ["/a", "/b", "/c"] {
        r.cache.get(dir, "a1", S::Idle, 0);
    }
    assert_eq!(r.queue.lock().len(), MAX_CONCURRENT_JOBS);
    run_queue(&r.queue);
    r.cache.get("/c", "a1", S::Idle, 2_000);
    assert_eq!(r.queue.lock().len(), 1);
}

#[test]
fn non_repositories_and_empty_dirs_give_nothing_and_skip_the_pr_lookup() {
    let mut r = rig(false);
    assert_eq!(r.cache.get("", "a1", S::Idle, 0), None);
    assert_eq!(r.cache.get("/not-a-repo", "a1", S::Idle, 0), None);
    assert_eq!(r.cache.get("/not-a-repo", "a1", S::Idle, 1), None);
    assert_eq!(r.git_calls.load(Ordering::SeqCst), 1);
    assert_eq!(r.pr_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn retain_drops_folders_and_a_late_job_does_not_revive_them() {
    let mut r = rig(true);
    r.cache.get("/a", "a1", S::Idle, 0);
    r.cache.retain(["/b"]);
    run_queue(&r.queue);
    assert!(r.entries_empty());
}

impl Rig {
    fn entries_empty(&self) -> bool {
        self.cache.entries.lock().is_empty()
    }
}

#[test]
fn reads_a_real_repository() {
    let git = |dir: &Path, args: &[&str]| {
        std::process::Command::new("git")
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(dir)
            .status()
            .is_ok_and(|s| s.success())
    };
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    if !git(dir, &["init", "-q"]) {
        return; // no git on this machine
    }
    std::fs::write(dir.join("a.txt"), "one\n").unwrap();
    assert!(git(dir, &["add", "."]));
    assert!(git(dir, &["commit", "-q", "-m", "init"]));
    assert_eq!(
        read_changes(dir),
        Some(AgentChanges::default()),
        "clean, no upstream"
    );
    std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
    std::fs::write(dir.join("b.txt"), "x\ny\n").unwrap();
    let c = read_changes(dir).unwrap();
    assert_eq!((c.added, c.removed, c.files, c.untracked), (3, 0, 2, 1));
    assert_eq!((c.ahead, c.pr), (None, None));
    assert_eq!(read_changes(&tmp.path().join("missing")), None);
}

#[test]
fn agents_sharing_a_folder_do_not_count_as_status_changes() {
    let mut r = rig(false);
    r.cache.get("/a", "a1", S::Working, 0);
    r.cache.get("/a", "a2", S::Idle, 0);
    for t in 1..=8 {
        r.cache.get("/a", "a1", S::Working, t * 5_000);
        r.cache.get("/a", "a2", S::Idle, t * 5_000);
    }
    assert_eq!(r.git_calls.load(Ordering::SeqCst), 1);
}

#[test]
fn a_job_that_never_runs_does_not_block_the_folder() {
    let mut r = rig(true);
    r.cache.get("/a", "a1", S::Idle, 0);
    r.queue.lock().clear(); // the thread could not be started: the job is dropped unrun
    r.cache.get("/a", "a1", S::Idle, 45_000);
    run_queue(&r.queue);
    assert_eq!(r.git_calls.load(Ordering::SeqCst), 1);
    assert!(r.cache.get("/a", "a1", S::Idle, 45_001).is_some());
}
