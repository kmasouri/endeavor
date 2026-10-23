FROM node:26-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
RUN npm run build

FROM node:26-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY db ./db

# Agents' files, one folder per task. Docker Compose keeps this in a volume.
RUN mkdir -p /app/workspaces && chown node:node /app/workspaces
ENV WORKSPACES_DIR=/app/workspaces

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
