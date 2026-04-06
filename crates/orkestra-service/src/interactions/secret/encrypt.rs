//! AES-256-GCM encryption helpers for project secrets.

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};

use crate::types::ServiceError;

/// Encrypt `plaintext` with AES-256-GCM using `key_hex` (64 hex chars = 32 bytes).
///
/// Returns `(ciphertext, nonce)`. A fresh 96-bit nonce is generated for each call.
pub fn encrypt(plaintext: &str, key_hex: &str) -> Result<(Vec<u8>, Vec<u8>), ServiceError> {
    let key = parse_key(key_hex)?;
    let cipher = Aes256Gcm::new(&key.into());

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| ServiceError::Other(format!("Encryption failed: {e}")))?;

    Ok((ciphertext, nonce_bytes.to_vec()))
}

/// Decrypt `ciphertext` with AES-256-GCM using the provided `nonce` and `key_hex`.
///
/// Returns the plaintext as a UTF-8 string.
pub fn decrypt(ciphertext: &[u8], nonce: &[u8], key_hex: &str) -> Result<String, ServiceError> {
    let key = parse_key(key_hex)?;
    let cipher = Aes256Gcm::new(&key.into());

    if nonce.len() != 12 {
        return Err(ServiceError::Other(format!(
            "Invalid nonce length: expected 12, got {}",
            nonce.len()
        )));
    }
    let nonce = Nonce::from_slice(nonce);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| ServiceError::Other(format!("Decryption failed: {e}")))?;

    String::from_utf8(plaintext)
        .map_err(|e| ServiceError::Other(format!("Decrypted bytes are not valid UTF-8: {e}")))
}

// -- Helpers --

fn parse_key(key_hex: &str) -> Result<[u8; 32], ServiceError> {
    if key_hex.len() != 64 {
        return Err(ServiceError::Other(format!(
            "Invalid ORKESTRA_SECRETS_KEY: expected 64 hex chars (32 bytes), got {}",
            key_hex.len()
        )));
    }
    let bytes = hex::decode(key_hex)
        .map_err(|e| ServiceError::Other(format!("Invalid ORKESTRA_SECRETS_KEY hex: {e}")))?;
    bytes
        .try_into()
        .map_err(|_| ServiceError::Other("Invalid ORKESTRA_SECRETS_KEY length".to_string()))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::{decrypt, encrypt, parse_key};
    use crate::types::ServiceError;

    const VALID_KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn round_trip() {
        let plaintext = "my super secret value";
        let (ciphertext, nonce) = encrypt(plaintext, VALID_KEY).unwrap();
        let recovered = decrypt(&ciphertext, &nonce, VALID_KEY).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn different_plaintexts_produce_different_ciphertexts() {
        let (ct1, _) = encrypt("value1", VALID_KEY).unwrap();
        let (ct2, _) = encrypt("value2", VALID_KEY).unwrap();
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn nonce_randomness_produces_different_ciphertexts_for_same_plaintext() {
        let (ct1, _) = encrypt("same", VALID_KEY).unwrap();
        let (ct2, _) = encrypt("same", VALID_KEY).unwrap();
        // With random nonces, two encryptions of the same plaintext differ.
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let (ciphertext, nonce) = encrypt("secret", VALID_KEY).unwrap();
        let wrong_key = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        let result = decrypt(&ciphertext, &nonce, wrong_key);
        assert!(result.is_err());
    }

    #[test]
    fn invalid_hex_key_returns_error() {
        let result =
            parse_key("not_hex_and_not_64_chars_long_at_all_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
        assert!(matches!(result, Err(ServiceError::Other(_))));
    }

    #[test]
    fn too_short_key_returns_error() {
        let result = parse_key("0123456789abcdef");
        assert!(matches!(result, Err(ServiceError::Other(_))));
    }

    #[test]
    fn too_long_key_returns_error() {
        let result =
            parse_key("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef00");
        assert!(matches!(result, Err(ServiceError::Other(_))));
    }
}
