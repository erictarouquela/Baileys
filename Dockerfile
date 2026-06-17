# ============================================================================
# Baileys Web Panel — Docker Image
# ============================================================================

FROM node:20-slim

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
	bash \
	ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Build Baileys (parent project)
# ---------------------------------------------------------------------------
# Copy everything needed for the build -- the "prepare" script in package.json
# runs "npm run build" (tsc), so source files must be present during yarn install
COPY package.json yarn.lock .yarnrc.yml tsconfig.json tsconfig.build.json ./
COPY src/ ./src/
COPY WAProto/ ./WAProto/

RUN corepack enable \
	&& corepack prepare yarn@4.9.2 --activate \
	&& yarn --version \
	&& yarn install \
	&& yarn build

# ---------------------------------------------------------------------------
# Build Web Panel
# ---------------------------------------------------------------------------
COPY web-panel/package.json web-panel/tsconfig.json ./web-panel/
WORKDIR /app/web-panel
RUN npm install
COPY web-panel/src/ ./src/
RUN npm run build

# Copy static frontend files to lib output (not compiled by tsc)
COPY web-panel/src/public ./web-panel/lib/public

WORKDIR /app

# ---------------------------------------------------------------------------
# Runtime configuration
# ---------------------------------------------------------------------------

VOLUME ["/app/data"]

EXPOSE 3000

ENV NODE_ENV=production
ENV INSTANCES_DIR=/app/data/instances

CMD ["node", "web-panel/lib/server.js"]
