#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

[ -f .env ] || cp .env.example .env

if [ -f ai-trainer-community.tar.gz ]; then
  echo "Importing packaged Docker image..."
  docker load -i ai-trainer-community.tar.gz
else
  if ! docker image inspect ai-trainer-community:latest >/dev/null 2>&1; then
    echo "Image ai-trainer-community:latest not found, and ai-trainer-community.tar.gz is missing."
    exit 1
  fi
fi

docker compose up -d
HOST_PORT="$(awk -F= '/^HOST_PORT=/{print $2; exit}' .env 2>/dev/null || true)"
HOST_PORT="${HOST_PORT:-8097}"
echo
echo "AI Trainer Community 已启动： http://localhost:${HOST_PORT}"
command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:${HOST_PORT}" >/dev/null 2>&1 || true
