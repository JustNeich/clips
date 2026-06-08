FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV APP_DATA_DIR=/var/data/app
ENV CODEX_SESSIONS_DIR=/var/data/codex-sessions
ENV CODEX_BIN=/usr/local/bin/codex
ENV HOME=/home/clips
ENV XDG_CACHE_HOME=/home/clips/.cache
ENV XDG_CONFIG_HOME=/home/clips/.config
ENV XDG_DATA_HOME=/home/clips/.local/share
ENV XDG_STATE_HOME=/home/clips/.local/state
ENV PIP_ROOT_USER_ACTION=ignore

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    fonts-liberation \
    git \
    gosu \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    openssh-client \
    python3 \
    python3-pip \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp \
  && npm install -g @openai/codex \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system clips \
  && useradd --system --gid clips --home-dir /home/clips --create-home clips

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

RUN npx remotion browser ensure
RUN npm run build
RUN npm prune --omit=dev
RUN mkdir -p "$APP_DATA_DIR" "$CODEX_SESSIONS_DIR" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" \
  && chown -R clips:clips /var/data /home/clips \
  && if [ -d /usr/local/lib/node_modules/@openai ]; then chown -R clips:clips /usr/local/lib/node_modules/@openai; fi \
  && find /usr/local/bin -maxdepth 1 -name 'codex*' -exec chown -h clips:clips {} + \
  && chmod +x scripts/render-entrypoint.sh \
  && chmod -R go-w /app

ENV NODE_ENV=production

EXPOSE 10000

CMD ["/bin/sh", "scripts/render-entrypoint.sh"]
