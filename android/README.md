# Desk Companion for Android

The phone side of Desk Companion: see your coding agents, get a notification when one finishes or needs you, Allow or Deny from the lock screen, and reply when a task is done.

**Status: 0.1.0.** Links to the PC over the local network (Settings → Link a computer: scan the code from the PC's Settings → Phone). Once linked it shows the PC's sessions, notifies you when an agent needs you or finishes, and Allow / Deny go to the agent. Until linked, it shows samples. Not yet: the fingerprint check before Allow, answering questions, replying to a finished task (see `ROADMAP.md`, "Android companion"). The protocol is `docs/PHONE_LINK.md`.

Native Kotlin and Jetpack Compose. The font is Outfit (SIL Open Font License, `licenses/`).

## Build

No Android Studio needed. The build uses a JDK 17 and the Android command-line SDK installed under `%LOCALAPPDATA%\Android` (`jdk17`, `Sdk`, `gradle`):

```
build.cmd assembleDebug        # app\build\outputs\apk\debug\app-debug.apk
build.cmd testDebugUnitTest
```

`local.properties` (not committed) points Gradle at the SDK: `sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk`.

Install the APK by copying it to the phone and opening it (allow "install unknown apps" for your file manager or browser once), or with USB debugging on: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb install -r app\build\outputs\apk\debug\app-debug.apk`.

## Layout

| Folder | What |
|---|---|
| `app/src/main/kotlin/.../model` | `Models.kt`, `AppState.kt` (sessions, decisions, settings, demo data; unit-tested) |
| `.../ui` | `Theme.kt` (colours, type), `Components.kt`, `MoodOrb.kt` (the face), one file per screen |
| `.../notify` | channels, the sample approval notification, the Deny button |

## Emulator (for checking the screens)

A Pixel 7 emulator (`desk`, Android 15, hardware-accelerated with WHPX) is installed too:

```
%LOCALAPPDATA%\Android\Sdk\emulator\emulator -avd desk                       # with a window
%LOCALAPPDATA%\Android\Sdk\emulator\emulator -avd desk -no-window -gpu swiftshader_indirect   # headless
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb exec-out screencap -p > shot.png
adb shell cmd uimode night yes        # dark mode
```
