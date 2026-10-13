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

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{desktop, system};

/// Where the update manifest (latest.json) lives, baked in by the release script.
const UPDATE_URL: Option<&str> = option_env!("DESK_COMPANION_UPDATE_URL");
const FIRST_CHECK: Duration = Duration::from_secs(90);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

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

async fn find(app: &AppHandle) -> Result<Option<Update>, String> {
    let Some(url) = UPDATE_URL else { return Ok(None) };
    let url = url.parse().map_err(|e| format!("bad update address: {e}"))?;
    let updater = app.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    updater.check().await.map_err(|e| format!("Couldn't check for updates: {e}"))
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
    let update = find(&app).await?.ok_or("You already have the latest version.")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("The update didn't install: {e}"))?;
    app.restart();
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
                    Err(e) => eprintln!("[updates] self-test: {} offered, download/verify FAILED: {e}", update.version),
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
