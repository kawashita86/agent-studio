//! Detects the permission dialog of a Claude Code agent on its visible terminal screen, so the
//! Overview can answer it (Allow / Deny) without opening the agent.
//!
//! The agent's raw PTY bytes are replayed into a [`vt100`] screen of the agent's PTY size and the
//! **visible rows only** are inspected: a dialog that scrolled away or was answered is gone from the
//! screen even though its text is still in the byte buffer. Shape (Claude Code 2.1.326):
//!
//! ```text
//! Bash command
//! Create demo-dir2 directory and echo made      <- summary lines (tool, description, command)
//! mkdir demo-dir2 && echo made
//! Do you want to proceed?                       <- the question
//! ❯ 1. Yes                                      <- numbered options, cursor glyph optional
//!   2. No
//! Esc to cancel · Tab to amend                  <- footer
//! ```
//!
//! Limits: this is a heuristic on an undocumented UI. Other dialogs of the same family ("Do you want
//! to make this edit to X?") are recognised by the same shape; anything without a question, at least
//! two sequentially numbered options, an "Esc to cancel" footer and a plain "Yes" option is ignored.
//! The screen is replayed from the retained tail of the output, at the agent's current PTY size, so a
//! terminal resized mid-dialog can render differently from what the user sees.

use std::num::NonZeroU16;

use sha2::{Digest, Sha256};

#[cfg(test)]
mod tests;

/// How much of the end of the output buffer is replayed. Claude redraws with relative cursor
/// moves, so the window must be large enough to hold the last full-screen paint.
pub const RENDER_TAIL_BYTES: usize = 256 * 1024;

/// Most summary lines kept (the tool, its description, the command).
const MAX_SUMMARY_LINES: usize = 3;
/// Most rows scanned above the question looking for the dialog's top.
const MAX_SCANNED_ROWS: usize = 10;
/// Most characters kept of one summary line.
const MAX_SUMMARY_LINE_CHARS: usize = 300;
/// Most blank rows allowed between the options and the footer.
const MAX_GAP_TO_FOOTER: usize = 2;

/// A permission dialog found on the screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionPrompt {
    /// "Do you want to proceed?"
    pub question: String,
    /// The tool and command lines above the question (at most three), joined with newlines.
    pub summary: Option<String>,
    /// `(number, label)` of every option, in screen order.
    pub options: Vec<(u8, String)>,
    /// Number of the option labelled exactly "Yes": typing it answers Allow.
    pub allow_key: u8,
    /// Stable hash of question, summary and options: the same dialog always has the same id.
    pub id: String,
}

/// The visible rows of `bytes` replayed into a `cols` x `rows` terminal, trailing blanks trimmed.
pub fn render_rows(bytes: &[u8], cols: u16, rows: u16) -> Vec<String> {
    let (rows, cols) = (rows.max(2), cols.max(2));
    // `max(2)` makes both sizes non-zero.
    let (Some(r), Some(c)) = (NonZeroU16::new(rows), NonZeroU16::new(cols)) else {
        return Vec::new();
    };
    let mut parser = vt100::Parser::new(r, c, 0);
    parser.process(bytes);
    parser
        .screen()
        .rows(0, cols)
        .map(|r| r.trim_end().to_string())
        .collect()
}

/// Detects a permission dialog in the output `bytes` of a PTY of `cols` x `rows`.
pub fn detect_in_output(bytes: &[u8], cols: u16, rows: u16) -> Option<PermissionPrompt> {
    detect_in_rows(&render_rows(bytes, cols, rows))
}

/// `1. Yes`, `❯ 2. No`, `> 3. Yes, and don't ask again for ...` -> (number, label).
fn parse_option(line: &str) -> Option<(u8, String)> {
    let t = line.trim_start();
    let t = t
        .strip_prefix(['❯', '>', '›', '▶'])
        .map_or(t, str::trim_start);
    let digits = t.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 || digits > 2 {
        return None;
    }
    let (num, rest) = t.split_at(digits);
    let label = rest.strip_prefix('.')?;
    if !label.starts_with(' ') {
        return None;
    }
    let label = label.trim();
    if label.is_empty() {
        return None;
    }
    Some((num.parse().ok()?, label.to_string()))
}

/// A solid rule: the top edge of the dialog.
fn is_top_border(line: &str) -> bool {
    line.chars().count() >= 3 && line.chars().all(|c| "─━═".contains(c))
}

/// A dashed rule between the command and the notes of the dialog.
fn is_separator(line: &str) -> bool {
    line.chars().count() >= 3 && line.chars().all(|c| "╌╍┄┅".contains(c))
}

fn question_line(line: &str) -> bool {
    let t = line.trim();
    t.starts_with("Do you want to") && t.ends_with('?')
}

fn make_id(question: &str, summary: &Option<String>, options: &[(u8, String)]) -> String {
    let mut h = Sha256::new();
    h.update(question.as_bytes());
    h.update([0]);
    h.update(summary.as_deref().unwrap_or("").as_bytes());
    for (n, label) in options {
        h.update([0, *n]);
        h.update(label.as_bytes());
    }
    let digest = h.finalize();
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// Detects a permission dialog in the visible `rows` of a screen. The lowest dialog wins.
pub fn detect_in_rows(rows: &[String]) -> Option<PermissionPrompt> {
    for q in (0..rows.len()).rev() {
        if !question_line(&rows[q]) {
            continue;
        }
        if let Some(prompt) = parse_dialog(rows, q) {
            return Some(prompt);
        }
    }
    None
}

fn parse_dialog(rows: &[String], q: usize) -> Option<PermissionPrompt> {
    // Options directly below the question, numbered 1, 2, ... without a gap.
    let mut options: Vec<(u8, String)> = Vec::new();
    let mut i = q + 1;
    while let Some((n, label)) = rows.get(i).and_then(|r| parse_option(r)) {
        if usize::from(n) != options.len() + 1 {
            return None;
        }
        options.push((n, label));
        i += 1;
    }
    if options.len() < 2 {
        return None;
    }
    // The footer follows, after at most a couple of blank rows.
    let footer =
        (i..rows.len().min(i + 1 + MAX_GAP_TO_FOOTER)).find(|&j| !rows[j].trim().is_empty())?;
    if !rows[footer].trim_start().starts_with("Esc to cancel") {
        return None;
    }
    let allow_key = options.iter().find(|(_, l)| l == "Yes").map(|(n, _)| *n)?;

    // Summary: the rows between the dialog's top border and the question (dashed separators and
    // blanks skipped), the first few of them: the tool, its description, the command.
    let mut lines: Vec<String> = Vec::new();
    let mut j = q;
    let mut blanks = 0;
    while j > 0 && lines.len() < MAX_SCANNED_ROWS {
        j -= 1;
        let line = rows[j].trim();
        if line.is_empty() {
            blanks += 1;
            if blanks > 1 {
                break;
            }
            continue;
        }
        if is_top_border(line) {
            break;
        }
        blanks = 0;
        if !is_separator(line) {
            lines.push(line.chars().take(MAX_SUMMARY_LINE_CHARS).collect());
        }
    }
    lines.reverse();
    lines.truncate(MAX_SUMMARY_LINES);
    let summary = (!lines.is_empty()).then(|| lines.join("\n"));
    let question = rows[q].trim().to_string();
    let id = make_id(&question, &summary, &options);
    Some(PermissionPrompt {
        question,
        summary,
        options,
        allow_key,
        id,
    })
}
