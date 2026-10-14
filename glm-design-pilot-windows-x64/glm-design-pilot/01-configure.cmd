@echo off
setlocal
cd /d "%~dp0"
set "PILOT_NODE=%~dp0runtime\node.exe"
if not exist "%PILOT_NODE%" set "PILOT_NODE=node"
"%PILOT_NODE%" scripts\windows.cjs --setup
if errorlevel 1 goto failed
notepad.exe "%~dp0.env"
exit /b 0
:failed
echo.
echo Configuration failed. Read the error above and START-HERE-WINDOWS.txt.
pause
exit /b 1
