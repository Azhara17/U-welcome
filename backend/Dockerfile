# Сборка из корня монорепо: docker build -f backend/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend --include-workspace-root=false
COPY backend backend
RUN npm run build -w backend

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend --omit=dev --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY backend/drizzle backend/drizzle
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
