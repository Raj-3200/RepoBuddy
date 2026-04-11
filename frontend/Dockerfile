FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb bunfig.toml ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN bun run build

# Production
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=base /app/.output .output
COPY --from=base /app/node_modules node_modules
COPY --from=base /app/package.json .

EXPOSE 3000
CMD ["bun", "run", ".output/server/index.mjs"]
