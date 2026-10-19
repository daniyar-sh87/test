FROM node:22-slim

WORKDIR /app

# better-sqlite3 ships prebuilt binaries for Debian/glibc; build tools are a fallback
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Use the headers bundled in the node image so node-gyp needs no download
# (behind TLS-intercepting proxies the nodejs.org / GitHub fetches fail).
RUN npm_config_nodedir=/usr/local npm ci --omit=dev

COPY . .

ENV PORT=3000 \
    DB_PATH=/app/data/opportunity-desk.db
VOLUME /app/data
EXPOSE 3000

CMD ["node", "server/index.js"]
