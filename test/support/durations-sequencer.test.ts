import { describe, expect, it } from "vitest"
import { shardByDuration } from "./durations-sequencer.js"

const took = new Map([
  ["long-a", 94_000],
  ["long-b", 63_000],
  ["long-c", 32_000],
  ["long-d", 30_000],
  ["test/verify-light.test.ts", 27_000],
  ["short-a", 2_000],
  ["short-b", 1_000],
])
const files = [...took.keys(), "unrecorded"]
const shards = (count: number): string[][] =>
  Array.from({ length: count }, (_, i) => shardByDuration(files, took, i + 1, count))

describe("shardByDuration", () => {
  it("puts every file in exactly one shard", () => {
    for (const count of [1, 2, 3, 4]) {
      expect(shards(count).flat().toSorted()).toEqual(files.toSorted())
    }
  })

  it("spreads the long files across the shards so they finish together", () => {
    const [first, second] = shards(2)
    expect(first).toEqual(["long-a", "long-c", "test/verify-light.test.ts"])
    expect(second).toEqual(["long-b", "unrecorded", "long-d", "short-a", "short-b"])
  })

  it("splits the same way whatever order the files arrive in", () => {
    const reversed = files.toReversed()
    expect(shardByDuration(reversed, took, 1, 3)).toEqual(shardByDuration(files, took, 1, 3))
  })
})
