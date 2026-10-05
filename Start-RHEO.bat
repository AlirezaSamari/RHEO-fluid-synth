@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  py run_local.py
) else (
  python run_local.py
)
pause
