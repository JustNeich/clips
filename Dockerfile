FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV APP_DATA_DIR=/var/data/app
ENV CODEX_SESSIONS_DIR=/var/data/codex-sessions
ENV CODEX_BIN=/usr/local/bin/codex

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    git \
    openssh-client \
    python3 \
    python3-pip \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp \
  && npm install -g @openai/codex \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npx remotion browser ensure
RUN npm run build

EXPOSE 10000

CMD ["/bin/sh", "-c", "mkdir -p \"$APP_DATA_DIR\" \"$CODEX_SESSIONS_DIR\" && npx next start -H 0.0.0.0 -p ${PORT:-10000}"]
