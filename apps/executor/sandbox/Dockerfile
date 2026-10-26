FROM node:26-alpine
RUN apk add --no-cache util-linux
COPY apps/executor/sandbox/worker.mjs /sandbox/worker.mjs
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/sandbox/worker.mjs"]
