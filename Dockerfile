# ============================================
# TRAD Sniper Bot - Production Dockerfile
# ============================================

FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production=false

# Build TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS production

WORKDIR /app

# Security: run as non-root user
RUN addgroup -S botuser && adduser -S botuser -G botuser

# Install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --production && npm cache clean --force

# Copy built output
COPY --from=builder /app/dist ./dist

# Create data and logs directories
RUN mkdir -p data logs .vault && chown -R botuser:botuser /app

USER botuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3847/health || exit 1

EXPOSE 3847

CMD ["node", "dist/index.js"]
