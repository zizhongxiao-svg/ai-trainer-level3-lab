# AI Trainer Level 3 Lab

AI Trainer Level 3 Lab 是一个面向 **人工智能训练师三级** 备考的本地 Web 练习系统，包含理论题刷题、操作题练习、进度记录和 Docker 本地部署。项目使用 FastAPI、SQLite、Vue、Docker 和 Jupyter kernels 构建。

本仓库包含完整可运行系统：

- 900 道理论题
- 40 道操作题
- 理论题刷题、错题、随机练习、本地进度记录
- 操作题独立工作区和题目附件管理
- 操作题所需 CSV/XLSX 数据集、Notebook、DOCX、图片和 ONNX 模型文件
- Docker Compose 一键本地启动

本公开仓库不包含私有部署配置、私有授权标识、公众号关注门禁、内部 AI 判卷 worker、生产 IP、本地机器路径、token、班级名单、学员记录、SQLite 运行数据库或日志。

## Quick Start

推荐使用 Docker 方式运行，Windows、macOS、Linux 都一致。

### 1. 安装依赖

先安装：

- Git
- Docker Desktop 或 Docker Engine
- Docker Compose v2

检查命令：

```bash
git --version
docker --version
docker compose version
```

### 2. 下载项目

```bash
git clone https://github.com/zizhongxiao-svg/ai-trainer-level3-lab.git
cd ai-trainer-level3-lab
```

仓库包含 ONNX 模型文件，首次 clone 会比较慢。

### 3. 启动系统

```bash
cp .env.example .env
docker compose up --build
```

浏览器打开：

```text
http://localhost:8097
```

第一次进入时注册一个本地账号即可使用。账号、答题记录、进度会保存在本地 `persist/trainer.db`。

### 4. 停止系统

```bash
docker compose down
```

再次启动：

```bash
docker compose up
```

## Docker Compose YAML

仓库已内置 `docker-compose.yml`。如果你只想复制一份最小配置，可以使用下面这份：

```yaml
name: ai-trainer-level3-lab

services:
  trainer:
    image: ai-trainer-level3-lab:latest
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ai-trainer
    restart: unless-stopped
    ports:
      - "${HOST_PORT:-8097}:8097"
    environment:
      TRAINER_EDITION: "${TRAINER_EDITION:-community}"
      TRAINER_DB_PATH: /app/persist/trainer.db
      TRAINER_DATA_DIR: /app/persist
      TRAINER_QUESTIONS_PATH: /app/data/questions.json
      TRAINER_OPERATIONS_PATH: /app/data/operations.json
      TRAINER_DISABLED_FEATURES: "${TRAINER_DISABLED_FEATURES:-}"
      TZ: "${TZ:-Asia/Shanghai}"
      WEB_CONCURRENCY: "1"
    volumes:
      - ./persist:/app/persist
    healthcheck:
      test: ["CMD-SHELL", "python3 -c \"import urllib.request,sys;urllib.request.urlopen('http://127.0.0.1:8097/api/edition',timeout=3);sys.exit(0)\" || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
```

常用命令：

```bash
docker compose up --build
docker compose down
```

如果只是使用离线包，启动脚本会先导入 `ai-trainer-level3-lab.tar.gz`，再执行 `docker compose up -d`。

如果你自己写 `docker run` 命令，也必须挂载持久化目录：

```bash
docker run -d \
  --name ai-trainer \
  -p 8097:8097 \
  -e TRAINER_DB_PATH=/app/persist/trainer.db \
  -e TRAINER_DATA_DIR=/app/persist \
  -v "$PWD/persist:/app/persist" \
  ai-trainer-level3-lab:latest
```

## How To Use

### 理论题练习

1. 打开 `http://localhost:8097`
2. 注册或登录本地账号
3. 进入「理论题库」
4. 选择练习模式，例如顺序练习、随机练习、错题练习
5. 提交答案后查看解析和本地进度

### 操作题练习

