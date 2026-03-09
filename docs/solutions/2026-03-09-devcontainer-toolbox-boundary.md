---
title: Devcontainer / toolbox boundary — what goes where
date: 2026-03-09
tags: [docker, devcontainer, toolbox, permissions]
category: architecture
module: devcontainer
symptoms:
  - Permission denied errors at container runtime for tool caches (cargo, pnpm, etc.)
  - Devcontainer works locally but breaks inside Orkestra
  - Temptation to add Orkestra-specific uid or path knowledge to .devcontainer/Dockerfile
---

# Devcontainer / Toolbox Boundary

## The Two-Layer Model

Orkestra uses two Docker layers with a strict boundary between them:

| Layer | File | Audience | Knows about Orkestra? |
|-------|------|----------|-----------------------|
| Project devcontainer | `.devcontainer/Dockerfile` | Any devcontainer host (Codespaces, VS Code, Orkestra) | No |
| Toolbox | `crates/orkestra-service/Dockerfile.toolbox` + `setup.sh` | Orkestra only | Yes |

## Rule: The Devcontainer Is Environment-Agnostic

`.devcontainer/Dockerfile` must produce an image that works identically regardless of the host running it. This means:

**Never use uid-specific `chown` in the devcontainer:**
```dockerfile
# WRONG — assumes uid 1000 is the runtime user
RUN chown -R 1000:1000 /usr/local/cargo /usr/local/rustup

# CORRECT — any user can write
RUN chmod -R a+rwX /usr/local/cargo /usr/local/rustup
```

**Never reference Orkestra-specific paths (`/home/orkestra`, `/opt/orkestra`, etc.)** in the devcontainer Dockerfile.

**Pre-fetch caches at build time** to avoid permission races at runtime:
```dockerfile
COPY . /tmp/cargo-prefetch/
RUN cd /tmp/cargo-prefetch && cargo fetch --locked && rm -rf /tmp/cargo-prefetch && \
    chmod -R a+rwX /usr/local/cargo /usr/local/rustup
```

## Rule: Orkestra-Specific Setup Belongs in the Toolbox

`setup.sh` runs as root inside any project container at startup. It is the right place for:

- Creating/resolving uid 1000 user
- Git identity configuration
- Tool store paths (e.g. writing `store-dir=/opt/pnpm-store` to `/home/orkestra/.npmrc`)
- Any configuration that depends on knowing the runtime user is uid 1000

**Example — pnpm store configuration:**

pnpm detects that `/home/orkestra` (overlay filesystem) and `/workspace` (bind mount) are on different filesystems and may fall back to creating a store inside the workspace. Fix in the toolbox:

```dockerfile
# Dockerfile.toolbox — create a world-writable store at build time
RUN npm install --prefix /opt/orkestra/pnpm pnpm && \
    mkdir -p /opt/pnpm-store && \
    chmod a+rwX /opt/pnpm-store
```

```sh
# setup.sh — configure uid 1000's pnpm to use it
echo 'store-dir=/opt/pnpm-store' > /home/orkestra/.npmrc
chown 1000:1000 /home/orkestra/.npmrc
```

This approach works for any project — the devcontainer doesn't need to know about it.

## Toolbox Versioning

The toolbox image is cached by version tag. After any change to `Dockerfile.toolbox` or `setup.sh`, bump `TOOLBOX_VERSION` in `ensure_toolbox_volume.rs`:

```rust
// crates/orkestra-service/src/interactions/devcontainer/ensure_toolbox_volume.rs
const TOOLBOX_VERSION: &str = "2";  // increment this
```

This triggers a full image rebuild and volume repopulation on next service start.

## Decision Rule

> If a change would break the devcontainer in Codespaces or a local VS Code setup, it belongs in the toolbox, not the devcontainer.
