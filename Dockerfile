# Reproducible standalone container image for Herma (Python FastAPI + SQLite WAL).
# Build: docker build -t herma-shim:local .
# Run:   docker run --rm -p 7730:7730 herma-shim:local
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    HERMA_DB=/data/herma.db \
    HERMA_PUBLIC_URL=http://127.0.0.1:7730

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /data

COPY --from=ghcr.io/astral-sh/uv:0.6.6 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock README.md LICENSE ./
COPY herma ./herma
COPY examples ./examples
COPY architecture.json llms.txt llms-full.txt ./

RUN uv sync --frozen --no-dev \
    && uv run herma seed

EXPOSE 7730

CMD ["uv", "run", "herma", "serve", "--host", "0.0.0.0", "--port", "7730"]
