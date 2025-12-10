# FFmpeg Video Rendering Service
# Optimized Alpine-based container for video stitching operations
#
# Features:
# - FFmpeg with all common codecs (h264, h265, vp9, av1)
# - Hardware acceleration support (where available)
# - Non-root user for security
# - Health checks for orchestration
# - Minimal image size (~250MB)
#
# Usage:
#   docker build -t video-rendering .
#   docker run -p 3001:3001 -v ./renders:/tmp/renders video-rendering

FROM node:20-alpine AS base

# Install FFmpeg and required dependencies
# Using Alpine's FFmpeg package which includes most codecs
RUN apk add --no-cache \
    ffmpeg \
    ffmpeg-libs \
    # Video codecs
    x264 \
    x264-libs \
    x265 \
    x265-libs \
    libvpx \
    # Audio codecs
    lame \
    lame-libs \
    opus \
    opus-libs \
    libvorbis \
    # Utilities
    curl \
    && rm -rf /var/cache/apk/*

# Verify FFmpeg installation
RUN ffmpeg -version && ffprobe -version

# Create app directory
WORKDIR /app

# Enable pnpm
RUN corepack enable pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source files
COPY . .

# Create required directories
RUN mkdir -p /tmp/renders /tmp/uploads /tmp/cache

# Create non-root user for security
RUN addgroup --system --gid 1001 ffmpeg && \
    adduser --system --uid 1001 ffmpeg && \
    chown -R ffmpeg:ffmpeg /app /tmp/renders /tmp/uploads /tmp/cache

# Switch to non-root user
USER ffmpeg

# Environment variables
ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV TEMP_DIR=/tmp/renders
ENV PORT=3001

# Health check
# Checks both the Node.js server and FFmpeg availability
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "poc/ffmpeg-server/index.ts"]

# Build stage for production (if needed)
# FROM base AS production
# RUN pnpm run build
# CMD ["node", "dist/index.js"]
