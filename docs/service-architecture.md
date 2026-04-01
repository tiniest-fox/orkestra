# Service Architecture

The Orkestra service system manages multiple projects from a single host. Read this before making changes to anything in `crates/orkestra-service/`, `service/`, `daemon/`, `Dockerfile.service`, or `Dockerfile.toolbox`.

## Two-Binary Model

The system splits responsibility across two binaries:

| Binary | Source | Role |
|--------|--------|------|
| **`ork-service`** | `service/` | HTTP API server. Manages project lifecycle, serves the web UI, owns the SQLite database, proxies WebSocket connections to daemons. |
| **`orkd`** | `daemon/` | Headless daemon. Runs inside each project container. Owns the orchestrator loop, agent spawning, and a WebSocket API for remote clients. |

`ork-service` is long-lived and stateful (one per host). `orkd` instances are ephemeral — one per running project container, restarted automatically on crash.

## Hosting and Deployment

**Production image:** `Dockerfile.service` — multi-stage build (cargo-chef planner → Rust builder → debian:bookworm-slim runtime). Embeds both binaries, Claude Code CLI, GitHub CLI, git, Node.js, and the embedded Dockerfiles.

**Ports:**
- `3847` — service HTTP API + web UI (configurable)
- `3850–3899` — daemon WebSocket ports, one per project, allocated from pool

**Key environment variables (on the service container):**

| Variable | Purpose |
|----------|---------|
| `CLAUDE_AUTH_DIR` | Host-side path to Claude CLI auth dir. Mounted into project containers at `/home/orkestra/.claude`. Must be a **host** path, not a service-container path (see DooD section). |
| `GIT_USER_EMAIL` / `GIT_USER_NAME` | Commit author identity forwarded into project containers via git env vars. |
| `GH_TOKEN` | GitHub token forwarded into project containers for HTTPS pushes via the git credential helper. |

