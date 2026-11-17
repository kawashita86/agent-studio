use super::*;

const POSITIVE: &[u8] = include_bytes!("fixtures/claude-2.1.326-bash-permission.bin");
const AFTER_ALLOW: &[u8] = include_bytes!("fixtures/claude-2.1.326-after-allow.bin");
const IDLE: &[u8] = include_bytes!("fixtures/claude-2.1.326-idle-prompt.bin");

fn rows(text: &str) -> Vec<String> {
    text.lines().map(str::to_string).collect()
}

#[test]
fn detects_the_bash_dialog_of_a_real_session() {
    let p = detect_in_output(POSITIVE, 120, 40).expect("prompt");
    assert_eq!(p.question, "Do you want to proceed?");
    assert_eq!(
        p.options,
        vec![(1, "Yes".to_string()), (2, "No".to_string())]
    );
    assert_eq!(p.allow_key, 1);
    let summary = p.summary.expect("summary");
    assert!(summary.starts_with("Bash command\nCreate demo-dir2 directory and echo made\n"));
    assert!(summary.contains("mkdir demo-dir2 && echo made"));
    assert_eq!(summary.lines().count(), 3);
    assert_eq!(p.id.len(), 16);
}

#[test]
fn the_id_is_stable_and_follows_the_content() {
    let a = detect_in_output(POSITIVE, 120, 40).unwrap();
    let b = detect_in_output(POSITIVE, 120, 40).unwrap();
    assert_eq!(a.id, b.id);
    let other =
        rows("Bash command\nrm -rf x\nDo you want to proceed?\n❯ 1. Yes\n  2. No\nEsc to cancel");
    assert_ne!(detect_in_rows(&other).unwrap().id, a.id);
}

#[test]
fn a_tail_of_the_buffer_is_enough_when_it_holds_the_last_paint() {
    // The fixture is small; replaying all of it equals replaying its tail window.
    let tail = &POSITIVE[POSITIVE.len().saturating_sub(RENDER_TAIL_BYTES)..];
    assert_eq!(
        detect_in_output(tail, 120, 40),
        detect_in_output(POSITIVE, 120, 40)
    );
}

#[test]
fn no_prompt_after_the_dialog_was_answered() {
    assert_eq!(detect_in_output(AFTER_ALLOW, 120, 40), None);
}

#[test]
fn the_trust_dialog_and_the_idle_prompt_are_not_permission_prompts() {
    assert_eq!(detect_in_output(IDLE, 120, 40), None);
    let trust = rows(
        "Do you trust the files in this folder?\n❯ 1. Yes, I trust this folder\n  2. No, exit\nEnter to confirm · Esc to cancel",
    );
    assert_eq!(detect_in_rows(&trust), None);
}

#[test]
fn a_dialog_that_left_the_screen_is_not_detected() {
    // The dialog is in the byte buffer but the screen was cleared and repainted since.
    let mut bytes = POSITIVE.to_vec();
    bytes.extend_from_slice(b"\x1b[2J\x1b[Hback to work\r\n");
    assert_eq!(detect_in_output(&bytes, 120, 40), None);
    // Or it scrolled off the top of the screen.
    let mut bytes = POSITIVE.to_vec();
    bytes.extend_from_slice("\r\nline".repeat(60).as_bytes());
    assert_eq!(detect_in_output(&bytes, 120, 40), None);
}

#[test]
fn three_option_dialogs_allow_with_the_plain_yes() {
    let r = rows(
        "──────────\nEdit file\nsrc/main.rs\n\nDo you want to make this edit to main.rs?\n  1. Yes\n❯ 2. Yes, and don't ask again for this session\n  3. No\n\nEsc to cancel · Tab to amend",
    );
    let p = detect_in_rows(&r).expect("prompt");
    assert_eq!(p.question, "Do you want to make this edit to main.rs?");
    assert_eq!(p.allow_key, 1);
    assert_eq!(p.options.len(), 3);
    assert_eq!(p.summary.as_deref(), Some("Edit file\nsrc/main.rs"));
}

#[test]
fn a_dialog_without_a_plain_yes_is_ignored() {
    let r = rows("Do you want to proceed?\n❯ 1. Yes, once\n  2. No\nEsc to cancel");
    assert_eq!(detect_in_rows(&r), None);
}

#[test]
fn incomplete_dialogs_are_ignored() {
    // No footer.
    assert_eq!(
        detect_in_rows(&rows(
            "Do you want to proceed?\n❯ 1. Yes\n  2. No\nsomething else"
        )),
        None
    );
    // One option only.
    assert_eq!(
        detect_in_rows(&rows("Do you want to proceed?\n❯ 1. Yes\nEsc to cancel")),
        None
    );
    // Options not numbered from 1.
    assert_eq!(
        detect_in_rows(&rows(
            "Do you want to proceed?\n  2. Yes\n  3. No\nEsc to cancel"
        )),
        None
    );
    // Not a question.
    assert_eq!(
        detect_in_rows(&rows(
            "Do you want to proceed\n❯ 1. Yes\n  2. No\nEsc to cancel"
        )),
        None
    );
}

#[test]
fn garbage_never_panics() {
    assert_eq!(detect_in_output(b"", 120, 40), None);
    assert_eq!(
        detect_in_output(&[0xff, 0x1b, b'[', 0x00, 0x9b, 0xc3], 120, 40),
        None
    );
    assert_eq!(detect_in_output(POSITIVE, 0, 0), None);
    assert_eq!(detect_in_output(&POSITIVE[37..], 80, 24), None);
}
