# Multi-stage build for WhatsApp Bot Service
FROM node:20-alpine AS builder

# Install build dependencies
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

# Install runtime dependencies for Baileys
# ffmpeg: Audio/video processing
# libwebp-tools: WebP image format support
# ca-certificates: SSL certificate validation
RUN apk add --no-cache \
    ffmpeg \
    libwebp-tools \
    ca-certificates

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create directories for WhatsApp auth state and user memory (mounted as volumes)
RUN mkdir -p auth_info_baileys memory

# Expose port for web server (Railway will set PORT env var)
EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Create entrypoint script to fix permissions and start app
RUN echo '#!/bin/sh\n\
chmod -R 777 /app/auth_info_baileys 2>/dev/null || true\n\
chmod -R 777 /app/memory 2>/dev/null || true\n\
exec node dist/index.js' > /entrypoint.sh && \
    chmod +x /entrypoint.sh

# Start with entrypoint that fixes permissions
CMD ["/entrypoint.sh"]
