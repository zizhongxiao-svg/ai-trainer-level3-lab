#!/usr/bin/env bash
# 启动前体检：若 TRAINER_SANDBOX=firejail，确认 firejail 已安装 + profile 存在。
set -euo pipefail

mode="${TRAINER_SANDBOX:-off}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
profile="${TRAINER_FIREJAIL_PROFILE:-$repo_root/infra/firejail/kernel.profile}"

if [[ "$mode" != "firejail" ]]; then
  echo "[sandbox] disabled (TRAINER_SANDBOX=$mode)"
  exit 0
fi

if ! command -v firejail >/dev/null 2>&1; then
  echo "[sandbox] ERROR: TRAINER_SANDBOX=firejail but firejail not installed. sudo dnf install firejail / apt install firejail" >&2
  exit 1
fi

if [[ ! -f "$profile" ]]; then
  echo "[sandbox] ERROR: profile not found: $profile" >&2
  exit 1
fi

echo "[sandbox] firejail $(firejail --version | head -1) · profile=$profile"

# Smoke-run: actually launch firejail with the profile against /bin/true
# to catch profile syntax errors early.
if ! firejail --quiet --profile="$profile" -- /bin/true >/dev/null 2>&1; then
  echo "[sandbox] ERROR: firejail failed to launch with profile=$profile" >&2
  echo "[sandbox] Re-run manually to see detail: firejail --profile=$profile -- /bin/true" >&2
  exit 1
fi
echo "[sandbox] smoke OK"
