# AI Trainer Level 3 Lab

AI Trainer Level 3 Lab is an open-source, local-first practice system for 人工智能训练师三级 exam preparation. It is built with FastAPI, SQLite, Vue, Docker, and Jupyter kernels.

This repository includes a complete runnable training system:

- Theory question practice with local progress tracking
- Code-operation practice with per-question workspaces
- Full bundled question data for this project: 900 theory questions and 40 operation tasks
- Operation assets including CSV/XLSX datasets, notebooks, documents, images, and ONNX model files
- Docker Compose startup for local deployment

The public repository intentionally does not include private deployment files, buyer watermarking, WeChat gating, internal AI grading workers, production IPs, local machine paths, tokens, class rosters, learner records, SQLite databases, or logs.

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
http://localhost:8097
```

Register a local account on first use. Data is stored in `persist/trainer.db` when using Docker Compose.

## Local Python Development

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.server:app --reload --host 0.0.0.0 --port 8097
```

## Question Data

Question content lives under `data/`:

- `data/questions.json` for theory questions
- `data/operations.json` for operation metadata
- `data/questions/<operation_id>/` for files used by a code operation

You can add or replace questions by editing the JSON files above and placing operation assets under `data/questions/<operation_id>/`.

## Security Notes

Do not commit `.env`, SQLite databases, logs, credentials, local deployment files, class rosters, or exported user data. Any external AI grading or SSO integration should be added as an opt-in integration that reads credentials from environment variables or a private secret manager.
