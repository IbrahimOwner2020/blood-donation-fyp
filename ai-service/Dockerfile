# syntax=docker/dockerfile:1
FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-cache --no-dev

COPY app ./app
RUN mkdir -p /app/models

ENV MODEL_DIR=/app/models \
    DEFAULT_FORECAST_HORIZON=7 \
    MIN_TRAINING_ROWS=30 \
    PATH="/app/.venv/bin:$PATH"

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD python -c "import os, urllib.request; port = os.getenv('PORT', '8000'); urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=5)"

CMD ["sh", "-c", "exec fastapi run app/main.py --host 0.0.0.0 --port ${PORT:-8000}"]
