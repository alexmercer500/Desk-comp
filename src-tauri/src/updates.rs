// Automatic updates (tauri-plugin-updater).
//
// A release build is made by scripts/release.mjs, which bakes in where the
// update manifest lives (DESK_COMPANION_UPDATE_URL) and signs the installer
// with the update key; the public half of that key is in tauri.conf.json, so
// only installers signed with it are ever accepted. A build without the URL
// (development, a plain `tauri build`) simply has updates turned off.
//
// The app checks shortly after it starts and then every few hours (Settings →
// Check for updates automatically), and says so once per new version. Nothing
// is installed without a click: installing restarts the app.

use std::net::SocketAddr;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

use crate::{desktop, system};

/// Where the update manifest (latest.json) lives, baked in by the release script.
const UPDATE_URL: Option<&str> = option_env!("DESK_COMPANION_UPDATE_URL");
const FIRST_CHECK: Duration = Duration::from_secs(90);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// A check is one small file; a dead address resets after ~15 s, so don't wait longer than this.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Each attempt starts from a different address of the hosts below.
const ATTEMPTS: usize = 4;
/// Where a check and a download go (GitHub sends the files on to its download hosts).
const HOSTS: [&str; 3] = ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// False when this build has no update server (development builds).
    configured: bool,
    current: String,
    /// The newer version on offer, if any.
    available: Option<String>,
    notes: Option<String>,
}

/// Checks for an update. Some networks can't reach one of a host's addresses (GitHub's download
/// host has four; one reset every connection on a user's network while the others worked), and
/// the HTTP client sticks to the first address the system gives it. So a failed attempt is
/// repeated starting from the next address, up to [ATTEMPTS] times.
async fn find(app: &AppHandle) -> Result<Option<Update>, String> {
    let Some(url) = UPDATE_URL else { return Ok(None) };
    let addresses = addresses(url).await;
    let mut last = String::new();
    for attempt in 0..ATTEMPTS {
        match updater(app, url, &addresses, attempt, CHECK_TIMEOUT)?.check().await {
            Ok(found) => return Ok(found),
            Err(e) => last = chain(&e),
        }
    }
    Err(format!("Couldn't check for updates: {last}"))
}

/// The update client for one attempt: each host's addresses, rotated by `attempt`, so the
/// connection starts from a different one each time.
fn updater(app: &AppHandle, url: &str, addresses: &[(String, Vec<SocketAddr>)], attempt: usize, timeout: Duration) -> Result<Updater, String> {
    let url = url.parse().map_err(|e| format!("bad update address: {e}"))?;
    let pinned: Vec<(String, Vec<SocketAddr>)> = addresses
        .iter()
        .map(|(host, list)| {
            let mut list = list.clone();
            let n = list.len();
            list.rotate_left(attempt % n);
            (host.clone(), list)
        })
        .collect();
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .timeout(timeout)
        .configure_client(move |mut client| {
            for (host, list) in &pinned {
                client = client.resolve_to_addrs(host, list);
            }
            client
        })
        .build()
        .map_err(|e| e.to_string())
}

/// The addresses of the update hosts (and of the update address's own host), looked up once.
/// A host that can't be looked up is left to the client's own lookup.
async fn addresses(url: &str) -> Vec<(String, Vec<SocketAddr>)> {
    let mut hosts: Vec<String> = HOSTS.iter().map(|h| h.to_string()).collect();
    if let Some(own) = url.parse::<tauri::Url>().ok().and_then(|u| u.host_str().map(str::to_owned)) {
        if !hosts.contains(&own) {
            hosts.push(own);
        }
    }
    let mut out = Vec::new();
    for host in hosts {
        let found = tokio::net::lookup_host((host.as_str(), 443)).await.map(|f| f.collect::<Vec<SocketAddr>>());
        if let Ok(list) = found {
            if !list.is_empty() {
                out.push((host, list));
            }
        }
    }
    out
}

