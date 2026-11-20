import { MemoryGoalStoreLayer } from "../../src/workflow/adapters/goal-store-memory.js"
import { MemoryStoreLayer } from "../../src/workflow/adapters/store-memory.js"
import { goalStoreContract, goalStoreUnfencedContract } from "./goal-store.js"

const memory = {
  label: "memory",
  // Ignores the scratch dir — a fresh `Ref` per Layer build is isolation enough.
  layer: () => MemoryGoalStoreLayer,
  store: () => MemoryStoreLayer,
}

goalStoreContract(memory)
goalStoreUnfencedContract(memory)
