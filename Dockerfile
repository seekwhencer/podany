# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim

WORKDIR /app

# ca-certificates are required for outbound HTTPS (RSS feeds, Resend API).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy dependencies and a locally built node_modules so the build needs no
# network access, then bundle the modular frontend and prune dev deps for a
# lean runtime image. Regenerate node_modules with `npm ci` before building.
COPY package.json package-lock.json ./
COPY node_modules ./node_modules

# Copy application source and static frontend before bundling so esbuild can
# resolve its inputs.
COPY server/ ./server/
COPY public/ ./public/

RUN npm run build

RUN npm prune --omit=dev --no-audit --no-fund

ENV PORT=8788 \
    HOST=0.0.0.0

EXPOSE 8788

# Wait for MariaDB, apply the schema on startup, then start the Express server.
#COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
#RUN chmod +x /usr/local/bin/docker-entrypoint.sh

#ENTRYPOINT ["docker-entrypoint.sh"]
#CMD ["node", "server/server.js"]
