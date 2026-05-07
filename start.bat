@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul

if exist "ai-trainer-community.tar.gz" (
  echo Importing packaged Docker image...
  docker load -i "ai-trainer-community.tar.gz"
  if errorlevel 1 (
    echo Failed to import ai-trainer-community.tar.gz.
    pause
    exit /b 1
  )
) else (
  docker image inspect ai-trainer-community:latest >nul 2>nul
  if errorlevel 1 (
    echo Image ai-trainer-community:latest not found, and ai-trainer-community.tar.gz is missing.
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
echo AI Trainer Community 已启动： http://localhost:!HOST_PORT!
start http://localhost:!HOST_PORT!
pause
