// The shell adapter against the real `bash`, with the library reduced to the one
// field it reads: which script, if any, is the project's. What a hosted engine asks its host
// is `environment-host.test.ts`.

import { Layer } from "effect"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { Lib } from "../../src/library/ports/library.js"
import { ShellEnvironmentLayer } from "../../src/workflow/adapters/environment-shell.js"
import { library } from "../support/library.js"
import { environmentContract } from "./environment.js"

environmentContract({
  label: "shell",
  layer: (env) =>
    ShellEnvironmentLayer().pipe(
      Layer.provide(Layer.merge(NodeProcessLayer, Layer.succeed(Lib, library({ env })))),
    ),
  timeoutMs: 15_000,
})
