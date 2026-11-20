import { MemoryRunsLayer } from "../../src/workflow/adapters/runs-memory.js"
import { runsContract } from "./runs.js"

runsContract({
  label: "memory",
  layer: () => MemoryRunsLayer,
})
