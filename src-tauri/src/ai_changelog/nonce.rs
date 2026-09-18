//! Picking the per-file nonce.
//!
//! The nonce is what lets a tag be told from a line of diff that merely looks
//! like one, so it must not occur in the diff it is about to annotate. Because
//! the changelog is written *after* the work — the diff is already in hand —
//! that can be guaranteed rather than hoped for: generate, search the diff for
//! it, and generate again if it is there.

use std::time::{SystemTime, UNIX_EPOCH};

/// One case only: the nonce is also the file name, and macOS filesystems are
/// case-insensitive, so `AB99X7` and `ab99x7` would be the same file. `I`, `O`,
/// `0` and `1` are left out because people read these aloud and type them back.
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const DEFAULT_LENGTH: usize = 6;

/// How many times to try a fresh nonce of the same length before making it
/// longer. Only a diff that deliberately contains nonces gets this far.
const ATTEMPTS: usize = 8;

/// A nonce that does not occur anywhere in `diff`.
pub fn for_diff(diff: &str) -> String {
    let mut random = Random::seeded();
    let mut length = DEFAULT_LENGTH;

    loop {
        for _ in 0..ATTEMPTS {
            let candidate = random.token(length);
            if !diff.contains(&candidate) {
                return candidate;
            }
        }
        length += 1;
    }
}

/// xorshift64*, seeded from the clock and a stack address.
///
/// Deliberately not a dependency: the nonce needs to be unpredictable enough
/// not to collide, not cryptographically strong, and `CLAUDE.md` asks whether
/// the standard library can reasonably do it first. The collision check above
/// is what actually guarantees correctness.
struct Random(u64);

impl Random {
    fn seeded() -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15);

        let here = &nanos as *const u64 as u64;
        Self(nanos ^ here.rotate_left(17) ^ 0x2545_F491_4F6C_DD1D)
    }

    fn next(&mut self) -> u64 {
        let mut state = self.0;
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        self.0 = state;
        state.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn token(&mut self, length: usize) -> String {
        (0..length)
            .map(|_| ALPHABET[(self.next() % ALPHABET.len() as u64) as usize] as char)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_nonce_is_upper_case_and_free_of_confusable_characters() {
        let nonce = for_diff("");
        assert_eq!(nonce.len(), DEFAULT_LENGTH);
        assert!(nonce
            .bytes()
            .all(|byte| ALPHABET.contains(&byte)));
    }

    #[test]
    fn successive_nonces_differ() {
        let mut random = Random::seeded();
        let first = random.token(DEFAULT_LENGTH);
        let second = random.token(DEFAULT_LENGTH);
        assert_ne!(first, second);
    }

    #[test]
    fn a_nonce_never_occurs_in_the_diff_it_is_for() {
        // A diff that contains every nonce of the default length forces the
        // generator to lengthen rather than loop for ever.
        let mut random = Random::seeded();
        let crowded: String = (0..4000)
            .map(|_| format!("+{}\n", random.token(DEFAULT_LENGTH)))
            .collect();

        let nonce = for_diff(&crowded);
        assert!(!crowded.contains(&nonce));
    }
}
