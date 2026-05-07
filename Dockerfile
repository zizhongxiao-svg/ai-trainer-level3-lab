FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=120

RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/
RUN pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --upgrade pip \
    && pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY app /app/app
COPY static /app/static
COPY data /app/data
COPY parse_questions.py parse_operations.py /app/
COPY scripts /app/scripts
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV TRAINER_EDITION=community \
    TRAINER_DB_PATH=/app/persist/trainer.db \
    TRAINER_DATA_DIR=/app/persist \
    TRAINER_QUESTIONS_PATH=/app/data/questions.json \
    TRAINER_OPERATIONS_PATH=/app/data/operations.json \
    TZ=Asia/Shanghai

EXPOSE 8097

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8097"]
