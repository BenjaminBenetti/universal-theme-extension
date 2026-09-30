FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium chromium-sandbox \
    && rm -rf /var/lib/apt/lists/*
