// The phone link's wire format and rules (docs/PHONE_LINK.md), kept free of
// sockets so they can be tested on their own.

use std::net::IpAddr;
use std::time::Duration;

use serde_json::{json, Value};

pub const VERSION: u64 = 1;
pub const DEFAULT_PORT: u16 = 47822;
/// Longest line either side sends.
pub const MAX_LINE: usize = 64 * 1024;
/// Phones signed in at once, and connections of any kind.
pub const MAX_PHONES: usize = 4;
pub const MAX_CONNECTIONS: usize = 8;
/// Time for a new connection to finish TLS and say hello.
pub const HELLO_WAIT: Duration = Duration::from_secs(10);
/// A phone that says nothing for this long (it pings every 25 s) is dropped.
pub const IDLE_LIMIT: Duration = Duration::from_secs(90);
/// A wrong token is answered only after this, so guessing is slow.
pub const WRONG_TOKEN_DELAY: Duration = Duration::from_millis(400);
/// Longest request id accepted back from the phone.
const MAX_RID: usize = 512;

/// A message from the phone.
#[derive(Debug, PartialEq)]
pub enum FromPhone {
    Hello { v: u64, token: String, device: String },
    /// The phone is showing this request: the agent keeps waiting for it.
    Seen { rid: String },
    Decision { rid: String, allow: bool },
    Ping,
    /// A type this version doesn't know (a newer phone): ignored.
    Other,
}

pub fn parse(line: &str) -> Result<FromPhone, &'static str> {
    let v: Value = serde_json::from_str(line).map_err(|_| "not JSON")?;
    let o = v.as_object().ok_or("not an object")?;
    let text = |k: &str| o.get(k).and_then(Value::as_str);
    match text("t") {
        Some("hello") => Ok(FromPhone::Hello {
            v: o.get("v").and_then(Value::as_u64).ok_or("hello without a version")?,
            token: text("token").ok_or("hello without a token")?.to_string(),
            device: device_name(text("device").unwrap_or("")),
        }),
        Some("seen") => Ok(FromPhone::Seen { rid: request_id(text("rid"))? }),
        Some("decision") => {
            // Only these two: "always" can't be given from the phone.
            let allow = match text("decision") {
                Some("allow") => true,
                Some("deny") => false,
                _ => return Err("decision must be allow or deny"),
            };
            Ok(FromPhone::Decision { rid: request_id(text("rid"))?, allow })
        }
        Some("ping") => Ok(FromPhone::Ping),
        Some(_) => Ok(FromPhone::Other),
        None => Err("no type"),
    }
}

/// Request ids come from the relay and contain the agent's session id, so
/// they're opaque here: any short text without control characters. They are
/// only ever used to look up a request that is waiting.
fn request_id(rid: Option<&str>) -> Result<String, &'static str> {
    let rid = rid.ok_or("no request id")?;
    if rid.is_empty() || rid.len() > MAX_RID || rid.chars().any(char::is_control) {
        return Err("bad request id");
    }
    Ok(rid.to_string())
}

/// The phone's name as the user will see it in Settings: printable, short.
fn device_name(name: &str) -> String {
    let clean: String = name.chars().filter(|c| !c.is_control()).take(40).collect();
    let clean = clean.trim();
    if clean.is_empty() { "Phone".into() } else { clean.to_string() }
}

/// Only peers on the local network may connect: private, link-local, loopback
/// and carrier-grade-NAT ranges (some phone hotspots hand those out).
pub fn local_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_private() || v4.is_loopback() || v4.is_link_local() || (o[0] == 100 && (64..128).contains(&o[1]))
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return local_peer(IpAddr::V4(v4));
            }
            let seg = v6.segments()[0];
            v6.is_loopback() || (seg & 0xffc0) == 0xfe80 || (seg & 0xfe00) == 0xfc00
        }
    }
}

