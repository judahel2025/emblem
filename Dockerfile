# Stage 1 — build the Svelte frontend
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2 — Python backend (serves the built frontend same-origin)
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/backend \
    EMBLEM_CLOUD=1 \
    EMBLEM_BASE=/data \
    MPLBACKEND=Agg

COPY backend/requirements-cloud.txt ./requirements-cloud.txt
RUN pip install -r requirements-cloud.txt

COPY backend /app/backend
COPY --from=frontend-build /frontend/dist /app/frontend/dist

RUN mkdir -p /data

EXPOSE 8788
CMD ["sh", "-c", "python -m uvicorn emblem.api.app:app --host 0.0.0.0 --port ${PORT:-8788}"]
