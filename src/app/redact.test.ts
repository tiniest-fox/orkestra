import { describe, expect, it } from "vitest"
import { redact, redactor, secretValues, type SecretSources } from "./redact.js"

const CLAUDE = "sk-ant-oat01-claude-token-value"
const NAMED = "named-secret-from-host"
const RUNNER = "vm-runner-key-12345678"
const BACKUP = "backup-password-abcdef"

const sources = (env: Record<string, string>, hosted: readonly string[] = []): SecretSources => ({
  env,
  hosted,
  credentials: ["CLAUDE_CODE_OAUTH_TOKEN"],
  runner: { secret: "SANDBOX_KEY", pass: [] },
  backup: ["BACKUP_PASSWORD"],
  minted: [],
})

describe("secretValues", () => {
  it("takes the host's named variables, the CLI's sign-in, the runner's key and the backup's", () => {
    const values = secretValues(
      sources(
        {
          DEPLOY_TOKEN: NAMED,
          CLAUDE_CODE_OAUTH_TOKEN: CLAUDE,
          SANDBOX_KEY: RUNNER,
          BACKUP_PASSWORD: BACKUP,
          HOME: "/home/someone/with/a/long/path",
        },
        ["DEPLOY_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
      ),
    )
    expect(values).toEqual([CLAUDE, NAMED, RUNNER, BACKUP])
  })

  it("leaves out a value shorter than eight characters, and a name with no value", () => {
    expect(secretValues(sources({ SANDBOX_KEY: "short" }, ["MISSING", "", ""]))).toEqual([])
  })
})

describe("redact", () => {
  it("replaces every occurrence of each value and counts the values found", () => {
    const out = redact(`token ${CLAUDE} and ${RUNNER}, again ${CLAUDE}`, [CLAUDE, RUNNER, NAMED])
    expect(out).toEqual({
      text: "token [redacted] and [redacted], again [redacted]",
      found: [CLAUDE, RUNNER],
    })
  })

  it("redacts the longer of two values that overlap, whole", () => {
    expect(redact(CLAUDE, [CLAUDE, "claude-token"]).text).toBe("[redacted]")
  })

  it("leaves a text with no secret in it as it was, and counts none", () => {
    expect(redact("nothing here", [CLAUDE])).toEqual({ text: "nothing here", found: [] })
  })

  it("redacts a value JSON escaped once or twice, and counts it once", () => {
    const quoted = 'pa"ss\\word\n99'
    const once = JSON.stringify({ text: `using ${quoted}` })
    const twice = JSON.stringify({ envelope: once })
    const out = redact(`${quoted} ${once} ${twice}`, [quoted])
    expect(out.found).toEqual([quoted])
    for (const part of ["pa", "ss", "word", "99"]) expect(out.text).not.toContain(part)
  })
})

describe("redactor", () => {
  it("counts each value once across every piece it hides", () => {
    const hiding = redactor([CLAUDE, RUNNER])
    expect([hiding.hide(CLAUDE), hiding.hide(`${CLAUDE} ${RUNNER}`), hiding.hide("none")]).toEqual([
      "[redacted]",
      "[redacted] [redacted]",
      "none",
    ])
    expect(hiding.found()).toBe(2)
  })
})
