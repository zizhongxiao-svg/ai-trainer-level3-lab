#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

[ -f .env ] || cp .env.example .env

if [ -f ai-trainer-level3-lab.tar.gz ]; then
  echo "Importing packaged Docker image..."
  docker load -i ai-trainer-level3-lab.tar.gz
else
  if ! docker image inspect ai-trainer-level3-lab:latest >/dev/null 2>&1; then
    echo "Image ai-trainer-level3-lab:latest not found, and ai-trainer-level3-lab.tar.gz is missing."
    exit 1
  fi
fi

docker compose up -d
HOST_PORT="$(awk -F= '/^HOST_PORT=/{print $2; exit}' .env 2>/dev/null || true)"
HOST_PORT="${HOST_PORT:-8097}"
echo
echo "AI Trainer Level 3 Lab 已启动： http://localhost:${HOST_PORT}"
echo "历史记录保存在当前目录的 persist/ 中，请勿删除该目录。"
command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:${HOST_PORT}" >/dev/null 2>&1 || true
