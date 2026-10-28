@echo off
rem Double-click this file to install what MdPad needs and start it.
rem The real work is done by setup-windows.ps1 in the same folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1"
echo.
pause
