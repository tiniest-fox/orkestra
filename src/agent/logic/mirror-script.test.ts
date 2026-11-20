import { describe, expect, it } from "vitest"
import { archivePath, mirrorRecordIn, mirrorScript } from "./mirror-script.js"

const DIGEST = "a".repeat(64)

describe("archivePath", () => {
  it("puts a home path under h/ and an absolute one under r/, without its leading slash", () => {
    expect(archivePath({ at: ".claude/settings.json", underHome: true })).toBe(
      "h/.claude/settings.json",
    )
    expect(archivePath({ at: "/srv/run.sh", underHome: false })).toBe("r/srv/run.sh")
  })
})

describe("mirrorScript", () => {
  const script = mirrorScript(
    new Uint8Array([1, 2, 3]),
    [
      { at: ".claude/skills/gone/SKILL.md", underHome: true },
      { at: "/srv/it's gone", underHome: false },
    ],
    { digest: DIGEST, keys: ["/srv/run.sh", "~/.claude/settings.json"] },
  )

  it("carries the archive as base64 and unpacks it beside the home before moving it into place", () => {
    expect(script).toContain(`<<'ORKESTRA_MIRROR_END'\nAQID\nORKESTRA_MIRROR_END\n`)
    expect(script.indexOf('tar -x -z -m -f "$s.tgz" -C "$s"')).toBeLessThan(
      script.indexOf('place h "$HOME"'),
    )
  })

  it("deletes each removed path, quoted, after the files are in place", () => {
    expect(script).toContain(
      `place r /\nrm -rf "$s" "$s.tgz"\nrm -f "$HOME"/'.claude/skills/gone/SKILL.md'\nrm -f '/srv/it'\\''s gone'\n`,
    )
  })

  it("writes the record last, as its digest and each key as JSON, over the one before", () => {
    expect(
      script.endsWith(
        `cat > "$s.record" <<'ORKESTRA_RECORD_END'\n${DIGEST}\n"/srv/run.sh"\n"~/.claude/settings.json"\nORKESTRA_RECORD_END\nmv -f "$s.record" "$HOME"/'.orkestra-mirror'\n`,
      ),
    ).toBe(true)
  })
})

describe("mirrorRecordIn", () => {
  it("reads the digest and every key, skipping a line cut short", () => {
    const record = [DIGEST, '"/a"', '"/with\\nnewline"', '"/cut', ""].join("\n")
    expect(mirrorRecordIn(record)).toEqual({ digest: DIGEST, keys: ["/a", "/with\nnewline"] })
  })

  it("reads no digest from an empty record, or one whose first line is not a hash", () => {
    expect(mirrorRecordIn("")).toEqual({ digest: undefined, keys: [] })
    expect(mirrorRecordIn('["h1","/a"]\n"/b"')).toEqual({ digest: undefined, keys: ["/b"] })
  })
})
