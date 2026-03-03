# Remote Control: Future Phases (3–6)

Phases 1–2 establish the `orkestra-networking` crate with a WebSocket daemon and JSON-RPC command protocol. This document captures the design for the next four phases so future implementers have a clear starting point.

## Context

After Phase 2:
- The daemon exposes a WebSocket server on localhost (default port 3847)
- The protocol is JSON-RPC over WebSocket: `{ id, method, params }` → `{ id, result/error }`
- Authentication is bearer-token based with 6-digit pairing codes
- Events broadcast to connected clients: `task_updated`, `task_created`, `task_deleted`, etc.

Phases 3–6 extend this into a complete remote-control system usable from a phone browser.

---

## Phase 3: Relay Server

**Goal:** Allow clients behind NAT/firewall to reach the daemon without port forwarding.

### Architecture

The relay is a stateless WebSocket forwarder. The daemon connects *outbound* to the relay; so does the PWA. The relay routes messages between them by device ID.

```
[Daemon] ──── ws://relay/daemon/{device-id} ──────→ [Relay]
[PWA]    ──── ws://relay/client/{device-id}?token=… → [Relay]
                                                         │
                                                    routes messages
                                                    by device-id
```

No message queuing. If a party is offline the relay returns an error immediately. The daemon is the source of truth; the relay is just a wire.

### Relay Protocol

On connection:
```json
{ "type": "register", "device_id": "...", "role": "daemon" | "client", "token": "..." }
```

On forward:
```json
{ "type": "forward", "device_id": "...", "payload": { ...json-rpc message... } }
```

Error response when target offline:
```json
{ "type": "error", "code": "device_offline", "message": "..." }
```

### Transport Security

All relay connections use WSS (TLS). The relay validates the bearer token before forwarding. Device IDs are UUIDs generated at daemon init.

### Daemon Changes: `relay_client` module

Add to `orkestra-networking`:
- `relay_client/connect.rs` — Establishes outbound WSS to relay, handles registration
- `relay_client/forwarder.rs` — Bridges the relay connection to the local WebSocket server protocol (reuses existing command dispatch)

The relay client reconnects with exponential backoff. Configuration in `daemon.toml`:

```toml
[relay]
url = "wss://relay.orkestra.dev"
device_id = "..."  # persisted at first connect
```

### Deployment

Single Rust binary. Stateless — no database needed beyond in-memory connection map. Good fit for Fly.io or Railway with a single 256MB instance. The implementation is ≤300 lines of `tokio-tungstenite` + `dashmap`.

### Open Questions for Phase 3

- Authentication model: does the relay validate tokens, or just pass them through for the daemon to verify?
- Device ID generation and persistence location (daemon config file vs. SQLite)
- Rate limiting / abuse prevention on the relay
- Self-hosted relay documentation (same binary, different config — skip for v1)

---

## Phase 4: Frontend Transport Abstraction + PWA

**Key insight:** The Tauri desktop app and the PWA share the same React codebase. Rather than adding a WebSocket code path alongside `invoke()`, abstract the transport so all components are oblivious to which one they're using. The Tauri app gains remote-connect capability as a side effect.

### Transport Interface

Create `src/transport/interface.ts`:

```typescript
export interface Transport {
  /** Call a command and await the response. */
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;

  /** Subscribe to a server-sent event. Returns an unsubscribe function. */
  on(event: string, handler: (data: unknown) => void): () => void;
}
```

### Implementations

**`src/transport/TauriTransport.ts`** — wraps `invoke()` and `listen()`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Transport } from "./interface";

// Tauri uses workflow_get_tasks; protocol uses list_tasks.
const METHOD_MAP: Record<string, string> = {
  list_tasks: "workflow_get_tasks",
  get_config: "workflow_get_config",
  approve: "workflow_approve",
  // ... remaining mappings
};

// Tauri uses kebab-case events; protocol uses snake_case.
const EVENT_MAP: Record<string, string> = {
  task_updated: "task-updated",
  task_created: "task-created",
  task_deleted: "task-deleted",
};

export class TauriTransport implements Transport {
  call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const tauriMethod = METHOD_MAP[method] ?? method;
    return invoke<T>(tauriMethod, params);
  }

  on(event: string, handler: (data: unknown) => void): () => void {
    const tauriEvent = EVENT_MAP[event] ?? event;
    let unlisten: (() => void) | null = null;
    listen<unknown>(tauriEvent, (e) => handler(e.payload)).then(
      (fn) => { unlisten = fn; }
    );
    return () => unlisten?.();
  }
}
```

**`src/transport/WebSocketTransport.ts`** — JSON-RPC over WebSocket:

```typescript
import type { Transport } from "./interface";

export class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private pending = new Map<number, { resolve: Function; reject: Function }>();
  private listeners = new Map<string, Set<(data: unknown) => void>>();
  private nextId = 1;

  constructor(url: string, token: string) {
    this.ws = new WebSocket(`${url}?token=${token}`);
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
  }

  call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, handler: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  private onMessage(msg: unknown) {
    // ... route to pending promise or event listeners
  }
}
```

### Transport Selection

`src/transport/index.ts` picks the implementation at startup:

```typescript
import { TauriTransport } from "./TauriTransport";
import { WebSocketTransport } from "./WebSocketTransport";
import type { Transport } from "./interface";

