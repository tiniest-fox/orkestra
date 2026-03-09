FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git build-essential ca-certificates unzip gnupg \
    pkg-config libssl-dev \
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
    librsvg2-dev libxdo-dev && \
    rm -rf /var/lib/apt/lists/*
# Install GitHub CLI so agents can create PRs and interact with GitHub.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*
# Install Rust stable to /usr/local so it's available to all users (including uid 1000).
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path \
    --default-toolchain stable --profile default && \
    rm -rf /usr/local/rustup/toolchains/*/share/doc && \
    find /usr/local/rustup /usr/local/cargo -type d -exec chmod a+rx {} \;
ENV PATH="/usr/local/cargo/bin:$PATH"
# Install sccache — required by .cargo/config.toml as rustc-wrapper.
RUN cargo install sccache --locked && \
    chmod a+rx /usr/local/cargo/bin/sccache
# Pre-fetch all cargo dependencies (including git deps like fix-path-env from
# src-tauri) at build time, then open up permissions so any non-root user
# (Codespaces, Orkestra, local devcontainer) can write to the cargo cache
# without permission errors at runtime.
COPY . /tmp/cargo-prefetch/
RUN cd /tmp/cargo-prefetch && cargo fetch --locked && rm -rf /tmp/cargo-prefetch && \
    chmod -R a+rwX /usr/local/cargo /usr/local/rustup
# Install Node.js 22 LTS via NodeSource, then Claude Code CLI and pnpm globally.
ARG NODE_MAJOR=22
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g @anthropic-ai/claude-code pnpm && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /opt/pnpm-store && \
    chmod a+rwX /opt/pnpm-store && \
    pnpm config set store-dir /opt/pnpm-store --global
WORKDIR /workspace
CMD ["sleep", "infinity"]
