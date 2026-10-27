FROM python:3.12-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.6.6 /uv /usr/local/bin/uv
COPY tessera /app/tessera
COPY herma /app/herma
WORKDIR /app/herma
RUN uv sync --frozen --no-dev
EXPOSE 7730
CMD ["uv", "run", "herma", "serve", "--host", "0.0.0.0", "--port", "7730"]