/// Compares two secrets in time that doesn't depend on where they differ.
pub fn same_secret(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The pairing link the QR code carries.
pub fn pairing_link(hosts: &[String], port: u16, fingerprint: &str, token: &str, name: &str) -> String {
    format!(
        "deskcompanion://pair?v={VERSION}&hosts={}&port={port}&fp={fingerprint}&token={token}&name={}",
        hosts.join(","),
        percent(name),
    )
}

/// Percent-encodes everything but unreserved characters.
fn percent(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The PC's addresses a phone could reach, best first: home and office
/// networks (192.168.x), then 10.x (also phone hotspots), then 172.16–31.x
/// (often virtual adapters, so last). Loopback and link-local are left out.
pub fn rank_hosts(mut candidates: Vec<(String, std::net::Ipv4Addr)>) -> Vec<String> {
    // Virtual adapters (WSL, Docker, Hyper-V, VPN clients, VirtualBox, VMware) can't be reached from a phone.
    const VIRTUAL: &[&str] = &["vethernet", "wsl", "docker", "hyper-v", "virtualbox", "vmware", "vbox", "loopback", "tailscale", "zerotier"];
    candidates.retain(|(name, ip)| {
        let n = name.to_lowercase();
        ip.is_private() && !VIRTUAL.iter().any(|v| n.contains(v))
    });
    let rank = |ip: &std::net::Ipv4Addr| match ip.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        _ => 2,
    };
    candidates.sort_by_key(|(_, ip)| rank(ip));
    let mut out: Vec<String> = Vec::new();
    for (_, ip) in candidates {
        let s = ip.to_string();
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out.truncate(4);
    out
}

// ── PC → phone ────────────────────────────────────────────────────────────────

pub fn welcome(name: &str, approvals: bool) -> String {
    line(json!({ "t": "welcome", "v": VERSION, "name": name, "approvals": approvals }))
}

pub fn error(code: &str, message: &str) -> String {
    line(json!({ "t": "error", "code": code, "message": message }))
}

pub fn decided(rid: &str, ok: bool) -> String {
    line(json!({ "t": "decided", "rid": rid, "ok": ok }))
}

pub fn pong() -> String {
    line(json!({ "t": "pong" }))
}

/// The sessions message, from the list the companion page sent.
pub fn sessions(list: &Value) -> String {
    line(json!({ "t": "sessions", "sessions": list }))
}

fn line(v: Value) -> String {
    let mut s = v.to_string();
    s.push('\n');
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn messages_from_the_phone_are_read_strictly() {
        assert_eq!(
            parse(r#"{"t":"hello","v":1,"token":"abc","device":"Pixel 7"}"#),
            Ok(FromPhone::Hello { v: 1, token: "abc".into(), device: "Pixel 7".into() })
        );
        assert_eq!(parse(r#"{"t":"decision","rid":"s:1:2","decision":"allow"}"#), Ok(FromPhone::Decision { rid: "s:1:2".into(), allow: true }));
        assert_eq!(parse(r#"{"t":"decision","rid":"s:1:2","decision":"deny"}"#), Ok(FromPhone::Decision { rid: "s:1:2".into(), allow: false }));
        assert_eq!(parse(r#"{"t":"seen","rid":"x"}"#), Ok(FromPhone::Seen { rid: "x".into() }));
        assert_eq!(parse(r#"{"t":"ping"}"#), Ok(FromPhone::Ping));
        assert_eq!(parse(r#"{"t":"something-new","x":1}"#), Ok(FromPhone::Other));
        for bad in [
            "",
            "nope",
            "[]",
            r#"{"v":1}"#,
            r#"{"t":"hello","token":"abc"}"#,
            r#"{"t":"decision","rid":"x","decision":"always"}"#,
            r#"{"t":"decision","rid":"","decision":"allow"}"#,
            r#"{"t":"decision","decision":"allow"}"#,
            r#"{"t":"seen","rid":"a\u0000b"}"#,
        ] {
            assert!(parse(bad).is_err(), "{bad:?}");
        }
        let long = format!(r#"{{"t":"seen","rid":"{}"}}"#, "r".repeat(MAX_RID + 1));
        assert!(parse(&long).is_err());
    }

    #[test]
    fn device_names_are_cleaned() {
        let FromPhone::Hello { device, .. } = parse(r#"{"t":"hello","v":1,"token":"a","device":"  \u0007Pixel\u0000 "}"#).unwrap() else { panic!() };
        assert_eq!(device, "Pixel");
        let FromPhone::Hello { device, .. } = parse(r#"{"t":"hello","v":1,"token":"a"}"#).unwrap() else { panic!() };
        assert_eq!(device, "Phone");
    }

    #[test]
    fn only_local_peers_are_let_in() {
        for ok in ["192.168.1.5", "10.0.0.2", "172.20.1.1", "127.0.0.1", "169.254.3.4", "100.72.0.9"] {
            assert!(local_peer(ok.parse().unwrap()), "{ok}");
        }
        for no in ["8.8.8.8", "100.200.0.1", "172.32.0.1", "1.1.1.1"] {
            assert!(!local_peer(no.parse().unwrap()), "{no}");
        }
        assert!(local_peer(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(local_peer("fe80::1".parse().unwrap()));
        assert!(local_peer("fd12::1".parse().unwrap()));
        assert!(local_peer("::ffff:192.168.0.9".parse().unwrap()));
        assert!(!local_peer("2001:4860::8888".parse().unwrap()));
    }

    #[test]
    fn secrets_compare_exactly() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
        assert!(!same_secret("", "a"));
    }

    #[test]
    fn the_link_carries_everything_the_phone_needs() {
        let link = pairing_link(&["192.168.1.20".into(), "10.0.0.5".into()], 47822, "ab12", "tok_EN-1", "Nidhi's PC");
        assert_eq!(link, "deskcompanion://pair?v=1&hosts=192.168.1.20,10.0.0.5&port=47822&fp=ab12&token=tok_EN-1&name=Nidhi%27s%20PC");
    }

    #[test]
    fn reachable_addresses_come_first_and_virtual_ones_are_left_out() {
        let c = |n: &str, ip: [u8; 4]| (n.to_string(), Ipv4Addr::from(ip));
        let hosts = rank_hosts(vec![
            c("vEthernet (WSL)", [172, 24, 0, 1]),
            c("Wi-Fi", [10, 42, 0, 15]),
            c("Ethernet", [192, 168, 1, 20]),
            c("Ethernet 2", [172, 16, 5, 5]),
            c("Wi-Fi", [8, 8, 8, 8]),
            c("Wi-Fi", [192, 168, 1, 20]),
        ]);
        assert_eq!(hosts, vec!["192.168.1.20", "10.42.0.15", "172.16.5.5"]);
    }

    #[test]
    fn replies_are_single_lines() {
        for l in [welcome("PC", true), error("token", "Pair again"), decided("r", false), pong(), sessions(&json!([]))] {
            assert!(l.ends_with('\n'));
            assert_eq!(l.matches('\n').count(), 1);
            assert!(serde_json::from_str::<Value>(l.trim()).is_ok());
        }
    }
}
