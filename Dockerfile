# ---- Stage 1: Build the frontend (Vite → static files) ----
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Install backend dependencies (includes tsx for runtime) ----
FROM node:22-slim AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./

# ---- Stage 3: Production runtime (single Express process) ----
FROM node:22-slim AS runtime

# Backend source + dependencies
WORKDIR /app/backend
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./
COPY backend/src ./src
COPY backend/tsconfig.json ./

# Built frontend served by Express
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production
ENV DATA_DIR=/data
# PORT is provided by the platform (e.g. Render). Fallback to 4000 in code.
ENV FRONTEND_DIST=/app/frontend/dist

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const p=process.env.PORT||4000;fetch('http://localhost:'+p+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/server.ts"]
