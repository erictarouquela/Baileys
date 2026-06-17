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
# Copy all files needed for the build
COPY package.json ./
COPY src/ ./src/
COPY WAProto/ ./WAProto/
COPY tsconfig.json tsconfig.build.json ./

# Use npm instead of yarn -- npm install does NOT run the "prepare" script,
# avoiding the build failure. We run the build explicitly afterwards.
RUN npm install \
	&& npm run build

# ---------------------------------------------------------------------------
# Build Web Panel
# ---------------------------------------------------------------------------
COPY web-panel/package.json web-panel/tsconfig.json ./web-panel/
WORKDIR /app/web-panel
RUN npm install
COPY web-panel/src/ ./src/
RUN npm run build

# Copy static frontend files to lib output (not compiled by tsc)
COPY web-panel/src/public ./lib/public

WORKDIR /app

# ---------------------------------------------------------------------------
# Runtime configuration
# ---------------------------------------------------------------------------

VOLUME ["/app/data"]

EXPOSE 3000

ENV NODE_ENV=production
ENV INSTANCES_DIR=/app/data/instances

CMD ["node", "web-panel/lib/server.js"]
