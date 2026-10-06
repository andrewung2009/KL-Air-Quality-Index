; KL AQI - one-click Windows build (silent)
;
; Double-click behaviour:
;   1st run : extract app to %LOCALAPPDATA%\KL AQI, create Desktop and
;             Startup shortcuts, launch the widget.
;   later   : in-place upgrade - stops a running instance, refreshes the
;             files and shortcuts, relaunches. Runtime state lives in
;             %APPDATA%\aqi-overlay and is never touched.
;
; Compile (normally via `npm run dist`, which also passes VERSION):
;   makensis /DPAYLOAD_DIR=... /DICON_FILE=... /DOUT_FILE=... /DVERSION=x.y.z installer.nsi

!ifndef PAYLOAD_DIR
  !define PAYLOAD_DIR "..\payload"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "KL-AQI.exe"
!endif
!ifndef ICON_FILE
  !define ICON_FILE "..\icon.ico"
!endif
!ifndef VERSION
  !define VERSION "1.0.1"
!endif

Name "KL AQI"
OutFile "${OUT_FILE}"
Icon "${ICON_FILE}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "KL AQI"
VIAddVersionKey /LANG=0 "FileDescription" "KL AQI Air Quality Overlay"
VIAddVersionKey /LANG=0 "CompanyName" "KL AQI"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "LegalCopyright" "MIT License (c) 2026 andrewung2009"

RequestExecutionLevel user
SilentInstall silent
InstallDir "$LOCALAPPDATA\KL AQI"
SetCompressor /SOLID lzma
AutoCloseWindow true
ShowInstDetails nevershow

Section "Install"
  ; stop a running copy so its files can be replaced (in-place upgrade)
  ExecWait 'cmd /c taskkill /f /im "KL AQI.exe" >nul 2>&1'
  ExecWait 'cmd /c ping -n 2 127.0.0.1 >nul'

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD_DIR}\*.*"

  CreateShortCut "$DESKTOP\KL AQI.lnk" "$INSTDIR\KL AQI.exe" "" "$INSTDIR\KL AQI.exe" 0 SW_SHOWNORMAL "" "KL AQI air quality overlay widget"
  CreateShortCut "$SMSTARTUP\KL AQI.lnk" "$INSTDIR\KL AQI.exe" "" "$INSTDIR\KL AQI.exe" 0 SW_SHOWNORMAL "" "KL AQI air quality overlay widget"

  Exec "$INSTDIR\KL AQI.exe"
SectionEnd