function createTransport(): Transport {
  const remoteUrl = localStorage.getItem("orkestra.remote_url");

  if (window.__TAURI__ && !remoteUrl) {
    // Default: Tauri app talking to local daemon via native IPC
    return new TauriTransport();
  }

  // Browser (PWA) or Tauri pointing at a remote daemon
  const url = remoteUrl ?? "ws://localhost:3847";
  const token = localStorage.getItem("orkestra.token") ?? "";
  return new WebSocketTransport(url, token);
}

export const transport: Transport = createTransport();
```

### Migration Scope

~14 files currently call `invoke()` directly. The migration is mechanical:

| File | invoke() calls to migrate |
|------|--------------------------|
| `src/providers/TasksProvider.tsx` | `workflow_get_tasks`, `workflow_get_startup_data` |
| `src/providers/WorkflowConfigProvider.tsx` | `workflow_get_config` |
| `src/providers/GitHistoryProvider.tsx` | `workflow_get_commit_log`, `workflow_get_commit_diff` |
| `src/providers/PrStatusProvider.tsx` | `workflow_get_pr_status` |
| `src/components/Feed/FeedView.tsx` | `workflow_create_task`, `workflow_archive`, `workflow_get_archived_tasks` |
| `src/components/Feed/Drawer/useTaskDrawerState.ts` | `workflow_approve`, `workflow_reject`, `workflow_reject_with_comments`, `workflow_answer_questions`, `workflow_interrupt`, `workflow_resume`, `workflow_retry`, `workflow_retry_startup`, `workflow_set_auto_mode`, `workflow_request_update`, `workflow_address_pr_feedback`, `workflow_address_pr_conflicts` |
| `src/components/Feed/DrawerHeader.tsx` | `workflow_delete_task`, `workflow_create_subtask`, `workflow_merge_task` |
| `src/components/Feed/DrawerDiffTab.tsx` | `workflow_get_task_diff`, `workflow_get_syntax_css`, `workflow_get_batch_file_counts` |
| `src/components/Feed/DrawerPrTab/DrawerPrTab.tsx` | `workflow_open_pr`, `workflow_retry_pr`, `workflow_pull_pr_changes`, `workflow_push_pr_changes` |
| `src/components/Feed/AssistantDrawer.tsx` | assistant commands |
| `src/components/Feed/Drawer/Sections/SubtasksSection.tsx` | `workflow_list_branches` |
| `src/components/ProjectPicker/ProjectPicker.tsx` | `workflow_get_logs`, `workflow_get_latest_log` |

**Commands that stay as direct `invoke()`** — these are inherently local macOS operations:

- `pick_folder` — Tauri dialog plugin
- `open_in_terminal`, `open_in_editor` — shell exec on local machine
- `detect_external_tools` — scans `/Applications`

These must remain Tauri-only. Guard them with `if (window.__TAURI__)` in the components that call them, and disable or hide the UI elements in the PWA.

### Method Name Alignment

| WebSocket method | Tauri command |
|-----------------|---------------|
| `list_tasks` | `workflow_get_tasks` |
| `get_startup_data` | `workflow_get_startup_data` |
| `get_config` | `workflow_get_config` |
| `approve` | `workflow_approve` |
| `reject` | `workflow_reject` |
| `reject_with_comments` | `workflow_reject_with_comments` |
| `answer_questions` | `workflow_answer_questions` |
| `interrupt` | `workflow_interrupt` |
| `resume` | `workflow_resume` |
| `retry` | `workflow_retry` |
| `create_task` | `workflow_create_task` |
| `delete_task` | `workflow_delete_task` |
| `merge_task` | `workflow_merge_task` |
| `get_task_diff` | `workflow_get_task_diff` |
| `git_sync_status` | `workflow_git_sync_status` |
| `git_push` | `workflow_git_push` |
| `git_pull` | `workflow_git_pull` |

### PWA Specifics

- `vite-plugin-pwa` for service worker and web app manifest
- Service worker strategy: network-first, no offline caching (daemon is the data store)
- Manifest: `name: "Orkestra"`, `display: "standalone"`, `start_url: "/"`
- Served from static hosting (Cloudflare Pages, Vercel, S3+CDN) — not from the relay
- First-launch flow: prompt for relay URL + device token → stored in `localStorage`
- Build: `pnpm build --mode pwa` produces a `dist/` with service worker; Tauri build unchanged

### Benefits of This Approach

1. PWA requires almost no new frontend code — same React components, different transport
2. Tauri desktop app gains remote-connect capability for free (set `orkestra.remote_url`)
3. Frontend tests can run against the WebSocket server without Tauri
4. All new UI features build against the abstraction — no migration debt accumulates

### Open Questions for Phase 4

- Should `WebSocketTransport` reconnect automatically, or surface a disconnected state to the UI?
- How does the PWA handle the startup flow (project selection) when the daemon is remote?
- Diff syntax highlighting is currently server-side via `workflow_get_syntax_css` — does this stay server-side or move client-side (e.g., `shiki`) for PWA?
- Git operations (`open_in_terminal`, `open_in_editor`) — hide entirely in PWA, or provide deep links?

---

## Phase 5: Web Push Notifications

**Goal:** Phone receives a push notification when a task needs review, even with the browser tab closed.

### Architecture

The daemon sends pushes directly — it has the VAPID private key and the push subscriptions. The relay is not in the push path (push goes through the browser vendor's push service, not through relay).

```
[Daemon] ──→ [Browser Push Service (FCM/APNS)] ──→ [PWA Service Worker]
```

### Implementation

**Server side (Rust):**
- Add `web-push` crate to `orkestra-networking`
- Generate VAPID key pair at daemon init, persist in config
- New interaction: `networking/push/subscribe.rs` — stores subscription endpoint + keys
- New interaction: `networking/push/dispatch.rs` — sends push for specific events

**Database:**
- New migration: `V{N}__add_push_subscriptions.sql`
- Table: `push_subscriptions (id, endpoint, p256dh_key, auth_key, device_label, created_at)`

**Events that trigger push:**
- Task enters `AwaitingReview` phase
- Integration completes (task done)
- Task enters `Failed` or `Blocked` status

**Client side:**
- PWA service worker handles `push` events and calls `self.registration.showNotification()`
- On notification click: focus/open the PWA tab and navigate to the relevant task
- Subscribe flow: after pairing, call `push_subscribe` command with the `PushSubscription` object

**New WebSocket command:**
```
push_subscribe { endpoint, p256dh_key, auth_key }
push_unsubscribe { endpoint }
```

### Open Questions for Phase 5

- VAPID public key delivery: hardcode in PWA build, or fetch from daemon on pairing?
- Notification payload: include task title, or keep payload minimal and fetch on click?
- iOS Web Push requires Safari 16+ and a home-screen install — document the requirement
- Should the Tauri app also receive pushes, or use its existing system notification path?

---

## Phase 6: Polish & Hardening

**Goal:** Make the remote control experience reliable and pleasant.

### Connection Resilience

`WebSocketTransport` reconnection:

```typescript
class WebSocketTransport {
  private reconnectDelay = 1000; // ms, doubles on each failure up to 30s

