# 1. Node.js & npm aus dem offiziellen Image bereitstellen
FROM node:22-slim AS node-source

# 2. Basis: chromedp headless-shell
FROM chromedp/headless-shell:latest

# Node.js und npm Binarys & Libs übernehmen
COPY --from=node-source /usr/local/bin /usr/local/bin
COPY --from=node-source /usr/local/lib/node_modules /usr/local/lib/node_modules

# ca-certificates und procps für npx/Network und Prozessmanagement
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Unprivilegierten Benutzer anlegen
RUN groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser

WORKDIR /app

# Die Binary in chromedp/headless-shell liegt in /headless-shell/headless-shell
ENV CHROME_PATH=/headless-shell/headless-shell
ENV PUPPETEER_EXECUTABLE_PATH=/headless-shell/headless-shell

# Berechtigungen für Arbeitsverzeichnis setzen
RUN chown -R appuser:appuser /app /headless-shell

# Zu unprivilegiertem User wechseln
USER appuser

EXPOSE 9333

# Start via Supergateway (HTTP/SSE -> stdio)
ENTRYPOINT ["sh", "-c", "npx -y supergateway --port 9333 --stdio \"npx -y chrome-devtools-mcp@latest --headless --executable-path $CHROME_PATH\""]