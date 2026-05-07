#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

VERSION="${1:-$(date +%Y%m%d)}"
OUT="dist/ai-trainer-community-v${VERSION}"

echo "[1/6] Generating empty seed DB"
python3 scripts/build_release_db.py

echo "[2/6] Building Docker image"
docker build -t ai-trainer-community:latest .

echo "[3/6] Saving image to tar.gz"
rm -rf "$OUT"
mkdir -p "$OUT"
docker save ai-trainer-community:latest | gzip -1 > "$OUT/ai-trainer-community.tar.gz"

echo "[4/6] Copying release files"
cp docker-compose.yml .env.example README.md start.sh start.bat stop.sh stop.bat "$OUT/"
mv "$OUT/start.sh" "$OUT/启动.sh"
mv "$OUT/start.bat" "$OUT/启动.bat"
mv "$OUT/stop.sh" "$OUT/停止.sh"
mv "$OUT/stop.bat" "$OUT/停止.bat"
chmod +x "$OUT/启动.sh" "$OUT/停止.sh"

echo "[5/6] Writing first-run note"
cat > "$OUT/首次运行说明.txt" <<'EOF'
首次运行直接执行：
  Windows：双击 启动.bat
  Mac / Linux：运行 ./启动.sh

启动脚本会自动导入 ai-trainer-community.tar.gz 镜像，然后启动服务。
启动完成后访问：http://localhost:8097
EOF

echo "[6/6] Creating zip bundle"
(cd dist && rm -f "ai-trainer-community-v${VERSION}.zip" && zip -qr "ai-trainer-community-v${VERSION}.zip" "ai-trainer-community-v${VERSION}")

echo
echo "Done. Bundle dir: $OUT/"
du -sh "$OUT" "dist/ai-trainer-community-v${VERSION}.zip"
