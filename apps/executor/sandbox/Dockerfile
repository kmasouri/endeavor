FROM node:26-alpine
COPY apps/executor/sandbox/worker.mjs /sandbox/worker.mjs
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/sandbox/worker.mjs"]
