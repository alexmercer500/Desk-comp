; Desk Companion's additions to the Tauri NSIS installer.

; Before the app's files go: take out what it put elsewhere (the Claude Code
; hooks, the relay in %LOCALAPPDATA%\DeskCompanion, the start-with-Windows
; entry). Not when this uninstall is part of an update: the new version
; carries straight on, still connected.
!macro NSIS_HOOK_PREUNINSTALL
  ClearErrors
  ${GetOptions} $CMDLINE "/UPDATE" $R9
  ${If} ${Errors}
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-cleanup'
  ${EndIf}
  ClearErrors
!macroend
