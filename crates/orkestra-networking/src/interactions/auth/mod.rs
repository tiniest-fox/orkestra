//! Authentication and device pairing interactions.

pub mod generate_pairing_code;
pub mod list_devices;
pub mod pair_device;
pub mod revoke_device;
pub(crate) mod verify_token;

// -- Shared Helpers --

use sha2::{Digest, Sha256};

pub(crate) fn sha256_hex(input: &str) -> String {
    let hash = Sha256::digest(input.as_bytes());
    hash.iter().map(|b| format!("{b:02x}")).collect()
}
