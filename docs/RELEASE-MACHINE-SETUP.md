# Setting up a second release machine (Windows)

How to make a Windows PC able to build and publish Desk Companion releases (the Windows installer
and the Android APK) exactly like the main PC does. Follow the steps in order. Each step ends with a
check; don't go on until it passes.

## Rules for whoever follows this (person or assistant)

1. **Never print, log, paste, commit, upload or send a key, a password, or the contents of
   `keystore.properties` or `.env`.** Not into a chat, an issue, a commit, a file outside the places
   named below, or an LLM prompt. When a step needs a secret, the person types or copies it by hand.
2. **Never create new keys** (`tauri signer generate`, `keytool -genkey`, a new keystore). New keys
   don't fail loudly: they build fine, and then every installed copy refuses the update. Only copy the
   existing ones. `scripts/check-release-keys.mjs` tells you whether the keys you copied are the
   real ones.
3. **Never edit `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`** or the signing settings in
   `android/app/build.gradle.kts`.
4. Publishing (`--publish`, `gh release create`) is public and permanent: only do it when the person
   asks for a release.

## What is where (the four secrets)

| What | Where it lives on a release PC | Used for |
| --- | --- | --- |
| Windows update key | `%USERPROFILE%\.tauri\desk-companion-updater.key` (a text file, one line of base64) | signing the installer so installed copies accept the update |
| Android keystore | `%USERPROFILE%\.desk-companion\android-release.jks` (a binary file) | signing the APK so phones accept the update |
| Keystore passwords | `<repo>\android\keystore.properties` (4 lines) | opening the keystore |
| Relay address | `<repo>\.env` (1 line: `DESK_COMPANION_RELAY=https://…`) | baked into the Windows app for the phone link over the internet |

None of these are in git, and they must never be. The Windows key has no password: it signs with an
empty one.

Publicly known values (safe to show, used to verify):

- Windows update key id: `6CBE480B7CC5B682`
- Android release certificate SHA-256:
  `8f4049d1ff860da95479d4a7ec4e74d465a0fcefb1599ecde8cd0158747659a9`
- Code repo (private): `https://github.com/alexmercer500/Desk-comp.git`, branch `development`
- Releases repo (public): `alexmercer500/Desk-comp-releases`

## Step 1: Bring the secrets over (by hand, on the main PC)

Do this part yourself, not through an assistant. Use a password manager (Proton Pass) or an
encrypted USB stick. Don't use email, chat, cloud-synced folders, or a prompt.

On the **main PC**:

1. **Windows update key.** Open `%USERPROFILE%\.tauri\desk-companion-updater.key` in Notepad, copy
   the single line, and save it as a secure note ("Desk Companion updater key"). It may already be in
   Proton Pass; if so, check that it's the same line.
2. **Android keystore.** It's a binary file. Either attach `%USERPROFILE%\.desk-companion\android-release.jks`
   to a Proton Pass item, or turn it into text and save that as a note. In PowerShell on the main PC:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.desk-companion\android-release.jks")) | Set-Clipboard
   ```
   Paste it into the note, then clear the clipboard (copy any other text).
3. **Keystore passwords.** Open `android\keystore.properties` in the repo. Note the `storePassword`,
   `keyAlias` and `keyPassword` values in the same Proton Pass item. You don't need `storeFile`: it's
   a path, and it changes on the new PC.
4. **Relay address.** Open `.env` at the repo root and note the `DESK_COMPANION_RELAY=` value.

## Step 2: Install the tools (home PC)

PowerShell (as your normal user; winget asks for admin where it needs it):

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e          # Node 24 LTS (the main PC has 24.14)
winget install --id GitHub.cli -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Close and reopen PowerShell, then:

```powershell
rustup default stable        # main PC: 1.88 or newer
rustup target list --installed   # must include x86_64-pc-windows-msvc
```

WebView2 comes with Windows 11, and Tauri downloads NSIS itself on the first build.

**JDK 17 and the Android SDK.** These go in one exact place: `android\build.cmd` looks only in
`%LOCALAPPDATA%\Android`. No Android Studio is needed.

```powershell
$A = "$env:LOCALAPPDATA\Android"
New-Item -ItemType Directory -Force "$A\Sdk\cmdline-tools" | Out-Null

# JDK 17 (Eclipse Temurin), unzipped as %LOCALAPPDATA%\Android\jdk17
Invoke-WebRequest "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse" -OutFile "$env:TEMP\jdk17.zip"
Expand-Archive "$env:TEMP\jdk17.zip" "$env:TEMP\jdk17" -Force
Move-Item (Get-ChildItem "$env:TEMP\jdk17" -Directory | Select-Object -First 1).FullName "$A\jdk17"

# Android command-line tools: take the current "Command line tools only → Windows" link from
# https://developer.android.com/studio#command-line-tools-only (the file name has a build number)
Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" -OutFile "$env:TEMP\cmdline-tools.zip"
Expand-Archive "$env:TEMP\cmdline-tools.zip" "$env:TEMP\cmdline-tools" -Force
Move-Item "$env:TEMP\cmdline-tools\cmdline-tools" "$A\Sdk\cmdline-tools\latest"

