import { createCipheriv, createHash } from "node:crypto"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { cookieKey, type Keychain, readBrowserLogin, readGithubCookies } from "./browser-login.js"

// A Chromium `Cookies` file written the way macOS Chromium writes one: v10 values under a
// key derived from the keychain password, with the domain's hash ahead of the plaintext at
// store version 24.
const PASSWORD = "synthetic-safe-storage-key"

const seal = (host: string, value: string, version: number): Buffer => {
  const cipher = createCipheriv("aes-128-cbc", cookieKey(PASSWORD), Buffer.alloc(16, 0x20))
  const hash = version >= 24 ? createHash("sha256").update(host).digest() : Buffer.alloc(0)
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(Buffer.concat([hash, Buffer.from(value)])),
    cipher.final(),
  ])
}

const store = (version: number, dir = mkdtempSync(join(tmpdir(), "cookies-test-"))): string => {
  const file = join(dir, "Cookies")
  const db = new DatabaseSync(file)
  db.exec("CREATE TABLE meta (key TEXT, value TEXT)")
  db.prepare("INSERT INTO meta VALUES ('version', ?)").run(String(version))
  db.exec(
    "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)",
  )
  const insert = db.prepare("INSERT INTO cookies VALUES (?, ?, '', ?, '/', ?, 1, ?, ?)")
  insert.run("github.com", "user_session", seal("github.com", "abc123", version), 0, 1, 1)
  // 2030-01-01T00:00:00Z, in Chromium's microseconds since 1601.
  insert.run(
    ".github.com",
    "logged_in",
    seal(".github.com", "yes", version),
    13_537_929_600_000_000,
    0,
    0,
  )
  insert.run("gist.github.com", "user_session", seal("gist.github.com", "other", version), 0, 1, 1)
  db.close()
  return file
}

describe("reading GitHub's cookies out of a Chromium store", () => {
  it("decrypts github.com's cookies and strips the domain hash a version-24 store adds", () => {
    expect(readGithubCookies(store(24), PASSWORD)).toStrictEqual([
      {
        host: "github.com",
        name: "user_session",
        value: "abc123",
        path: "/",
        secure: true,
        httpOnly: true,
        expires: undefined,
        sameSite: "lax",
      },
      {
        host: ".github.com",
        name: "logged_in",
        value: "yes",
        path: "/",
        secure: true,
        httpOnly: false,
        expires: 1_893_456_000,
        sameSite: "no_restriction",
      },
    ])
  })

  it("keeps the whole plaintext from an older store", () => {
    expect(readGithubCookies(store(23), PASSWORD).map((cookie) => cookie.value)).toStrictEqual([
      "abc123",
      "yes",
    ])
  })

  it("fails rather than handing over garbage under the wrong key", () => {
    expect(() => readGithubCookies(store(24), "wrong")).toThrow("bad decrypt")
  })
})

describe("asking macOS for a browser's key", () => {
  /** A home directory holding one signed-in profile of `dir`, under Application Support. */
  const homeWith = (dir: string): string => {
    const home = mkdtempSync(join(tmpdir(), "home-test-"))
    const profile = join(home, "Library", "Application Support", dir, "Default")
    mkdirSync(profile, { recursive: true })
    store(24, profile)
    return home
  }
  /** A keychain that counts its prompts and answers each from `answers` in turn. */
  const prompts = (...answers: (string | undefined)[]) => {
    const asked = { count: 0 }
    const ask: Keychain = () => {
      asked.count += 1
      return Promise.resolve(asked.count <= answers.length ? answers[asked.count - 1] : PASSWORD)
    }
    return { asked, ask }
  }

  it("prompts once, and every later copy reuses the key", async () => {
    const home = homeWith("Dia/User Data")
    const { asked, ask } = prompts(PASSWORD)
    const reads = await Promise.all([
      readBrowserLogin("Dia", home, ask),
      readBrowserLogin("Dia", home, ask),
    ])
    reads.push(await readBrowserLogin("Dia", home, ask))
    expect(reads.map((read) => read.state)).toStrictEqual(["copied", "copied", "copied"])
    expect(asked.count).toBe(1)
  })

  it("keeps no refusal, so Try again prompts again", async () => {
    const home = homeWith("Arc/User Data")
    const { asked, ask } = prompts(undefined, PASSWORD)
    expect((await readBrowserLogin("Arc", home, ask)).state).toBe("keychain")
    expect((await readBrowserLogin("Arc", home, ask)).state).toBe("copied")
    expect((await readBrowserLogin("Arc", home, ask)).state).toBe("copied")
    expect(asked.count).toBe(2)
  })

  it("drops a kept key that no longer opens the store, so the next copy asks again", async () => {
    const home = homeWith("BraveSoftware/Brave-Browser")
    const { asked, ask } = prompts("replaced", PASSWORD)
    await expect(readBrowserLogin("Brave Browser", home, ask)).rejects.toThrow("bad decrypt")
    expect((await readBrowserLogin("Brave Browser", home, ask)).state).toBe("copied")
    expect(asked.count).toBe(2)
  })
})
