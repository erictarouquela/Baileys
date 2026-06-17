# ============================================================================
# Baileys Web Panel — Docker Image
# ============================================================================

FROM node:20-slim

WORKDIR /app

# System dependencies (needed for native modules like whatsapp-rust-bridge)
RUN apt-get update && apt-get install -y --no-install-recommends \
	bash \
	ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Build Baileys (parent project)
# ---------------------------------------------------------------------------
COPY package.json yarn.lock .yarnrc.yml ./

# Enable Yarn 4 via Corepack
RUN corepack enable \
	&& corepack prepare yarn@4.9.2 --activate \
	&& yarn --version \
	&& yarn install

COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/
COPY WAProto/ ./WAProto/
RUN yarn build

# ---------------------------------------------------------------------------
# Build Web Panel
# ---------------------------------------------------------------------------
COPY web-panel/package.json web-panel/tsconfig.json ./web-panel/
WORKDIR /app/web-panel
RUN npm install
COPY web-panel/src/ ./src/
RUN npm run build

# Copy static frontend files to lib output
COPY web-panel/src/public ./web-panel/lib/public

WORKDIR /app

# ---------------------------------------------------------------------------
# Runtime configuration
# ---------------------------------------------------------------------------

# Persistent data for auth files
VOLUME ["/app/data"]

EXPOSE 3000

ENV NODE_ENV=production
ENV INSTANCES_DIR=/app/data/instances

CMD ["node", "web-panel/lib/server.js"]
