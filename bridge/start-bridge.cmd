@echo off
rem Double-click to bring the Bluetooth MIDI bridge up (see start-bridge.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-bridge.ps1" %*
if errorlevel 1 pause