1. 登录后进入「操作题」
2. 选择题目
3. 查看题目说明和附件文件
4. 在题目工作区中使用 Notebook、数据集、模型文件完成练习

操作题文件在仓库中的位置：

```text
data/questions/<operation_id>/
```

例如操作题 26 的模型和图片文件在：

```text
data/questions/26/
```

### 数据保存位置

Docker 运行时，本地数据默认保存在：

```text
persist/trainer.db
```

同时会在同一目录生成：

```text
persist/secret.key
```

`trainer.db` 保存账号、理论题记录、操作题草稿、提交记录和进度；`secret.key` 用于保持登录 token 的签名稳定。

关闭系统不会清空数据：

```bash
docker compose down
docker compose up
```

只要你仍然在同一个项目目录里启动，历史记录会继续保留。

会变成“全新系统”的常见原因：

- 删除了 `persist/` 或 `persist/trainer.db`
- 每次都重新解压到一个新目录启动
- 从另一个 clone 目录启动
- 手动修改了 `TRAINER_DB_PATH`
- 使用了没有挂载 `/app/persist` 的自定义 `docker run`

不要把 `persist/` 提交到 Git。

### 备份和迁移历史记录

备份前先停止服务：

```bash
docker compose down
```

然后备份整个 `persist/` 目录。Linux/macOS：

```bash
tar -czf ai-trainer-level3-lab-data-backup.tar.gz persist
```

Windows PowerShell：

```powershell
Compress-Archive -Path .\persist -DestinationPath .\ai-trainer-level3-lab-data-backup.zip
```

迁移到另一台机器时，把项目目录和 `persist/` 一起复制过去，再运行：

```bash
docker compose up
```

如果只复制代码、不复制 `persist/`，新机器会生成一个空数据库，看起来就是全新的系统。

## Windows Notes

Windows 推荐使用 Docker Desktop。启动前确认 Docker Desktop 已经运行。

如果遇到端口被占用，可以修改 `.env`：

```env
HOST_PORT=18097
```

然后重新启动：

```bash
docker compose up
```

如果操作题附件显示找不到，优先检查 `docker-compose.yml` 中的路径配置是否保持为容器路径：

```yaml
TRAINER_QUESTIONS_PATH: /app/data/questions.json
TRAINER_OPERATIONS_PATH: /app/data/operations.json
TRAINER_DB_PATH: /app/persist/trainer.db
```

不要把这些值改成本机 Windows 路径。

## Offline Package

如果要打包成离线包：

```bash
./build_release.sh
```

生成文件在 `dist/` 下。离线包会包含 Docker 镜像和启动脚本，适合没有开发环境的机器使用。

## Local Python Development

只想使用系统的用户不需要看这一节。开发者可以直接本地跑 FastAPI：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.server:app --reload --host 0.0.0.0 --port 8097
```

## Question Data

题目数据放在 `data/`：

- `data/questions.json`：理论题
- `data/operations.json`：操作题元数据
- `data/questions/<operation_id>/`：操作题附件

你可以按同样格式新增或替换题目。

## Troubleshooting

### Docker 启动慢

首次启动会构建镜像并安装 Python 依赖，时间较长。后续启动会快很多。

### GitHub 提示大文件

仓库包含接近 100MB 的 ONNX 模型文件，GitHub 可能提示大文件警告。这是操作题资产，不影响正常使用。

### 端口 8097 被占用

修改 `.env`：

```env
HOST_PORT=18097
```

然后访问：

```text
http://localhost:18097
```

### 想重置账号和答题记录

停止服务后删除本地数据库：

```bash
docker compose down
rm -f persist/trainer.db
docker compose up
```

Windows PowerShell：

```powershell
docker compose down
Remove-Item .\persist\trainer.db
docker compose up
```

## Security Notes

不要提交 `.env`、SQLite 数据库、日志、凭据、本地部署文件、班级名单或导出的用户数据。任何外部 AI 判卷或 SSO 集成都应作为可选功能实现，并从环境变量或私有密钥管理系统读取凭据。
