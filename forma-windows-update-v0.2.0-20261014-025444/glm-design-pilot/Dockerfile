FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-bookworm-slim AS app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/data
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]

FROM node:24-bookworm-slim AS renderer
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright RENDER_PORT=8081 HOME=/tmp
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
RUN npx playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-impress libreoffice-writer poppler-utils fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright
COPY --chown=node:node . .
USER node
EXPOSE 8081
CMD ["node", "renderer.cjs"]
