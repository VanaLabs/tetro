!include "LogicLib.nsh"

!macro NSIS_HOOK_PREINSTALL
  Push $R9
  ReadRegStr $R9 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $R9 == ""
  ${OrIf} $R9 < 22000
    MessageBox MB_OK|MB_ICONSTOP "Tetro Dev requires Windows 11."
    Pop $R9
    Abort
  ${EndIf}
  Pop $R9
!macroend