  private scheduleReconnect() {
    setTimeout(() => {
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    }, this.reconnectDelay);
  }
}
```

On reconnect: re-fetch `get_startup_data` to resync task state (same as app startup). The daemon event stream is fire-and-forget; the resync handles any missed events.

Ping/pong keepalive: send a WebSocket ping every 30s; treat 3 missed pongs as a disconnect.

**UI treatment:** Show a `ConnectionStatus` indicator in the header when disconnected. Don't block interaction — queue mutations and replay on reconnect (or show a "reconnecting..." state and block).

Files to modify:
- `src/transport/WebSocketTransport.ts` — reconnection logic
- `src/components/Feed/FeedHeader.tsx` — connection status indicator

### Device Management UI

New panel accessible from settings:

- List paired devices (name, last seen, creation date)
- Revoke a device (invalidates its token, closes active WebSocket)
- Rename a device (cosmetic label stored in daemon config)

New WebSocket commands:
```
list_devices → [{ id, label, last_seen, token_prefix }]
revoke_device { device_id }
rename_device { device_id, label }
```

New frontend component: `src/components/DeviceManager/DeviceManager.tsx`

### Responsive Frontend

Current layout assumes a wide desktop viewport. For mobile:

- `FeedView.tsx`: switch from column layout to single-column at `< 768px`
- Task board becomes a vertically scrollable feed on narrow viewports (already close to this)
- Drawer becomes full-screen on mobile (CSS: `sm:max-w-xl w-full h-full`)
- Touch-friendly approval flows: larger tap targets, swipe-to-approve gesture on review footer

Tailwind breakpoints to add: `sm:` variants on `FeedView.tsx` grid, `TaskDrawer.tsx` width.

### Error Recovery Scenarios

| Scenario | Behavior |
|----------|----------|
| Relay goes down mid-session | `WebSocketTransport` reconnects with backoff; UI shows "reconnecting" |
| Daemon restarts mid-connection | Client reconnects and calls `get_startup_data` to resync |
| Token revoked remotely | WebSocket closes with code 4001; UI shows "session revoked, re-pair" |
| Network flap < 5s | Reconnect succeeds; user sees brief "reconnecting" flash |
| Daemon unreachable (relay down) | After 3 retries, show "daemon unreachable" with retry button |

### Open Questions for Phase 6

- Queuing mutations during disconnect: safe for most commands, but dangerous for approval flows — should mutations be blocked or queued?
- How to handle the Tauri app's `pick_folder` and `open_in_*` commands when the desktop is used as a remote control pointing at a different machine?
- Performance on mobile: the diff tab renders large files — add virtualization or lazy loading before shipping PWA
