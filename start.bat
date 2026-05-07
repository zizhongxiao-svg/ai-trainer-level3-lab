@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul

if exist "ai-trainer-level3-lab.tar.gz" (
  echo Importing packaged Docker image...
  docker load -i "ai-trainer-level3-lab.tar.gz"
  if errorlevel 1 (
    echo Failed to import ai-trainer-level3-lab.tar.gz.
    pause
    exit /b 1
  )
) else (
  docker image inspect ai-trainer-level3-lab:latest >nul 2>nul
  if errorlevel 1 (
    echo Image ai-trainer-level3-lab:latest not found, and ai-trainer-level3-lab.tar.gz is missing.
    pause
    exit /b 1
  )
)

docker compose up -d

set "HOST_PORT=8097"
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /I "%%A"=="HOST_PORT" set "HOST_PORT=%%B"
)
if "!HOST_PORT!"=="" set "HOST_PORT=8097"

echo.
echo AI Trainer Level 3 Lab 已启动： http://localhost:!HOST_PORT!
start http://localhost:!HOST_PORT!
pause
