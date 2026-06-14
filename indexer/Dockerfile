# F25 email send-worker. Tiny long-running poller.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY email-indexer.js ./
# The IDL is mounted or copied at deploy; default path is /app/ayni.json.
ENV IDL_PATH=/app/ayni.json
ENV STATE_FILE=/data/indexer-state.json
VOLUME ["/data"]
CMD ["node", "email-indexer.js"]