**Deployment pattern:** Docker-outside-of-Docker (DooD). The service container talks to the host Docker daemon (via socket mount). Project containers are siblings on the host, not nested inside the service container. See [DooD section](#docker-outside-of-docker-dood) for implications.

## Project Lifecycle

Adding a project triggers a 9-step async flow in `provision.rs`. Each step is sequential; failure at any step updates the project status to `error` with a message.

```
stopped → cloning → starting → running
                                  ↓ (crash)
                               error → starting → running  (auto-restart)
                                  ↓ (stop request)
                               stopped
```

**Step-by-step:**

1. **Add** (`POST /api/projects`) — validates name, allocates daemon port (3850–3899), generates `shared_secret`, inserts row with status `cloning`. Returns immediately; steps 2–9 run in background.

2. **Clone** — `github::clone_repo::execute()` clones the repo to `{data_dir}/repos/{name}`.

3. **Init `.orkestra`** — `ensure_orkestra_project()` creates `workflow.yaml`, agent templates, and the SQLite schema. Sets status to `starting`.

4. **Detect devcontainer** — reads `.devcontainer/devcontainer.json` and returns one of four config variants (see [Devcontainer Support](#devcontainer-support)).

5. **Prepare image** — pulls or builds the image for this project's devcontainer variant (see [Image Model](#image-model)).

6. **Ensure toolbox volume** — builds `orkestra-toolbox:v{N}` and populates the `orkestra-toolbox` Docker volume if stale (runs at most once per service lifetime via `OnceCell`).

7. **Start container** — `docker run -d` (or `docker compose up -d`) with:
   - Workspace bind-mount: `{repo_path}:/workspace`
   - Port binding: `127.0.0.1:{port}:{port}`
   - Toolbox volume: `orkestra-toolbox:/opt/orkestra:ro`
   - Environment: `HOME=/home/orkestra`, git author vars, `GH_TOKEN`
   - Optional Claude auth bind-mount from `CLAUDE_AUTH_DIR`
   - Command: `sleep infinity`

8. **Inject orkd and ork** — `docker cp /usr/local/bin/orkd {container}:/usr/local/bin/orkd` then `docker cp /usr/local/bin/ork {container}:/usr/local/bin/ork`. Both binaries are copied from the service container filesystem and made executable. Avoids bind-mounting (see DooD section). If a third binary needs injection, extract a shared `inject_binary::execute(container_id, src_path, dest_name)` helper at that point.

9. **Chown workspace** — `docker exec -u root ... chown -R 1000:1000 /workspace` so the agent user (uid 1000) can write. Best-effort (error discarded).

10. **Run toolbox setup** — `docker exec -u root ... /opt/orkestra/setup.sh`. Creates symlinks, resolves uid 1000 user, sets git config, configures pnpm store (see [Toolbox](#the-toolbox)).

11. **Connect to service network** — joins project container to the service container's Docker user-defined networks so container-name DNS works (DooD only, detected via `/.dockerenv`).

12. **Store container ID** — writes Docker container ID to `service_projects.container_id`.

13. **Run devcontainer setup** (optional) — runs `postCreateCommand` from `devcontainer.json` (e.g. `pnpm install`, `mise install`). Non-fatal if it fails.

14. **Spawn daemon** — `docker exec -u 1000 {container} /usr/local/bin/orkd --project-root /workspace --port {port} --token {shared_secret} --bind 0.0.0.0`. Returns a `Child` handle that tracks the exec process on the host.

15. **Poll readiness** (background thread) — probes `127.0.0.1:{port}` or `orkestra-{id}:{port}` every 200ms, up to 30 seconds. Updates status to `running` when TCP connection succeeds.

**Rebuild** (`POST /api/projects/{id}/rebuild`) — stops the daemon, runs steps 4–15 again with a fresh container. Docker's layer cache applies for Build-type devcontainers.

**Auto-restart** — the monitor loop (`run_monitor_loop`) checks all `docker exec` child processes every second. On unexpected exit, waits 5 seconds, then re-execs into the same container (steps 14–15 only — no rebuild).

## Devcontainer Support

`detect.rs` reads `.devcontainer/devcontainer.json` and returns one of four variants:

| Variant | Condition | Image source | Notes |
|---------|-----------|-------------|-------|
| **Default** | No `.devcontainer/` dir | `Dockerfile.base` (embedded) | Orkestra base image (ubuntu:24.04 + mise) |
| **Image** | `"image"` key present | `docker pull {image}` | Pre-built image (e.g. `node:22`, `python:3.12`) |
| **Build** | `"build.dockerfile"` key | `docker build -f {dockerfile}` | Project's own Dockerfile |
| **Compose** | `"dockerComposeFile"` + `"service"` | compose-managed | Service writes an override file to inject the toolbox volume and port |

All variants support an optional `postCreateCommand` (string or array). Paths in `devcontainer.json` are relative to `.devcontainer/` per VS Code spec.

## Image Model

Two distinct images serve different purposes:

### Base Image (`crates/orkestra-service/Dockerfile.base`)

Used only for the **Default** devcontainer variant (projects with no `.devcontainer/` config). Minimal: ubuntu:24.04 + mise. Embedded in the service binary at `Dockerfile.service` build time, piped to `docker build -` via stdin at runtime.

Tag: `orkestra-base:{N}` (hardcoded in `prepare_image.rs`). Since the tag never changes, changing `Dockerfile.base` requires incrementing the tag constant to force a rebuild.

### Toolbox Image and Volume (`crates/orkestra-service/Dockerfile.toolbox`)

Shared toolbox used by **all** projects, regardless of devcontainer type. Built once per service lifetime; contents served via a Docker named volume (`orkestra-toolbox`) mounted read-only at `/opt/orkestra` in every project container.

Contents:
- Node.js 22 LTS — extracted to `/opt/orkestra/node/`
- Claude Code CLI — `/opt/orkestra/claude-code/node_modules/.bin/claude`
- pnpm — `/opt/orkestra/pnpm/node_modules/.bin/pnpm`, store at `/opt/pnpm-store`
- GitHub CLI — `/opt/orkestra/bin/gh`
- Git credential helper — `/opt/orkestra/bin/git-credential-gh-token` (reads `GH_TOKEN`)
- Setup script — `/opt/orkestra/setup.sh`

**Versioning:** `TOOLBOX_VERSION` in `ensure_toolbox_volume.rs` is the single source of truth. Bump it to trigger a full rebuild. The version is baked into the image tag (`orkestra-toolbox:v{N}`) and a marker file (`/opt/orkestra/.version`). The service checks the marker on startup; if it doesn't match, it rebuilds the image and repopulates the volume.

## The Toolbox

`/opt/orkestra/setup.sh` runs as root inside every project container at startup (step 10 above). It is idempotent — safe to run multiple times. What it does:

1. Symlinks `/opt/orkestra/bin/*` → `/usr/local/bin/` so `claude`, `gh`, `node`, `pnpm`, etc. are on `PATH`.
2. Writes `/etc/profile.d/orkestra-env.sh` with `PATH` and `NODE_PATH` (for login shells).
3. Resolves or creates uid 1000 user (creates `orkestra` if no uid 1000 exists).
4. Ensures `/home/orkestra` exists and is owned by uid 1000.
5. Grants uid 1000 access to `/root` (for bind-mounted Claude auth at `/root/.claude`).
6. Configures git identity (`user.email`, `user.name`, `credential.helper gh-token`) for uid 1000.
7. Writes `store-dir=/opt/pnpm-store` to `/home/orkestra/.npmrc` so pnpm uses the pre-created world-writable store.

## Devcontainer / Toolbox Boundary

This is the most important architectural rule for working on this system:

> **The devcontainer must be environment-agnostic. The toolbox is Orkestra's adapter.**

`.devcontainer/Dockerfile` must work identically in GitHub Codespaces, VS Code Dev Containers, and Orkestra. It has no knowledge that Orkestra exists. Rules for devcontainer Dockerfiles:

- Use `chmod -R a+rwX` for globally-installed tool caches — **never** `chown` with a specific uid.
- Do not reference `/home/orkestra`, uid 1000, `/opt/orkestra`, or any Orkestra path.
- Pre-fetch expensive caches at build time (`cargo fetch --locked`) so uid-unknown tool caches exist with open permissions before any user runs.

Orkestra-specific configuration (uid 1000 setup, tool store paths, git identity) lives exclusively in `setup.sh`. If a fix would break the devcontainer in Codespaces, it belongs in the toolbox instead.

See [`docs/solutions/2026-03-09-devcontainer-toolbox-boundary.md`](solutions/2026-03-09-devcontainer-toolbox-boundary.md) for concrete patterns and examples.

## Docker-outside-of-Docker (DooD)

The service container communicates with the host Docker daemon via socket mount. Project containers are siblings on the host daemon — not nested inside the service container. This creates several constraints:

**Bind-mount paths must be host paths.** When the service does `docker run -v {path}:/workspace`, `{path}` is resolved by the host daemon against the host filesystem, not the service container's filesystem. The `CLAUDE_AUTH_DIR` env var must hold the host-side path for this reason.

**Dockerfiles are piped via stdin.** `docker build -` receives the Dockerfile content on stdin, requiring no build context path. This is why `Dockerfile.base` and `Dockerfile.toolbox` can be built from a service container without a shared filesystem.

**orkd is injected via `docker cp`.** The service copies `/usr/local/bin/orkd` (inside the service container) into project containers using `docker cp {container_id}:/usr/local/bin/orkd`. Since `docker cp` is a Docker daemon operation, it works correctly in DooD.

**Network communication uses container DNS.** When running in DooD (detected by `/.dockerenv`), the service joins project containers to its own user-defined Docker networks (`connect_network.rs`). This enables `orkestra-{project_id}:{port}` DNS resolution from the service container to reach the daemon.

## Networking

**Service HTTP API** (port 3847):

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/projects` | Bearer | List projects; auto-pairs each running daemon |
| `POST /api/projects` | Bearer | Add project (async provision) |
| `DELETE /api/projects/{id}` | Bearer | Stop and remove project |
| `POST /api/projects/{id}/start` | Bearer | Start stopped project |
| `POST /api/projects/{id}/stop` | Bearer | Stop running project |
| `POST /api/projects/{id}/rebuild` | Bearer | Rebuild container |
| `GET /projects/{id}/ws` | Bearer | WebSocket proxy to daemon |
| `GET /api/github/repos` | Bearer | List GitHub repos |
| `POST /api/pairing-code` | Bearer | Generate device pairing code |
| `POST /pair` | None | Exchange pairing code for device token |

**WebSocket proxy:** `GET /projects/{id}/ws` upgrades to WebSocket and proxies to the daemon at `127.0.0.1:{port}` (local) or `orkestra-{id}:{port}` (DooD).

## Auth and Pairing

**Service authentication:**
1. First device uses `POST /pair` with a pairing code to receive a long-lived bearer token (stored in `device_tokens`).
2. Subsequent requests use `Authorization: Bearer {token}`.

**Daemon pairing (auto-paired by service):**
- Each daemon generates a one-time pairing code on startup.
- When a client lists projects, the service transparently pairs with each running daemon and caches the token in `daemon_tokens` (one per device per daemon).
- The daemon token is returned to clients in the project list response, enabling direct WebSocket connections.
- Pairing is serialized per daemon via a lock in `daemon_token/get_or_create.rs` to prevent duplicate pairing races.

## Database Schema

SQLite at `{data_dir}/service.db`. Four tables:

**`service_projects`** — one row per project.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `name` | TEXT | user-chosen name (may contain `/` for org/repo slugs) |
| `path` | TEXT UNIQUE | host filesystem path to cloned repo |
| `daemon_port` | INTEGER | allocated from 3850–3899 pool |
| `shared_secret` | TEXT | 32-byte hex; used for daemon bearer auth |
| `status` | TEXT | stopped / cloning / starting / running / error |
| `error_message` | TEXT? | set when status=error |
| `pid` | INTEGER? | host PID of the `docker exec` process (set while running) |
| `container_id` | TEXT? | Docker container ID (cleared on stop) |
| `created_at` | TEXT | ISO timestamp |

**`device_tokens`** — service-level auth tokens for paired clients (PWA, mobile).

**`pairing_codes`** — short-lived (5 min) one-time codes for device pairing.

**`daemon_tokens`** — cache of per-device per-daemon tokens obtained via auto-pairing. PK is `(device_id, project_id)`.

## Key Files

| File | Purpose |
|------|---------|
| `service/src/main.rs` | Entry point: port allocation, supervisor init, monitor loop spawn |
| `crates/orkestra-service/src/server.rs` | axum router, auth middleware, all HTTP handlers |
| `crates/orkestra-service/src/daemon_supervisor.rs` | Child process management, restart loop, toolbox init gate |
| `crates/orkestra-service/src/interactions/project/provision.rs` | 15-step clone→container→daemon flow |
| `crates/orkestra-service/src/interactions/devcontainer/detect.rs` | Parse devcontainer.json into config variant |
| `crates/orkestra-service/src/interactions/devcontainer/prepare_image.rs` | Pull/build image per config variant |
| `crates/orkestra-service/src/interactions/devcontainer/ensure_toolbox_volume.rs` | Toolbox versioning and volume management |
| `crates/orkestra-service/src/interactions/devcontainer/start_container.rs` | `docker run` or `docker compose up` |
| `crates/orkestra-service/src/interactions/devcontainer/run_toolbox_setup.rs` | Execute `setup.sh` in container |
| `crates/orkestra-service/src/interactions/devcontainer/connect_network.rs` | Join container to service's Docker networks (DooD) |
| `crates/orkestra-service/src/interactions/devcontainer/exec_orkd.rs` | `docker exec -u 1000` to spawn daemon |
| `crates/orkestra-service/src/interactions/devcontainer/inject_orkd.rs` | `docker cp` orkd binary into container + `chmod +x` |
| `crates/orkestra-service/src/interactions/devcontainer/inject_ork.rs` | `docker cp` ork binary into container + `chmod +x` |
| `crates/orkestra-service/src/interactions/daemon_token/get_or_create.rs` | Auto-pairing flow |
| `crates/orkestra-service/Dockerfile.base` | Orkestra default devcontainer (ubuntu + mise) |
| `crates/orkestra-service/Dockerfile.toolbox` | Toolbox image (Node, Claude CLI, gh, pnpm, setup.sh) |
| `Dockerfile.service` | Production image (planner → builder → runtime) |
