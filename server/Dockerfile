# Portable server image — runs unchanged on Fly.io, Railway, Render, or any VPS
# with Docker. Deliberately host-agnostic so the hosting decision stays open.
#
# Build from the REPO ROOT, not from server/, because the server imports the
# @pollen/shared workspace:
#   docker build -f server/Dockerfile -t pollen-server .

# --- build stage ----------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# Copy only manifests first so `npm ci` is cached until a dependency changes.
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --workspaces --include-workspace-root

COPY shared ./shared
COPY server ./server
RUN npm run build:shared && npm run build -w @pollen/server

# --- runtime stage --------------------------------------------------------
# Fresh stage with production deps only: no TypeScript, no vitest, no client.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json .npmrc ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
RUN npm ci --omit=dev --workspace @pollen/server --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/dist ./server/dist

# Colyseus needs a long-lived process holding sticky WebSocket connections, so
# this must NOT be deployed to a scale-to-zero or request-scoped platform.
EXPOSE 2567
ENV PORT=2567

# Don't run as root.
USER node

# /health is served by express (see server/src/main.ts) for platform liveness
# probes; the WebSocket endpoint is on the same port.
CMD ["node", "server/dist/main.js"]
