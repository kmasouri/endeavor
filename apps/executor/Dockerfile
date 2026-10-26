FROM node:26-alpine
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/executor/package.json ./apps/executor/
RUN npm ci --omit=dev --workspace apps/executor && npm cache clean --force
COPY apps/executor/src ./apps/executor/src
WORKDIR /app/apps/executor
CMD ["node", "src/index.ts"]
