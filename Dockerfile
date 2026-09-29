# ---- Stage 1: Build the frontend (Vite → static files) ----
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Install backend dependencies (includes tsx) ----
FROM node:22-slim AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./

# ---- Stage 3: Production runtime (nginx + node backend) ----
FROM node:22-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

# Backend source + dependencies
WORKDIR /app/backend
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./
COPY backend/src ./src
COPY backend/tsconfig.json ./

# Built frontend served by nginx
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

# Nginx config: serve SPA + proxy /api to the backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Entrypoint: start backend, then nginx in foreground
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
