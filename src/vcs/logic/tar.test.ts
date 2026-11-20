import { describe, expect, it } from "vitest"
import { filesOfTar, tarOf } from "./tar.js"

const text = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes)

describe("a tree of files as a tar stream", () => {
  it("reads back every file it wrote, nested, empty and past a hundred bytes of name alike", () => {
    const long = `${"deep/".repeat(30)}file.md`
    const tar = tarOf(
      new Map<string, string | Uint8Array>([
        ["a.md", "# a\n"],
        ["piece/b.md", "naïve — ünïcode\n"],
        ["empty", ""],
        [long, "far down"],
        ["bytes.bin", new Uint8Array([0, 255, 10, 13])],
      ]),
    )
    expect(tar.length % 512).toBe(0)
    const files = filesOfTar(tar)
    expect([...files.keys()].sort()).toEqual(["a.md", "bytes.bin", long, "empty", "piece/b.md"])
    expect(text(files.get("piece/b.md"))).toBe("naïve — ünïcode\n")
    expect(text(files.get(long))).toBe("far down")
    expect([...(files.get("bytes.bin") ?? [])]).toEqual([0, 255, 10, 13])
  })

  it("reads names without the `./` that `tar -C <dir> .` writes, and skips what is not a file", () => {
    const tar = tarOf(new Map([["./x/y.txt", "y"]]))
    expect([...filesOfTar(tar).keys()]).toEqual(["x/y.txt"])
  })

  it("stops at the last whole entry of a stream cut short", () => {
    const tar = tarOf(
      new Map([
        ["one", "1"],
        ["two", "2".repeat(2000)],
      ]),
    )
    expect([...filesOfTar(tar.subarray(0, 1024 + 600)).keys()]).toEqual(["one"])
    expect(filesOfTar(new Uint8Array()).size).toBe(0)
  })
})
