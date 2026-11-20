// The GitHub login the person's default browser holds, read out of its cookie store so the
// pull request view can carry the same one.
//
// **Read rather than signed in to**: Google refuses every sign-in inside an embedded
// browser, so the panel cannot finish Continue with Google itself. The person signs in
// where Google allows it, and the shell copies the result — `page-view.ts` writes it.
//
// Only a Chromium browser, and only on macOS. Its `Cookies` file is SQLite, read with
// `node:sqlite`; each value is AES-128-CBC under a key derived from the browser's
// "<Name> Safe Storage" keychain item, which `security` reads. **That read is what makes
// macOS ask the person** — so it runs only when the panel asks, never at launch, where a
// keychain prompt from nowhere reads as malware — and **at most once per browser per
// launch**: the key it returns is kept in this process's memory until the app quits.
// Allow, rather than Always Allow, grants one read; without the kept key, every panel open,
// return to the window and retry while a sign-in is pending would ask again.

import { execFile } from "node:child_process"
import { createDecipheriv, pbkdf2Sync } from "node:crypto"
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

/** Where one Chromium browser keeps its profiles, and the keychain item its key is in. */
interface Chromium {
  /** Under `~/Library/Application Support`. */
  readonly dir: string
  readonly keychain: string
}

/** By the name macOS gives the default browser — `app.getApplicationNameForProtocol`. */
const CHROMIUM: ReadonlyMap<string, Chromium> = new Map([
  ["Dia", { dir: "Dia/User Data", keychain: "Dia Safe Storage" }],
  ["Google Chrome", { dir: "Google/Chrome", keychain: "Chrome Safe Storage" }],
  ["Chromium", { dir: "Chromium", keychain: "Chromium Safe Storage" }],
  ["Arc", { dir: "Arc/User Data", keychain: "Arc Safe Storage" }],
  ["Brave Browser", { dir: "BraveSoftware/Brave-Browser", keychain: "Brave Safe Storage" }],
  ["Microsoft Edge", { dir: "Microsoft Edge", keychain: "Microsoft Edge Safe Storage" }],
])

/** One cookie as `session.cookies.set` takes it, less the URL. */
export interface GithubCookie {
  /** `github.com` for a host-only cookie, `.github.com` for one its subdomains share. */
  readonly host: string
  readonly name: string
  readonly value: string
  readonly path: string
  readonly secure: boolean
  readonly httpOnly: boolean
  /** Seconds since the Unix epoch; `undefined` for a session cookie. */
  readonly expires: number | undefined
  readonly sameSite: "unspecified" | "no_restriction" | "lax" | "strict"
}

/**
 * What the default browser had to give. `signed-out` is a Chromium browser with no GitHub
 * login, including one that has never been run; `keychain` is macOS refusing the key,
 * which is the person pressing Deny as often as anything.
 */
export type BrowserLogin =
  | { readonly state: "copied"; readonly cookies: readonly GithubCookie[] }
  | { readonly state: "signed-out" }
  | { readonly state: "keychain" }
  | { readonly state: "not-chromium" }

/** The cookie a GitHub login is: without it the browser is signed out, whatever else it holds. */
const LOGIN_COOKIE = "user_session"

/** Bounded: a keychain prompt nobody answers would otherwise hold every later copy. */
const KEYCHAIN_TIMEOUT_MS = 60_000

/** Chromium's fixed derivation on macOS: PBKDF2-HMAC-SHA1, this salt, 1003 rounds, 16 bytes. */
export const cookieKey = (password: string): Buffer =>
  pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1")

/** The IV Chromium uses for every value on macOS: sixteen spaces. */
const IV = Buffer.alloc(16, 0x20)

/** A SHA-256 of the cookie's domain, which a store at this version puts before the value. */
const DOMAIN_HASH_BYTES = 32
const DOMAIN_HASH_SINCE = 24

/**
 * One `encrypted_value` as text. `v10` is the only prefix macOS Chromium writes. **A store
 * at version 24 or later prepends the domain's hash to the plaintext**, and a value read
 * without stripping it is corrupt — GitHub then reads the panel as signed out, with no error
 * anywhere.
 */
export const decryptCookie = (encrypted: Uint8Array, key: Buffer, version: number): string => {
  const sealed = Buffer.from(encrypted)
  if (sealed.subarray(0, 3).toString("latin1") !== "v10")
    throw new Error("a cookie value is not v10-encrypted")
  const decipher = createDecipheriv("aes-128-cbc", key, IV)
  const plain = Buffer.concat([decipher.update(sealed.subarray(3)), decipher.final()])
  return (version >= DOMAIN_HASH_SINCE ? plain.subarray(DOMAIN_HASH_BYTES) : plain).toString("utf8")
}

/** Chromium counts microseconds from 1601; zero is a cookie that ends with the browser. */
const UNIX_FROM_1601_S = 11_644_473_600
const SAME_SITE = ["no_restriction", "lax", "strict"] as const

interface Row {
  readonly host_key: string
  readonly name: string
  readonly value: string
  readonly encrypted_value: Uint8Array
  readonly path: string
  readonly expires_utc: bigint
  readonly is_secure: number
  readonly is_httponly: number
  readonly samesite: number
}

