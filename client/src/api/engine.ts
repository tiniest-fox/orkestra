/**
 * The `host-engine` slice's public engine routes: its health and its push key. The host's own
 * HTTP API — the rail's and the launcher's second transport — is the host's to provide.
 */

import { Schema } from "effect"
import {
  HealthDto as HealthSchema,
  PushKeyDto as PushKeySchema,
} from "@orkestra/shared/dto/host-engine"
import { ApiError, get, url } from "./http"
import type { PushKeyDto, PushSubscriptionDto } from "./types"

const decodeHealth = Schema.decodeUnknownSync(HealthSchema)
const decodePushKey = Schema.decodeUnknownSync(PushKeySchema)

/**
 * `GET /api/health`, for the one field the page reads: the build id of the client the
 * engine serves now. `undefined` where the engine has none to report — an engine with no
 * bundle, or one from before the field.
 */
export const engineBuild = async (): Promise<string | undefined> =>
  decodeHealth(await get("/api/health")).client

/**
 * `GET /api/health`, for the project's name: the last segment of the checkout the engine
 * drives, which is what a phone's header names on an engine reached with no host.
 */
export const engineName = async (): Promise<string> =>
  decodeHealth(await get("/api/health"))
    .cwd.split(/[\\/]/u)
    .findLast((part) => part.length > 0) ?? ""

/**
 * `GET /api/push`. Free. The engine's VAPID public key, which is what
 * `PushManager.subscribe` signs this browser's subscription against — the private half
 * stays in the engine's `push.json` and never crosses the wire.
 */
export const pushKey = async (): Promise<PushKeyDto> => decodePushKey(await get("/api/push"))

/**
 * `POST /api/push`. Free. Hands the engine this browser's push subscription to keep —
 * on disk, so it survives an engine restart. Replaces by endpoint, so re-sending the
 * same subscription is a no-op rather than a second phone.
 *
 * Modeled on `login` rather than `post`: the route answers 204 with no body, so there
 * is nothing to parse.
 */
export const subscribeToPush = async (subscription: PushSubscriptionDto): Promise<void> => {
  const res = await fetch(url("/api/push"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription),
  })
  if (!res.ok) throw new ApiError(res.status, res.statusText, "/api/push")
}
