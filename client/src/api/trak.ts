/** The `trak` slice's routes: the list, one trak, its processes, its deploy and its views. */

import { Schema } from "effect"
import {
  ArchivedTrakListDto as ArchivedTrakListSchema,
  DeployDto as DeploySchema,
  HostedProcessDto as HostedProcessSchema,
  HostedProcessListDto as HostedProcessListSchema,
  TrakDetailDto as TrakDetailSchema,
  TrakListDto as TrakListSchema,
  ViewDto as ViewSchema,
  ViewResultDto as ViewResultSchema,
} from "@orkestra/shared/dto/trak"
import { get, post, trakPath, url } from "./http"
import type {
  ArchivedTrakListDto,
  DeployDto,
  HostedProcessDto,
  TrakDetailDto,
  TrakListDto,
  ViewDto,
  ViewResultDto,
} from "./types"

const decodeList = Schema.decodeUnknownSync(TrakListSchema)
const decodeDetail = Schema.decodeUnknownSync(TrakDetailSchema)
const decodeDeploy = Schema.decodeUnknownSync(DeploySchema)
const decodeProcesses = Schema.decodeUnknownSync(HostedProcessListSchema)
const decodeProcess = Schema.decodeUnknownSync(HostedProcessSchema)
const decodeView = Schema.decodeUnknownSync(ViewSchema)
const decodeViewResult = Schema.decodeUnknownSync(ViewResultSchema)
const decodeArchived = Schema.decodeUnknownSync(ArchivedTrakListSchema)

/** `GET /api/traks`. Free: the server replays the live logs, and counts the rest. */
export const listTraks = async (): Promise<TrakListDto> => decodeList(await get("/api/traks"))

/** `GET /api/traks/:id`. Free. 404 for an unknown id *and* for an empty log. */
export const trakDetail = async (id: string): Promise<TrakDetailDto> =>
  decodeDetail(await get(trakPath(id)))

/**
 * Where a trak's hosted processes are, or with no trak the project checkout's — the
 * engine's own key, where `undefined` is the project. A turn's token is refused on the
 * project's, which a person reaches from the git bar and nothing else does.
 */
const processesPath = (id: string | undefined): string =>
  id === undefined ? "/api/processes" : `${trakPath(id)}/processes`

/**
 * `GET /api/traks/:id/processes`, or `GET /api/processes` for the project checkout. Free.
 * Every process the project declares, at that checkout, run or not — the daemon's memory,
 * so an engine restart forgets everything but the `StoppedByRestart` it leaves for each
 * process it killed. 404 for an unknown trak.
 */
export const hostedProcesses = async (
  id: string | undefined,
): Promise<readonly HostedProcessDto[]> => decodeProcesses(await get(processesPath(id))).processes

/** What a press on a hosted process asks for. */
export type ProcessVerb = "start" | "restart" | "stop"

/**
 * `POST /api/traks/:id/processes/:name/{start,restart,stop}`, or `/api/processes/…` for the
 * project checkout. **Spends nothing and takes no custody**: it runs or kills a script in
 * the checkout, never a turn, so a drive under way does not refuse it.
 *
 * A start answers once it is decided — up, or failed to come up — which can be as long as
 * the declaration's `ready_seconds`. A start that failed is a 200 carrying that state:
 * the answer, not an error. 404 for an unknown trak, a trak with no checkout to run in, or
 * a name nothing declares.
 */
export const actOnProcess = async (
  id: string | undefined,
  name: string,
  verb: ProcessVerb,
): Promise<HostedProcessDto> =>
  decodeProcess(await post(`${processesPath(id)}/${encodeURIComponent(name)}/${verb}`, {}))

/**
 * `GET /api/traks/:id/image`, as a URL rather than as a request.
 *
 * **The one thing here that does not call `fetch`, and it is still the seam's.** An
 * `<img src>` is fetched by the browser, so what a component needs is the address and not
 * a promise — but the address is the wire protocol, and a component that spelled the route
 * out would be the second place it is written down. `Markdown` takes this as a function it
 * is handed and knows nothing about what it builds.
 *
 * Resolved against the base like every path above, so the image comes from under the
 * page's prefix: a root-relative `/api/…` in an `<img>` would ignore it.
 *
 * `path` names a file inside that trak's checkout. The engine answers 404 for everything
 * else, which is what the caller draws as alt text.
 *
 * **`version` is anything that moves when the file behind the path may have been
 * rewritten**, and the engine ignores it. A shot is overwritten in place under a name that
 * never changes, and a browser serves an `<img>` whose `src` it has already drawn out of
 * the document's own list of images — ahead of the HTTP cache, so `no-store` on the route
 * does not reach it. A surface that never reloads therefore shows the first bytes it saw
 * under an address for as long as it is open; only a different address makes it ask again.
 */
export const trakImageUrl = (id: string, path: string, version: number): string =>
  url(`${trakPath(id)}/image?path=${encodeURIComponent(path)}&v=${version}`)

/**
 * `GET /api/traks/:id/deploy` — what the project's `deploy.sh` says about this trak's
 * merge commit, now.
 *
 * **Every answer but `none` may run a script on the engine's machine**, which is why the
 * pane asks only where there is a commit to ask about (`deployAsked`) and polls no faster
 * than `POLL_MS`. The engine shares one run across every tab asking and hands the same
 * answer back for a short while, so two tabs polling are not two runs. `none` — no
 * `deploy.sh` in the project, or nothing merged yet — costs no run at all.
 */
export const deploy = async (id: string): Promise<DeployDto> =>
  decodeDeploy(await get(`${trakPath(id)}/deploy`))

/**
 * `GET /api/traks/:id/views/:call`. **Free, and it starts nothing**: one view an MCP
 * tool's call left, as the engine kept it — the HTML for a frame's `srcdoc`, and the
 * call's arguments and result for the view to draw from.
 *
 * `html` is never an address: see `ViewDto`. The network policy the server declared is
 * already written into it.
 */
export const fetchView = async (id: string, call: string): Promise<ViewDto> =>
  decodeView(await get(`${trakPath(id)}/views/${encodeURIComponent(call)}`))

/**
 * `POST /api/traks/:id/views/:call/call`. **Spends nothing**: one tool on the view's own
 * server, called through a CLI with no model turn. Answers with what the tool returned.
 *
 * With no turn running, the first one starts a CLI in the trak's checkout and waits for
 * it, so that call is slow and the ones after it are not.
 *
 * Four refusals: `403 ToolNotOpen` for a tool the server does not open to views, `409
 * NoCheckout` where the checkout is gone, `503 CliNotStarted` where the CLI did not come
 * up, and `502 ToolCallFailed` where it did and the call did not come back.
 */
export const callViewTool = async (
  id: string,
  call: string,
  tool: string,
  args: unknown,
): Promise<ViewResultDto> =>
  decodeViewResult(
    await post(`${trakPath(id)}/views/${encodeURIComponent(call)}/call`, {
      tool,
      arguments: args,
    }),
  )

/**
 * `GET /api/traks/archived?q=`. Free: the engine's memory of the put-away traks, with no
 * log opened. The only route that sends a row for one, and only what a search draws.
 */
export const archivedTraks = async (q: string): Promise<ArchivedTrakListDto> =>
  decodeArchived(await get(`/api/traks/archived?q=${encodeURIComponent(q)}`))