const rowOf = (raw: Record<string, unknown>): Row => {
  const text = (field: string): string => {
    const value = raw[field]
    if (typeof value !== "string") throw new TypeError(`cookies.${field} is not text`)
    return value
  }
  const integer = (field: string): bigint => {
    const value = raw[field]
    if (typeof value !== "bigint") throw new TypeError(`cookies.${field} is not an integer`)
    return value
  }
  const blob = raw["encrypted_value"]
  return {
    host_key: text("host_key"),
    name: text("name"),
    value: text("value"),
    encrypted_value: blob instanceof Uint8Array ? blob : new Uint8Array(),
    path: text("path"),
    expires_utc: integer("expires_utc"),
    is_secure: Number(integer("is_secure")),
    is_httponly: Number(integer("is_httponly")),
    samesite: Number(integer("samesite")),
  }
}

/**
 * Every `github.com` cookie in a Chromium `Cookies` file, decrypted with the keychain
 * `password`. The file is opened read-only, and it has to be a copy: the browser holds its
 * own store locked while it runs.
 */
export const readGithubCookies = (file: string, password: string): readonly GithubCookie[] => {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get()
    const version = Number(meta?.["value"] ?? 0)
    const key = cookieKey(password)
    const select = db.prepare(
      "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies WHERE host_key IN ('github.com', '.github.com')",
    )
    // An expiry in microseconds since 1601 is past what a JavaScript number holds exactly,
    // and the read throws rather than round it.
    select.setReadBigInts(true)
    const rows = select.all().map(rowOf)
    return rows.map((row) => ({
      host: row.host_key,
      name: row.name,
      value:
        row.encrypted_value.length === 0
          ? row.value
          : decryptCookie(row.encrypted_value, key, version),
      path: row.path,
      secure: row.is_secure !== 0,
      httpOnly: row.is_httponly !== 0,
      expires:
        row.expires_utc === 0n
          ? undefined
          : Number(row.expires_utc / 1_000_000n) - UNIX_FROM_1601_S,
      sameSite: SAME_SITE[row.samesite] ?? "unspecified",
    }))
  } finally {
    db.close()
  }
}

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

/** The profile the browser last used — what it opens a link in — else `Default`. */
const profileOf = async (root: string): Promise<string> => {
  const state: unknown = await readFile(join(root, "Local State"), "utf8").then(
    (text): unknown => JSON.parse(text),
    () => undefined,
  )
  const profile: unknown =
    typeof state === "object" && state !== null && "profile" in state ? state.profile : undefined
  const last: unknown =
    typeof profile === "object" && profile !== null && "last_used" in profile
      ? profile.last_used
      : undefined
  return typeof last === "string" && last !== "" ? last : "Default"
}

/** The profile's cookie store, wherever this Chromium version keeps it, if it has one. */
const cookieFile = async (root: string): Promise<string | undefined> => {
  const profile = join(root, await profileOf(root))
  for (const file of [join(profile, "Network", "Cookies"), join(profile, "Cookies")])
    if (await exists(file)) return file
  return undefined
}

/** The browser's Safe Storage password, or `undefined` when macOS did not hand it over. */
export type Keychain = (service: string) => Promise<string | undefined>

const keychainPassword: Keychain = (service) =>
  new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-w", "-s", service],
      { timeout: KEYCHAIN_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        const password = stdout.trim()
        resolve(error === null && password !== "" ? password : undefined)
      },
    )
  })

/**
 * Each browser's key, by keychain item, once macOS has handed it over — or the read under
 * way, so two windows copying at once share one prompt. A refusal is not kept: Try again
 * asks macOS again.
 */
const keys = new Map<string, Promise<string | undefined>>()

const keyFor = (service: string, ask: Keychain): Promise<string | undefined> => {
  const known = keys.get(service)
  if (known !== undefined) return known
  const asked = ask(service).then((password) => {
    if (password === undefined) keys.delete(service)
    return password
  })
  keys.set(service, asked)
  return asked
}

/**
 * The GitHub login of the browser macOS calls `browser`, read under `home`. Throws only
 * for what none of the four states describes — a store this code cannot read. `ask` is
 * how the keychain is read, taken so a test can count the prompts.
 */
export const readBrowserLogin = async (
  browser: string,
  home: string,
  ask: Keychain = keychainPassword,
): Promise<BrowserLogin> => {
  const chromium = CHROMIUM.get(browser)
  if (chromium === undefined) return { state: "not-chromium" }
  const file = await cookieFile(join(home, "Library", "Application Support", chromium.dir))
  if (file === undefined) return { state: "signed-out" }
  const password = await keyFor(chromium.keychain, ask)
  if (password === undefined) return { state: "keychain" }
  const scratch = await mkdtemp(join(tmpdir(), "orkestra-cookies-"))
  try {
    const copy = join(scratch, "Cookies")
    await copyFile(file, copy)
    const cookies = (() => {
      try {
        return readGithubCookies(copy, password)
      } catch (error) {
        // A kept key the browser has since replaced fails every read; the next copy asks again.
        keys.delete(chromium.keychain)
        throw error
      }
    })()
    return cookies.some((cookie) => cookie.name === LOGIN_COOKIE && cookie.value !== "")
      ? { state: "copied", cookies }
      : { state: "signed-out" }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
