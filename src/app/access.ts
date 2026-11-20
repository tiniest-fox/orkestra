// What every door in front of an engine needs to admit a request: the engine's own guard
// (`guard.ts`) and any host a deployment puts in front of many engines. One copy, so the two
// doors cannot drift apart on what counts as the same token, as HTTPS, or as the page's
// own write.
//
// Each check takes the request's headers as a plain lowercase record — what both Node's
// `IncomingMessage` and Effect's request carry — so neither door adapts to the other.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import type { NetworkInterfaceInfo } from "node:os"
import { dirname } from "node:path"
import { Duration } from "effect"
import type * as Cookies from "@effect/platform/Cookies"

export const LOOPBACK = "127.0.0.1"
export const EVERY_INTERFACE = "0.0.0.0"

/**
 * The addresses a phone on the same network could open, out of what the OS reports.
 *
 * A listener bound to `0.0.0.0` can only report that address, which nothing can open.
 * IPv4 only and never the loopback interface: an IPv6 link-local address needs a zone id
 * a phone's browser cannot type.
 */
export const reachable = (
  interfaces: Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>,
): readonly string[] =>
  Object.values(interfaces).flatMap((addresses) =>
    (addresses ?? [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => address.address),
  )

/**
 * What a wrong secret costs, and it is charged one attempt at a time.
 *
 * A failed guess holds the one permit for this long before it is answered, so guesses
 * are answered at one a second however many arrive at once. A right one skips the wait
 * but not the permit: it is answered when its turn comes. **A flood therefore delays the
 * owner's own correct answer** by a second per guess already queued — what the throttle
 * buys is that nobody guesses faster than one a second, not that the owner is unaffected.
 * Not a lockout counter, which would refuse the owner outright; and not per-address,
 * which would mean reading a remote address neither door reads.
 */
export const FAILED_LOGIN_DELAY = Duration.seconds(1)

/** Random, and read by nothing but a timing-safe comparison. */
export const mintToken = (): string => randomBytes(32).toString("hex")

/** What a store keeps in place of a token: a copy of the file opens nothing. */
export const hashOf = (token: string): string => createHash("sha256").update(token).digest("hex")

/**
 * Equal, in time that does not depend on where they differ.
 *
 * Hashed first so the two buffers are the same length whatever was typed —
 * `timingSafeEqual` throws on a length mismatch, which would itself leak the length.
 */
export const same = (given: string, expected: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(given).digest(),
    createHash("sha256").update(expected).digest(),
  )

type Headers = Readonly<Record<string, string | readonly string[] | undefined>>

const header = (headers: Headers, name: string): string | undefined => {
  const value = headers[name]
  return typeof value === "string" ? value : value?.[0]
}

/**
 * Whether the request reached the machine over TLS, as the thing terminating it says.
 *
 * Read from `x-forwarded-proto` because the listener itself only ever speaks plain HTTP:
 * a tunnel terminates TLS and says so; the LAN path sends nothing and is plain. Trusting
 * the header is safe because the only thing that can set it is on the machine or on the
 * same wifi, and a client forging `https` over plain HTTP earns a cookie its own browser
 * then refuses to send — it locks itself out and nobody else.
 */
export const arrivedOverHttps = (headers: Headers): boolean =>
  (header(headers, "x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase() === "https"

/**
 * The header the host names who pressed in: a user's id from its `users.json`, set on every
 * request it forwards to an engine and stripped from whatever the client sent. **An engine
 * reads it only beside its own bearer**, which only the host holds — the guard drops it from
 * every other request, so a plain engine with no host in front never sees one.
 */
export const USER_HEADER = "x-orkestra-user"

/** The `Authorization: Bearer` value, or `undefined` when there is none. */
export const bearerOf = (headers: Headers): string | undefined => {
  const value = header(headers, "authorization")
  if (value === undefined || !value.toLowerCase().startsWith("bearer ")) return undefined
  return value.slice("bearer ".length).trim()
}

/**
 * Whether the browser says this request is the page's own — an allowlist, and absent is
 * not on it.
 *
 * `same-origin` is the page's own `fetch`; `none` is a navigation nobody scripted. The
 * other two values are not the page's: `cross-site` is another site, and `same-site` is
 * another origin under the same registrable domain — the one case `SameSite=Lax` also
 * lets through, so it cannot be left to the cookie. A request with no header is a client
 * this door does not have, and is refused the same way.
 */
export const fromOwnPage = (headers: Headers): boolean => {
  const site = header(headers, "sec-fetch-site")
  return site === "same-origin" || site === "none"
}

export const reads = (method: string): boolean => method === "GET" || method === "HEAD"

/**
 * How a credential cookie is set, by either door. `maxAge` is its lifetime. `domain` is
 * the parent domain a host serves process pages under, so the cookie reaches each page's
 * own hostname; without one the cookie is the setting host's alone.
 */
export const cookieAttributes = (
  headers: Headers,
  maxAge: Duration.Duration,
  domain?: string,
): NonNullable<Cookies.Cookie["options"]> => ({
  ...(domain === undefined ? {} : { domain }),
  httpOnly: true,
  // `lax`, not `strict`: a link opened from somewhere else is a top-level navigation and
  // should arrive signed in. A cross-site `POST` still gets no cookie, which is what the
  // setting is for.
  sameSite: "lax",
  path: "/",
  maxAge,
  // Conditional for one reason only: the `--host` LAN path is plain HTTP, and a browser
  // will not send a `Secure` cookie over it — the sign-in would succeed and the next
  // request would arrive with nothing, which looks exactly like never having signed in.
  // Drop `--host` and this becomes `true`.
  secure: arrivedOverHttps(headers),
})

/**
 * `text` at `path`, readable by this user alone. **`mode` on the write, and `chmod` after
 * it**: `mode` only applies to a file being created, so a file an earlier run left behind
 * keeps whatever mode it had, and the second call is what makes the claim true every time.
 */
export const writePrivate = async (path: string, text: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 })
  await chmod(path, 0o600)
}
