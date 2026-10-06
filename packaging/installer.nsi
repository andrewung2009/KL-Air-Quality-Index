; KL AQI - one-click Windows build (silent)
;
; Double-click behaviour:
;   1st run : extract app to %LOCALAPPDATA%\KL AQI, create Desktop and
;             Startup shortcuts, launch the widget.
;   later   : just launch the widget (existing install is left alone, so a
;             running instance is never overwritten).
; Upgrade  : delete %LOCALAPPDATA%\KL AQI and run the exe again.
;
; Compile (payload/icon/out are passed in by the build):
;   makensis /DPAYLOAD_DIR=... /DICON_FILE=... /DOUT_FILE=... installer.nsi

!ifndef PAYLOAD_DIR
  !define PAYLOAD_DIR "..\payload"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "KL-AQI.exe"
!endif
!ifndef ICON_FILE
  !define ICON_FILE "..\icon.ico"
!endif

Name "KL AQI"
OutFile "${OUT_FILE}"
Icon "${ICON_FILE}"
VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=0 "ProductName" "KL AQI"
VIAddVersionKey /LANG=0 "FileDescription" "KL AQI Air Quality Overlay"
VIAddVersionKey /LANG=0 "CompanyName" "KL AQI"
VIAddVersionKey /LANG=0 "FileVersion" "1.0.0.0"
VIAddVersionKey /LANG=0 "LegalCopyright" "MIT License (c) 2026 andrewung2009"

RequestExecutionLevel user
SilentInstall silent
InstallDir "$LOCALAPPDATA\KL AQI"
SetCompressor /SOLID lzma
AutoCloseWindow true
ShowInstDetails nevershow

Section "Install"
  IfFileExists "$INSTDIR\KL AQI.exe" launch

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD_DIR}\*.*"

  CreateShortCut "$DESKTOP\KL AQI.lnk" "$INSTDIR\KL AQI.exe" "" "$INSTDIR\KL AQI.exe" 0 SW_SHOWNORMAL "" "KL AQI air quality overlay widget"
  CreateShortCut "$SMSTARTUP\KL AQI.lnk" "$INSTDIR\KL AQI.exe" "" "$INSTDIR\KL AQI.exe" 0 SW_SHOWNORMAL "" "KL AQI air quality overlay widget"

launch:
  Exec "$INSTDIR\KL AQI.exe"
SectionEnd
