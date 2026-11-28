import { describe, expect, it } from "vitest"
import {
  hideTokenShapes,
  redact,
  redactor,
  reportCleaner,
  secretValues,
  type SecretSources,
} from "./redact.js"

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

/** One of each shape, none of which the engine holds as a value. */
const SHAPED = {
  github: "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB",
  githubPat: "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
  anthropic: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
  openai: "sk-proj-abcdefghijklmnopqrstuvwxyz0123",
  awsId: "AKIAIOSFODNN7EXAMPLE",
  awsSecret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  bearer: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
  pem: "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
}

describe("hideTokenShapes", () => {
  it("takes out each well-known token shape, and the value beside a name", () => {
    const text = [
      `push with ${SHAPED.github}`,
      `fine-grained ${SHAPED.githubPat}`,
      `ANTHROPIC_API_KEY=${SHAPED.anthropic}`,
      `OPENAI_API_KEY=${SHAPED.openai}`,
      `id ${SHAPED.awsId}`,
      `aws_secret_access_key = ${SHAPED.awsSecret}`,
      `Authorization: Bearer ${SHAPED.bearer}`,
      `-----BEGIN RSA PRIVATE KEY-----\\n${SHAPED.pem}\\n-----END RSA PRIVATE KEY----- after`,
    ].join("\n")
    const hidden = hideTokenShapes(text)
    for (const value of Object.values(SHAPED)) expect(hidden).not.toContain(value)
    expect(hidden).toContain("aws_secret_access_key = [redacted]")
    expect(hidden).toContain("Authorization: Bearer [redacted]")
    expect(hidden).toContain("[redacted] after")
  })

  it("takes a private key whose end is not in the text to the end of the text", () => {
    expect(hideTokenShapes(`key -----BEGIN PRIVATE KEY-----${SHAPED.pem}`)).toBe("key [redacted]")
  })

  it("leaves ordinary words, short ids and a sha alone", () => {
    const text = "the task-runner sk-short a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 Bearer of news"
    expect(hideTokenShapes(text)).toBe(text)
  })
})

describe("reportCleaner", () => {
  it("takes out held values and token shapes, and counts every mark it added", () => {
    const cleaner = reportCleaner([NAMED])
    expect(cleaner.clean(`${NAMED} then ${SHAPED.github} and already [redacted]`)).toBe(
      "[redacted] then [redacted] and already [redacted]",
    )
    expect(cleaner.clean(NAMED)).toBe("[redacted]")
    expect(cleaner.marked()).toBe(3)
  })
})
