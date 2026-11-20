// Tier-1: the vocabulary two features have to agree on.

import { describe, expect, it } from "vitest"
import { queryKeys } from "./queryCache"

const ID = "1dd2b03b-a627-457d-a44c-43b1240d0528"

describe("queryKeys", () => {
  it("names the list and one trak", () => {
    expect(queryKeys.traks).toEqual(["traks"])
    expect(queryKeys.trak(ID)).toEqual(["trak", ID])
  })

  it("keys two traks apart", () => {
    expect(queryKeys.trak("a")).not.toEqual(queryKeys.trak("b"))
  })

  it("does not make the list key a prefix of a detail key", () => {
    // `invalidateQueries` matches by prefix. A detail keyed `["traks", id]` would put
    // every open detail inside every list invalidation — twice the refetches, and a
    // second, silent, definition of what an action makes stale.
    expect(queryKeys.trak(ID)[0]).not.toBe(queryKeys.traks[0])
  })
})
