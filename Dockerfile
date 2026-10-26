FROM node:26-alpine AS build

WORKDIR /app

# Each workspace's package.json first, so dependencies are cached until one of them changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/executor/package.json ./apps/executor/
RUN npm ci

COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY apps/executor ./apps/executor
RUN npm run build

FROM node:26-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Only the API's production dependencies. The web interface ships as built files.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/executor/package.json ./apps/executor/
RUN npm ci --omit=dev --workspace apps/api && npm cache clean --force

# Same folder layout as the repo, so the API finds apps/web/dist and apps/api/db.
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY apps/api/db ./apps/api/db

# Agents' files, one folder per task. Docker Compose keeps this in a volume.
RUN mkdir -p /app/workspaces && chown node:node /app/workspaces
ENV WORKSPACES_DIR=/app/workspaces

USER node

WORKDIR /app/apps/api

EXPOSE 3000

CMD ["node", "dist/index.js"]
