# Current builds

The latest installable builds, replaced whenever a fix needs new ones. They are built by the same release script as
what gets published on https://github.com/alexmercer500/Desk-comp-releases/releases, so these copies update
themselves from there.

| File | What |
| --- | --- |
| `DeskCompanion_0.17.0_x64-setup.exe` | Windows app 0.17.0 (no relay built in; each person runs their own, see `docs/RELAY.md`; checks for updates). Not code-signed yet: Windows may warn, choose More info, Run anyway. |
| `DeskCompanion-Android-0.5.3.apk` | Android app 0.5.3, signed with the release key (checks for updates). Phones with the older debug-signed 0.3.x must uninstall it once and pair again. |

What changed in each: `CHANGELOG.md`. How releases are made: `docs/RELEASING.md`.
