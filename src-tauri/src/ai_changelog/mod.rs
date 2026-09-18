//! Recording *why* a change was made, next to the change itself.
//!
//! An agent (or a person) that implements work runs
//! `git dt --createchangelog="claude"` when it is done. Diff Trek captures the
//! diff, writes it to `.difftrek/ai_changelog/<nonce>.log` with a reason
//! placeholder after every hunk, and the author fills the placeholders in.
//! Diff Trek then shows those reasons beside the diff.
//!
//! Diff Trek never calls a model. It only reads a file, so this works with any
//! tool that can be told to write one.
//!
//! - [`format`] is the file format: the tag grammar, the nonce, and reading or
//!   writing an annotated diff.
//! - [`capture`] pins how the diff is produced, which is what makes matching
//!   mean anything.
//! - [`matching`] decides which notes still describe the diff on screen.
//! - [`storage`] owns the folder: where files go, which to read, and reaping.

pub mod capture;
pub mod format;
pub mod matching;
pub mod nonce;
pub mod service;
pub mod storage;
