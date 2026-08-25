FROM node:26-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# GitHub Packages auth comes in as a BuildKit secret (the release workflow
# passes --secret id=npmrc) so the token never lands in a layer or in image
# metadata. Local builds: --secret id=npmrc,src=$HOME/.npmrc
# Install dependencies (ignore scripts to prevent premature builds)
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci --ignore-scripts

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Prune dev dependencies in builder stage (has auth)
RUN npm prune --omit=dev

# Production stage
FROM node:26-alpine

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV AUTH_MODE=gateway
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8080

# Create non-root user
RUN addgroup -g 1001 -S mcp && adduser -u 1001 -S mcp -G mcp

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Add OCI labels for GHCR repository linking
LABEL org.opencontainers.image.source=https://github.com/WYRE-AI/blackpoint-mcp
LABEL org.opencontainers.image.description="MCP server for Blackpoint Cyber CompassOne"
LABEL org.opencontainers.image.version="0.1.0"
LABEL io.modelcontextprotocol.server.name="io.github.WYRE-AI/blackpoint-mcp"

# Switch to non-root user
USER mcp

# Expose HTTP port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1

# Start the server
CMD ["node", "dist/index.js"]