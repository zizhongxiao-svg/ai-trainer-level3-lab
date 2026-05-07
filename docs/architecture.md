# Architecture

AI Trainer Level 3 Lab is a local-first FastAPI application.

- `app/`: backend routers, SQLite migrations, auth, operation sessions, and Jupyter kernel orchestration.
- `static/`: browser UI served as static assets.
- `data/questions.json`: theory question metadata.
- `data/operations.json`: operation question metadata.
- `data/questions/<id>/`: files mounted as the working directory for operation kernels.
- `persist/trainer.db`: runtime SQLite database when using Docker Compose.

The public edition disables collaborative and private deployment features by default, including chat, presence, class administration, feedback administration, WeChat gating, operation unlock gates, and bundled AI grading.