/// An error with its causes ("error sending request" alone says nothing about why).
fn chain(e: &dyn std::error::Error) -> String {
    let mut text = e.to_string();
    let mut cause = e.source();
    while let Some(c) = cause {
        let more = c.to_string();
        if !text.contains(&more) {
            text.push_str(": ");
            text.push_str(&more);
        }
        cause = c.source();
    }
    text
}

fn info(app: &AppHandle, update: Option<&Update>) -> UpdateInfo {
    UpdateInfo {
        configured: UPDATE_URL.is_some(),
        current: app.package_info().version.to_string(),
        available: update.map(|u| u.version.clone()),
        notes: update.and_then(|u| u.body.clone()),
    }
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let update = find(&app).await?;
    Ok(info(&app, update.as_ref()))
}

/// Downloads the update (its signature is checked against the key in
/// tauri.conf.json before anything runs), installs it and restarts.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let Some(url) = UPDATE_URL else { return Err("This build doesn't update.".into()) };
    let addresses = addresses(url).await;
    let mut last = String::new();
    for attempt in 0..ATTEMPTS {
        // The download goes through the same attempt's client, so it starts from the same address.
        let update = match updater(&app, url, &addresses, attempt, DOWNLOAD_TIMEOUT)?.check().await {
            Ok(Some(update)) => update,
            Ok(None) => return Err("You already have the latest version.".into()),
            Err(e) => {
                last = chain(&e);
                continue;
            }
        };
        // How far the download is, for the button in Settings: at most once per whole percent.
        let mut done: u64 = 0;
        let mut told: Option<u64> = None;
        let progress = |chunk: usize, total: Option<u64>| {
            done += chunk as u64;
            let percent = total.filter(|t| *t > 0).map(|t| (done * 100 / t).min(100));
            if percent.is_none() || percent != told {
                told = percent;
                let _ = app.emit("update:progress", serde_json::json!({ "done": done, "total": total }));
            }
        };
        let finished = || {
            let _ = app.emit("update:installing", ());
        };
        match update.download_and_install(progress, finished).await {
            Ok(()) => app.restart(),
            // A bad signature is not a network problem: never retry past it.
            Err(e @ tauri_plugin_updater::Error::Minisign(_)) | Err(e @ tauri_plugin_updater::Error::SignatureUtf8(_)) => {
                return Err(format!("The update didn't install: {}", chain(&e)))
            }
            Err(e) => last = chain(&e),
        }
    }
    Err(format!("The update didn't install: {last}"))
}

/// Checks in the background and mentions a new version once.
pub fn spawn(app: AppHandle) {
    if UPDATE_URL.is_none() {
        return;
    }
    // Development only: check and download straight away, verify the
    // signature, report on stderr, install nothing.
    if cfg!(debug_assertions) && std::env::var_os("DESK_COMPANION_UPDATE_SELFTEST").is_some() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            match find(&app).await {
                Ok(Some(update)) => match update.download(|_, _| {}, || {}).await {
                    Ok(bytes) => eprintln!("[updates] self-test: {} offered, {} bytes downloaded, signature verified", update.version, bytes.len()),
                    Err(e) => eprintln!("[updates] self-test: {} offered, download/verify FAILED: {}", update.version, chain(&e)),
                },
                Ok(None) => eprintln!("[updates] self-test: no newer version offered"),
                Err(e) => eprintln!("[updates] self-test: {e}"),
            }
        });
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        let mut told: Option<String> = None;
        loop {
            if system::current(&app).auto_update {
                match find(&app).await {
                    Ok(Some(update)) if told.as_deref() != Some(update.version.as_str()) => {
                        let text = format!("Version {} is ready. Open Settings to install it.", update.version);
                        let _ = app.emit_to(
                            desktop::LABEL,
                            "notice",
                            serde_json::json!({ "title": "Update available", "text": text, "kind": "info", "action": "settings" }),
                        );
                        told = Some(update.version.clone());
                    }
                    Ok(_) => {}
                    Err(e) => eprintln!("[updates] {e}"),
                }
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}