# The SDK packages the app builds with (compileSdk 35)
$env:JAVA_HOME = "$A\jdk17"
& "$A\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$A\Sdk" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
& "$A\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$A\Sdk" --licenses   # answer y to each
```

**Check:** `& "$env:LOCALAPPDATA\Android\jdk17\bin\java.exe" -version` says 17, and
`%LOCALAPPDATA%\Android\Sdk\platforms\android-35` exists.

## Step 3: Get the code and log in to GitHub

```powershell
gh auth login                      # GitHub.com, HTTPS, log in with the account that owns alexmercer500
gh auth setup-git
cd $HOME\Projects                  # or wherever you keep code
git clone https://github.com/alexmercer500/Desk-comp.git
cd Desk-comp
git checkout development
npm ci
```

**Check:** `gh api repos/alexmercer500/Desk-comp-releases --jq .permissions.push` prints `true`.

## Step 4: Put the secrets in place (by hand)

Type or paste these yourself from Proton Pass.

1. **Windows update key:** create `%USERPROFILE%\.tauri\` and save the key line as
   `desk-companion-updater.key` in it: one line, no extra spaces or blank lines. Notepad is fine; save
   as UTF-8.
2. **Android keystore:** create `%USERPROFILE%\.desk-companion\`. Put the attached
   `android-release.jks` there, or, if you saved it as base64, copy the note's text and run:
   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.desk-companion" | Out-Null
   [IO.File]::WriteAllBytes("$env:USERPROFILE\.desk-companion\android-release.jks", [Convert]::FromBase64String((Get-Clipboard -Raw).Trim()))
   ```
   Then clear the clipboard.
3. **Keystore passwords:** create `android\keystore.properties` in the repo with exactly these four
   lines. Use forward slashes in the path, and your own user name:
   ```properties
   storeFile=C:/Users/<you>/.desk-companion/android-release.jks
   storePassword=<from Proton Pass>
   keyAlias=<from Proton Pass>
   keyPassword=<from Proton Pass>
   ```
4. **Relay address:** create `.env` at the repo root with one line:
   ```
   DESK_COMPANION_RELAY=https://<from Proton Pass>
   ```

Git ignores `keystore.properties` and `.env`. Check that `git status` doesn't list them; if it does,
stop and don't commit.

## Step 5: Check that the keys are the real ones

```powershell
node scripts/check-release-keys.mjs
```

It signs a scrap file with the update key and compares the key id with the one installed apps trust
(`6CBE480B7CC5B682`). It also opens the keystore and compares its certificate with the published one,
and checks `.env`, the tools and your GitHub access. It never prints a secret. Every line must say
`ok` and it must end with **All good: this PC can release.** If it reports a different key, the copy
is wrong: fix the copy. Never "fix" it by making a new key.

## Step 6: Trial build (no publishing)

```powershell
git pull
node scripts/release.mjs --github alexmercer500/Desk-comp-releases
```

Without `--publish` this only builds, into `release\<version>\`: the installer, `latest.json`, the
APK and `android.json`. The first build takes 10–20 minutes (Rust and Gradle download everything).
Then delete `release\<version>\`: that version is already published from the main PC, and these
files must not be uploaded.

If it fails:
- `No update key` → step 4.1 (file name or folder).
- `No Android release key` → step 4.3.
- Gradle can't find Java or the SDK → step 2 (the folders must be exactly
  `%LOCALAPPDATA%\Android\jdk17` and `%LOCALAPPDATA%\Android\Sdk`).
- `link.exe not found` → the Visual Studio Build Tools C++ workload (step 2).

## Making a release from this PC

The same steps as on the main PC (also in `docs/RELEASING.md`):

1. `git pull` first, every time. Only one PC releases a given version.
2. Bump the version (the middle number for new features, the last number for fixes) in:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/hook/Cargo.toml`
   - `src-tauri/Cargo.lock`: the `version` lines under `name = "desk-companion"` and
     `name = "companion-hook"` only

   Add the `CHANGELOG.md` entry at the top.
3. If the Android app changed, raise `versionCode` (it must always go up) and `versionName` in
   `android/app/build.gradle.kts`.
4. Commit and push. The script refuses to publish with uncommitted changes or when the branch is
   behind.
5. Build and publish:
   ```powershell
   node scripts/release.mjs --github alexmercer500/Desk-comp-releases --publish
   ```
   Add `--skip-android` when only Windows changed (the current APK is carried over), or
   `--skip-windows` when only Android changed.
6. Copy the new installer and APK from `release\<version>\` into `current-build\` (delete the old
   ones there), update `current-build\README.md`, then commit and push.
7. Check: the release page shows the new version as **Latest**, and `Check now` in an installed
   copy offers it.

## Keeping both PCs in step

- `git pull` before starting anything, `git push` right after.
- Never run a release on both PCs for the same version. The script refuses an existing tag, but
  two PCs building at once can still collide.
- If a key ever changes on one PC (it shouldn't), the other PC is out of date. The check script
  shows it.
