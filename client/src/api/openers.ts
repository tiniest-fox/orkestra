/** The `openers` slice's routes: the engine machine's terminals and editors, and a press on one. */

import { Schema } from "effect"
import { OpenersDto as OpenersSchema } from "@orkestra/shared/dto/openers"
import { body, post, trakPath, url } from "./http"
import type {
  ChooseOpenerRequestDto,
  OpenCheckoutRequestDto,
  OpenerKindDto,
  OpenersDto,
} from "./types"

const decodeOpeners = Schema.decodeUnknownSync(OpenersSchema)

/**
 * `GET /api/openers`. Free of an agent, not of processes: the engine scans its
 * application folders per request. The terminals and editors are the *engine's*
 * machine's — that is where a press below opens a window — with each icon inline as a
 * data URL, and both kinds in one answer because one scan finds both.
 *
 * **`"unsupported"` is the empty 204 every platform but macOS answers** — an answer
 * rather than an error, the same shape as `session`'s `false`, so the query settles on it
 * instead of retrying. The surface hides both controls on it.
 */
export const listOpeners = async (): Promise<OpenersDto | "unsupported"> => {
  const res = await fetch(url("/api/openers"))
  if (res.status === 204) return "unsupported"
  return decodeOpeners(await body(res, "/api/openers"))
}

/**
 * `POST /api/openers`. **Spends nothing and claims no custody**: stores which terminal
 * or editor a press opens — once per machine, shared by every project this engine is
 * pointed at, and the only thing that ever writes the preference; a guess never does.
 *
 * A 400 names an identifier the scan did not return under that kind, which only a
 * listing gone stale between fetch and pick can produce from this client.
 */
export const chooseOpener = async (kind: OpenerKindDto, id: string): Promise<void> => {
  const request: ChooseOpenerRequestDto = { kind, id }
  await post("/api/openers", request)
}

/**
 * `POST /api/traks/:id/open`. **Spends nothing, claims no custody and appends no
 * event**: one `open` process on the engine's machine, which is where the window
 * appears — a press relayed from a phone or a tunnelled browser opens it at the desk.
 *
 * 404 for every way there is nothing to open: an unknown trak, a checkout not made yet
 * or deleted by an archive, a platform with no scan, a machine with nothing of that
 * kind. The surface withholds the control in each case it can see; the one it cannot is
 * the archive that lands between poll and press, because the wire keeps naming a deleted
 * checkout — that press earns the sentence rather than a hidden control.
 */
export const openCheckout = async (id: string, kind: OpenerKindDto): Promise<void> => {
  const request: OpenCheckoutRequestDto = { kind }
  await post(`${trakPath(id)}/open`, request)
}

/**
 * `POST /api/open`. `openCheckout` at the project checkout — the repository the engine
 * drives, which no trak owns — and under the same contract. 404 for a platform with no
 * scan or a machine with nothing of that kind, both of which the surface withholds.
 */
export const openProject = async (kind: OpenerKindDto): Promise<void> => {
  const request: OpenCheckoutRequestDto = { kind }
  await post("/api/open", request)
}
