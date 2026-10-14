@echo off
setlocal
cd /d "%~dp0"
set "PILOT_NODE=%~dp0runtime\node.exe"
if not exist "%PILOT_NODE%" set "PILOT_NODE=node"
"%PILOT_NODE%" scripts\windows.cjs --check
pause
