// Hosted processes — a trak's dev servers, and the project checkout's. No custody, no
// event: a process never moves a trak, so starting one is not a drive and is never
// refused by one.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import type { TrakId } from "../../workflow/domain/trak.js"
import { HostedProcesses } from "../../workflow/ports/hosted-processes.js"
import { Store } from "../../workflow/ports/store.js"
import { toHostedProcessDto, toHostedProcessListDto } from "../dto.js"
import { pathId, PROJECT, checkoutOf } from "./common.js"

/** The `:name` segment, or nothing. A name no declaration has is the supervisor's 404. */
const pathName = Effect.map(Router.params, (params) => params["name"])

const notDeclared = (name: string) =>
  ServerResponse.empty({ status: 404, statusText: `no process \`${name}\` is declared` })

/** Every declared process at the trak, run or not, with what each has printed. */
const processesRoute = Router.get(
  "/api/traks/:id/processes",
  Effect.gen(function* () {
    const id = yield* pathId
    const events = yield* (yield* Store).events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const cwd = (yield* checkoutOf(id)) ?? ""
    return yield* ServerResponse.json(
      toHostedProcessListDto(yield* (yield* HostedProcesses).list(id, cwd)),
    )
  }),
)

/** Every declared process on the project checkout, run or not. */
const projectProcessesRoute = Router.get(
  "/api/processes",
  Effect.gen(function* () {
    return yield* ServerResponse.json(
      toHostedProcessListDto(yield* (yield* HostedProcesses).list(undefined, PROJECT)),
    )
  }),
)

/** One start, restart or stop, answered as the process stands — or 404 for a name not declared. */
const actOn = (
  verb: "start" | "restart" | "stop",
  trak: TrakId | undefined,
  cwd: string,
  name: string,
) =>
  Effect.gen(function* () {
    const hosted = yield* HostedProcesses
    const run =
      verb === "stop"
        ? hosted.stop(trak, name)
        : verb === "start"
          ? hosted.start(trak, cwd, name)
          : hosted.restart(trak, cwd, name)
    return yield* run.pipe(
      Effect.flatMap((process) => ServerResponse.json(toHostedProcessDto(process))),
      Effect.catchTag("UnknownProcess", () => Effect.succeed(notDeclared(name))),
    )
  })

/**
 * Start, restart or stop one process, answering with where it stands once the start is
 * decided — up, or failed to come up — so the press can show the URL. A start that
 * failed is a 200 carrying that state: it is the answer, not an error.
 *
 * 404 unknown trak, no checkout, or a name no `.orkestra/processes/` script declares.
 */
const processActRoute = (verb: "start" | "restart" | "stop") =>
  Router.post(
    `/api/traks/:id/processes/:name/${verb}`,
    Effect.gen(function* () {
      const id = yield* pathId
      const name = yield* pathName
      if (name === undefined || name === "") return ServerResponse.empty({ status: 400 })
      const cwd = yield* checkoutOf(id)
      if (cwd === undefined && verb !== "stop")
        return ServerResponse.empty({ status: 404, statusText: "no checkout" })
      return yield* actOn(verb, id, cwd ?? "", name)
    }),
  )

/** The same on the project checkout: the processes run there and write its registry. */
const projectProcessActRoute = (verb: "start" | "restart" | "stop") =>
  Router.post(
    `/api/processes/:name/${verb}`,
    Effect.gen(function* () {
      const name = yield* pathName
      if (name === undefined || name === "") return ServerResponse.empty({ status: 400 })
      return yield* actOn(verb, undefined, PROJECT, name)
    }),
  )

/** What the process's current run has printed, as plain text. */
const logsOf = (trak: TrakId | undefined) =>
  Effect.gen(function* () {
    const name = yield* pathName
    const cwd = trak === undefined ? PROJECT : ((yield* checkoutOf(trak)) ?? "")
    const runs = yield* (yield* HostedProcesses).list(trak, cwd)
    const run = runs.find((r) => r.name === name)
    if (run === undefined) return notDeclared(name ?? "")
    return ServerResponse.text(run.log)
  })

const processLogsRoute = Router.get(
  "/api/traks/:id/processes/:name/logs",
  Effect.flatMap(pathId, logsOf),
)

const projectProcessLogsRoute = Router.get("/api/processes/:name/logs", logsOf(undefined))

export const processRoutes = Router.empty.pipe(
  processesRoute,
  processActRoute("start"),
  processActRoute("restart"),
  processActRoute("stop"),
  processLogsRoute,
  projectProcessesRoute,
  projectProcessActRoute("start"),
  projectProcessActRoute("restart"),
  projectProcessActRoute("stop"),
  projectProcessLogsRoute,
)
