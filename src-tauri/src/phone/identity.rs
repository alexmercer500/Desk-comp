// The PC's identity on the phone link: a self-signed ECDSA P-256 certificate
// (the phone pins its fingerprint) and a random token (the phone's password).
// Both live in Windows Credential Manager, made the first time the link is
// turned on. "Pair again" replaces the token only, so the fingerprint stays.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};

const SECRET: &str = "DeskCompanion/phone-link";

#[derive(Clone)]
pub struct Identity {
    pub cert_der: Vec<u8>,
    /// PKCS#8.
    pub key_der: Vec<u8>,
    pub token: String,
}

#[derive(Serialize, Deserialize)]
struct Stored {
    cert: String,
    key: String,
    token: String,
}

impl Identity {
    /// The stored identity, or a new one (saved) the first time.
    pub fn load_or_create() -> Result<Identity, String> {
        if let Some(found) = load() {
            return Ok(found);
        }
        let made = create()?;
        save(&made)?;
        Ok(made)
    }

    /// The same certificate with a new token: phones paired before can't sign in any more.
    pub fn with_new_token(&self) -> Result<Identity, String> {
        let next = Identity { token: new_token()?, ..self.clone() };
        save(&next)?;
        Ok(next)
    }

    /// SHA-256 of the certificate, lowercase hex: what the phone pins.
    pub fn fingerprint(&self) -> String {
        ring::digest::digest(&ring::digest::SHA256, &self.cert_der)
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}

fn load() -> Option<Identity> {
    let bytes = crate::secrets::read(SECRET)?;
    let s: Stored = serde_json::from_slice(&bytes).ok()?;
    let id = Identity {
        cert_der: STANDARD.decode(s.cert).ok()?,
        key_der: STANDARD.decode(s.key).ok()?,
        token: s.token,
    };
    // A token that doesn't look like ours (hand-edited, damaged) means starting over.
    (id.token.len() == 43 && !id.cert_der.is_empty() && !id.key_der.is_empty()).then_some(id)
}

fn save(id: &Identity) -> Result<(), String> {
    let s = Stored { cert: STANDARD.encode(&id.cert_der), key: STANDARD.encode(&id.key_der), token: id.token.clone() };
    let bytes = serde_json::to_vec(&s).map_err(|e| e.to_string())?;
    crate::secrets::write(SECRET, "phone-link", &bytes).map_err(|e| format!("Couldn't save the phone link's keys: {e}"))
}

/// Removes the identity: the next "on" makes a new certificate (phones must pair again).
#[allow(dead_code)]
pub fn forget() {
    crate::secrets::delete(SECRET);
}

fn create() -> Result<Identity, String> {
    let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).map_err(|e| e.to_string())?;
    // The name doesn't matter: the phone checks the fingerprint, not a host name.
    let mut params = rcgen::CertificateParams::new(vec!["desk-companion.local".to_string()]).map_err(|e| e.to_string())?;
    params.distinguished_name.push(rcgen::DnType::CommonName, "Desk Companion");
    let cert = params.self_signed(&key).map_err(|e| e.to_string())?;
    Ok(Identity { cert_der: cert.der().to_vec(), key_der: key.serialize_der(), token: new_token()? })
}

/// 32 random bytes, base64url without padding (43 characters).
fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    SystemRandom::new().fill(&mut bytes).map_err(|_| "no randomness available".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_identity_has_a_certificate_a_key_and_a_long_random_token() {
        let a = create().unwrap();
        let b = create().unwrap();
        assert_eq!(a.token.len(), 43);
        assert_ne!(a.token, b.token);
        assert_eq!(a.fingerprint().len(), 64);
        assert_ne!(a.fingerprint(), b.fingerprint());
        // Fits one Credential Manager entry.
        let stored = serde_json::to_vec(&Stored { cert: STANDARD.encode(&a.cert_der), key: STANDARD.encode(&a.key_der), token: a.token.clone() }).unwrap();
        assert!(stored.len() < crate::secrets::MAX_SECRET, "{} bytes", stored.len());
    }
}
