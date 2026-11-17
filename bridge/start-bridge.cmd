@echo off
rem Double-click to bring the Bluetooth MIDI bridge up and check it (see start-bridge.ps1).
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-bridge.ps1" %*
set code=%errorlevel%
if not "%code%"=="0" (
    echo.
    pause
) else (
    rem all is well: leave the report on the screen for a moment, then close
    timeout /t 6 >nul 2>nul
)
exit /b %code%
