# AI Trainer Community

AI Trainer Community is an open-source, local-first exam practice and training web app for AI trainer exam preparation. It is built with FastAPI, SQLite, Vue, and Jupyter kernels.

This community edition includes a complete runnable system framework:

- Theory question practice with local progress tracking
- Code-operation practice with per-question workspaces
- A small sample question bank and sample CSV dataset
- Docker Compose startup for local deployment

The public repository intentionally does not include private deployment files, buyer watermarking, WeChat gating, internal AI grading workers, production IPs, local machine paths, tokens, or the full training question bank.

For the complete question bank, classroom deployment package, or commercial support, please contact the project author.

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

## Content

Sample content lives under `data/`:

- `data/questions.json` for theory questions
- `data/operations.json` for operation metadata
- `data/questions/<operation_id>/` for files used by a code operation

Large model files and private datasets are excluded by `.gitignore`.

This repository is meant to show the system, data format, and local deployment flow. You can add your own original or licensed questions by editing the JSON files above and placing operation assets under `data/questions/<operation_id>/`.

## Security Notes

Do not commit `.env`, SQLite databases, logs, model weights, credentials, or exported user data. Any external AI grading or SSO integration should be added as an opt-in integration that reads credentials from environment variables or a private secret manager.
