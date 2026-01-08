# Use an existing image as the base
FROM mcr.microsoft.com/devcontainers/rust:2-1-trixie

# Install libclang and other necessary tools
RUN apt-get update && apt-get install -y \
    libclang-dev \
    clang \
    clang-tools \
    && rm -rf /var/lib/apt/lists/*
