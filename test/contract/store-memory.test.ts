import { MemoryRunsLayer } from "../../src/workflow/adapters/runs-memory.js"
import { MemoryStoreLayer } from "../../src/workflow/adapters/store-memory.js"
import { storeContract, storeUnfencedContract } from "./store.js"

const memory = {
  label: "memory",
  // Ignores the scratch dir — a fresh `Ref` per Layer build is isolation enough.
  layer: () => MemoryStoreLayer,
  runs: () => MemoryRunsLayer,
}

storeContract(memory)
storeUnfencedContract(memory)
