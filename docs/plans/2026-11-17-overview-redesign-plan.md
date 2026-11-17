# Overview redesign plan (2026-11-17)

The Overview tab came from agent-lookout with two jobs: show the agents that **need you**, and be the
one place for useful cross-agent data. A UX review (2026-11-17) found it does the second at the
expense of the first: on a 1366×768 screen the waiting agent is entirely below the fold, behind four
count tiles and a ~360px usage card. All nine proposed changes were approved, with **layout A
("Inbox first")**: one column, read top to bottom.

## Target layout (A · Inbox first)

```
Overview                        [5h ▓▓░ 42%] [week ▓▓▓░ 78%] 1.4M tokens today   [All projects ▾]
[● 2 Needs you] [● 3 Working] [● 4 Idle · 1 stale] [● 5 Finished] [● 1 Failed]      ← status strip
┌ Needs you (2) ─────────────────────────────────── J/K move · ↵ jump · D details ┐
│ codex-review  Permission  $ cargo test --workspace     11m 40s  [Allow][Deny][Jump] │
│ ask-test      Question    Should the retry limit be 3 or 5?   2m 11s        [Jump] │
└──────────────────────────────────────────────────────────────────────────────┘
┌ Since you were away · since 14:02 ──────────────────────────────── All events → ┐
│ 3 finished │ 1 failed │ 2 waits answered (14m) │ 1.2M tokens                     │
└──────────────────────────────────────────────────────────────────────────────┘
┌ Sessions                                              [Status|Repos|Board] ┐
│ READY FOR REVIEW · fix-flaky-tests  +142 −37 · 6 files  PR #31 open        │
│ WORKING · refactor-parser  +310 −122  18m                                   │
└─────────────────────────────────────────────────────────────────────────────┘
┌ Activity                                     [Last hour|Timeline|Waits] ┐
└──────────────────────────────────────────────────────────────────────────┘
```

## Approved changes

| Id | Change | Size |
|----|--------|------|
| P1 | Needs you first, full width, height fits its items; when clear, a one-line "Nothing needs you · last wait …" | S |
| P2 | Status strip (Needs you · Working · Idle incl. stale · Finished · Failed) replaces the 4 tiles and the header summary; a chip filters Sessions; history chart behind an icon on the chip | S–M |
| P3 | Usage becomes a one-line limits bar in the top bar (limit bars + today's tokens + "Usage report"); hidden when there is nothing to show | S |
| P4 | One "Activity" card with tabs: Last hour · Timeline · Waits (the Waited-on-you strip moves into Waits) | M |
| P5 | "Since you were away" digest built on the existing new-since marker; the raw log stays behind "All events" | M |
| P6 | Keyboard triage in Needs you (J/K, Enter jump, D details), full question/command on the selected item, snooze 15 min | S–M |
| P7 | Allow / Deny permission prompts from the Overview (types into the agent PTY) — **after a read-only spike** | L |
| P8 | Diff stats, ahead/behind and PR state per agent; "Ready for review" group in Sessions | L |
| P9 | Visible chart icon buttons instead of dotted-underline titles | S |

## Steps (one commit per step on `feat/overview-inbox`; a single PR once all steps are done)

### Step 1 — Inbox-first skeleton (P1, P2, P3, P9) — front end only
- `OverviewView`: new order top bar → status strip → Needs you → Sessions → existing cards (Activity
  arrives in step 2). Grid areas in `OverviewView.module.css`; Needs you no longer shares a row.
- `CountsRow` → status strip (`StatusStrip`): chips for needsYou, working, idle (stale count inside),
  finished, failed (+ not running when > 0). Clicking a chip toggles a status filter on `SessionsCard`
  (a "needs you" chip scrolls/focuses the Needs you card). Each chip with history (`CountKey`) gets a
  small chart icon button that opens `CountHistory` (P9). Remove the header summary text.
- `NeedsYouPanel` all-clear state: compact one line, keeps "last wait".
- `UsageCard` → compact `LimitsBar` in the top bar: up to N limit bars from `buildLimitTiles`, today's
  tokens, link to the Usage report; renders nothing when no tiles and no tokens. The weekly chart stays
  only in the Usage dashboard.
- Card titles stop being buttons (P9); history opens from icon buttons with a tooltip.
- Tests: update `OverviewView`, `CountsRow`, `UsageCard`, `NeedsYouPanel` tests; new strip/filter tests.

### Step 2 — Activity, digest, triage (P4, P5, P6) — front end only
- `ActivityCard` with tabs (persisted choice): Last hour (`LastHourChart`), Timeline (`TimelineCard`
  body), Waits (`WaitsCard` body + `WaitedOnYou`). Remove the separate cards.
- `SinceAwayCard`: counts finished / failed / waits answered (+ total wait) / tokens since `lastSeen`
  (from `newSince`), each count opens the matching agents; "All events" expands the existing log.
- Needs you keyboard: roving selection, J/K/↑/↓, Enter = jump, D = details, S = snooze 15 min
  (front-end, keyed by agentId + statusSince so a new wait is never hidden). Selected item shows the
  full waiting text.

### Step 3 — Changes and review state (P8) — daemon + protocol + UI
- `as-core`: per-agent git facts for its working dir (`git diff --shortstat`, untracked count,
  ahead/behind upstream) by shelling out to `git`; PR state via `gh pr view --json` when `gh` is
  available. Cached, refreshed every 30–60 s and on status change, never blocking the snapshot.
- `as-proto`: optional fields on `OverviewSession` (regenerate TS bindings).
- UI: diff column in session rows; "Ready for review" group = idle/finished agents with uncommitted or
  unpushed changes or an open PR.

### Step 4 — Allow / Deny (P7) — done for Claude Code only
Decided scope: Claude Code agents. Codex and OpenCode keep Jump only. Implemented as
`as-core::overview::permission_prompt` (screen replay with `vt100`), `AgentManager::{permission_prompt,
answer_permission}`, `OverviewSession.permissionPrompt`, `Request::AnswerPermission`, Allow / Deny in
`NeedsYouPanel`. Prompt shapes: `docs/AGENTLOG.md` (2026-11-17, Claude permission dialog).
Original plan:
- **Spike first (read-only):** detect permission prompts per provider (Claude Code, Codex, OpenCode)
  from the PTY screen, and show which key would be sent without sending it. Document per-version
  prompt shapes in `docs/AGENTLOG.md`.
- Then: daemon request `answer_permission { agentId, allow }` that re-checks the prompt is still on
  screen before writing; UI buttons only when detection is confident; otherwise Jump only.

## Done when
Each step: front-end checks, `cargo fmt --check`, clippy `-D warnings`, `cargo test --workspace` green
locally, `docs/porting-map.md` updated where Overview modules change. The single PR at the end: CI green
on 3 OSes.
