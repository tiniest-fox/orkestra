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

### decrypt_all vs get/set signatures

`secret::decrypt_all::execute` takes `secrets_key: Option<&str>` and returns an empty vec when the key is absent (graceful degradation for container env-var injection — containers start normally even without secrets configured).

`secret::get::execute` and `secret::set::execute` take `secrets_key: &str` — callers must unwrap and 503 before calling these. Do not add `Option` handling inside get/set.
