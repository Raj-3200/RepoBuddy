# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS build
WORKDIR /app

# Deps layer (cached when lockfile unchanged).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Build without type-check against whatever is installed; the CI/typecheck
# stage runs `npm run typecheck` separately so image builds stay fast.
RUN npm run build:nocheck

FROM nginx:alpine AS runtime
RUN apk add --no-cache curl
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD curl -fsS http://127.0.0.1:3000/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
