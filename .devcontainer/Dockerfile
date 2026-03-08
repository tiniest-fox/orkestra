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
# Git credential helper: reads GH_TOKEN from the environment and returns it
# as HTTPS credentials for github.com.
RUN echo '#!/bin/sh' > /usr/local/bin/git-credential-gh-token && \
    echo '[ "$1" = "get" ] && [ -n "$GH_TOKEN" ] && printf "username=x-access-token\npassword=%s\n" "$GH_TOKEN"' >> /usr/local/bin/git-credential-gh-token && \
    chmod +x /usr/local/bin/git-credential-gh-token
# Create non-root user for running agents.
# claude CLI refuses --dangerously-skip-permissions when running as root.
# Ubuntu 24.04 ships a built-in "ubuntu" user at uid 1000; rename it to "orkestra".
# chmod 755 /root so the agent user can access /root/.claude (the bind-mounted auth dir).
RUN usermod -l orkestra -d /home/orkestra -m ubuntu && \
    groupmod -n orkestra ubuntu && \
    chmod 755 /root
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
# Set git identity and credential helper for the orkestra user.
USER orkestra
RUN git config --global user.email "agent@orkestra.local" && \
    git config --global user.name "Orkestra Agent" && \
    git config --global credential.helper gh-token
USER root
# Install Node.js 22 LTS via NodeSource, then Claude Code CLI and pnpm globally.
ARG NODE_MAJOR=22
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g @anthropic-ai/claude-code pnpm && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
CMD ["sleep", "infinity"]
