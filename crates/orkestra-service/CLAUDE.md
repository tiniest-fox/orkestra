# orkestra-service

HTTP API server managing project lifecycle, secrets, and daemon proxying. Read [`docs/service-architecture.md`](../../docs/service-architecture.md) before making changes here.

## Secrets Feature

Project secrets are stored AES-256-GCM encrypted in `project_secrets` (service SQLite). The encryption key (`ORKESTRA_SECRETS_KEY`) is read once at startup in `service/src/main.rs` and stored in `AppState.secrets_key: Option<String>`. It is never re-read from the environment at runtime — pass it explicitly through any call chain that needs it (see `provision.rs`).

### Endpoint key policy

Not all secret endpoints require the key. Get the policy wrong and handlers will either block operations that don't need encryption or silently skip the guard:

| Endpoint | Key required? | Reason |
|----------|--------------|--------|
| `GET /api/projects/:id/secrets` (list) | No | Returns key names only — no decryption |
| `GET /api/projects/:id/secrets/:key` (get) | Yes | Must decrypt the stored value |
| `POST /api/projects/:id/secrets/:key` (set) | Yes | Must encrypt before storing |
| `DELETE /api/projects/:id/secrets/:key` (delete) | No | Pure SQL delete — no encryption involved |

Endpoints that require the key return 503 (`SecretsKeyNotConfigured`) when `secrets_key` is `None`. Endpoints that don't require the key proceed regardless.

### Git identity injection

Per-project git author identity is injected into containers via `extract_git_identity(secrets)` in `start_container.rs`. The function applies a full fallback chain (secret → env var → hardcoded default) and returns resolved `(email, name, filtered_secrets)`. The filtered secrets have the git identity keys removed, so the same secrets slice is **not** also injected as bare env vars — double-injection prevention is structural, not ad-hoc.

`GIT_AUTHOR_NAME`/`EMAIL` and `GIT_COMMITTER_NAME`/`EMAIL` are set from the resolved values. Supported secret keys are `GIT_USER_NAME` and `GIT_USER_EMAIL`.

**Wrapper limitation:** The `devcontainer_start_container` convenience function in `lib.rs` always passes `&[]` for secrets. Callers using this wrapper will never get per-project git identity from secrets — only the env-var fallback applies. If you add a caller that expects secret-based identity, call the underlying interaction (`start_container::execute`) directly with the decrypted secrets.

## YAML Escaping in `build_compose_override`

When injecting values into compose override YAML, strings written inside double-quoted YAML scalars must be escaped. The current codebase applies a 5-step `.replace()` chain for this:

```rust
let escaped = value.replace('\\', "\\\\").replace('"', "\\\"")
    .replace('\n', "\\n").replace('\r', "\\r").replace('\0', "\\0");
```

**Known gap:** `GH_TOKEN` and git identity values (`git_email`, `git_name`) at lines 505-508 and 518-519 of `start_container.rs` are written into double-quoted YAML strings without this escaping. Secrets and `CLAUDE_CODE_OAUTH_TOKEN` apply it correctly. A future cleanup should extract an `escape_yaml_double_quoted` helper and apply it uniformly to all injection sites.

## Router Middleware Ordering (`extra_routes`)

Axum layers apply only to routes already merged into the router at the point the layer is added — they do not retroactively cover routes merged afterward. `build_router` in `server.rs` uses `extra_routes` (injected by callers like `service/src/main.rs`) to attach PWA/SPA routes. These **must be merged before** the security header and CORS layers are applied, or PWA routes silently bypass all security headers.

The correct ordering is:
1. Build core routes and call `.with_state(state)` to produce a `Router<()>`
2. Merge `extra_routes` (also `Router<()>`) into the combined router
3. Apply `SetResponseHeaderLayer`, `CorsLayer`, and other layers on the combined router

Adding any new blanket middleware (rate limiting, logging, etc.) to `build_router` must follow this same pattern — add the layer after the `extra_routes` merge, not before. A test `security_headers_present_on_extra_routes` in `server.rs` verifies this for security headers.

### Agent API key injection pattern

Agent provider keys (`CLAUDE_CODE_OAUTH_TOKEN`, `OPENCODE_API_KEY`) follow the same pattern in `start_container.rs`:

1. An `extract_<key>()` function mirrors `extract_git_identity()`: secret-store lookup → env-var fallback → remaining secrets filtered.
2. The extracted value is chained into `DockerRunConfig` and `build_compose_override`.
3. Both docker-compose files (`docker-compose.daemon.yml`, `docker-compose.service.yml`) declare the var with an empty-string default so the host passes it through.

`build_compose_override` currently takes 7 parameters. **If you add another agent provider key, introduce a config struct** (e.g., `ContainerEnvConfig`) instead of a 8th parameter.

### decrypt_all vs get/set signatures

`secret::decrypt_all::execute` takes `secrets_key: Option<&str>` and returns an empty vec when the key is absent (graceful degradation for container env-var injection — containers start normally even without secrets configured).

`secret::get::execute` and `secret::set::execute` take `secrets_key: &str` — callers must unwrap and 503 before calling these. Do not add `Option` handling inside get/set.

## Subfolder Projects: Always Use `repo_root_path()`

`project.path` includes the subfolder suffix for subfolder projects (e.g., `/repos/myapp/frontend`). Any code that needs the filesystem path for devcontainer config, git operations, or container mounts must use `project.repo_root_path()` instead — it strips the subfolder to return the parent repo's clone path.

When working with raw `(path, subfolder)` data rather than a `Project` struct (e.g., `startup_cleanup`), use the standalone `compute_repo_root(path, subfolder)` function from `types.rs` — it shares the same logic as `repo_root_path()`.

**Pattern:** `project.path` → storage/identification. `project.repo_root_path()` → filesystem operations.

## Explicit Column Selection in `startup_cleanup`

`daemon_supervisor.rs::startup_cleanup` selects `service_projects` columns by name in a raw SQL query. When you add a new column to the `service_projects` schema, you **must** also add it to the `SELECT` list in `startup_cleanup` or startup logic will be blind to it — the column exists in the DB but the deserialized `Project` struct will have its default/`None` value.

The same applies to `shutdown_all` and any other raw SQL paths that deserialize full `Project` structs.

## Destructive Handler Precondition Ordering

Handlers that perform irreversible side effects (stopping a daemon, destroying a container, removing a directory) must validate all preconditions **before** the first destructive call. The canonical case: `remove_project_handler` checks for child subfolder projects via an inline SQL query before calling `abort_provision` or `stop_daemon`. If the check were after the daemon stop, a 409 rejection would leave the parent daemon killed with no way to recover short of manual restart.

**Rule:** Gather all facts. Validate all guards. Only then begin side effects.
