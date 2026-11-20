/**
 * Where a process's page is served when a host in front of the engine has a page domain:
 * `<label>.<page domain>`, one hostname per process per trak per project, which
 * `@orkestra/shared`'s `pageLabel` builds and the host splits back.
 *
 * **The page learns the domain from a `<meta>` the host writes beside `<base href>`**, and
 * the project from the base's `/p/<id>/` — so the engine never learns it is behind a host,
 * `client/src/base.ts`'s rule. With no such tag there is no page domain, and a process is
 * framed at the loopback address the engine reports, as it is in Orkestra.app and under
 * `pnpm ui`.
 *
 * On the seam because the label is a value of the wire package, which only `api/` may
 * import as one.
 */

import { PAGE_DOMAIN_META, pageLabel } from "@orkestra/shared/page-host"

/** The project a host serves this page for, out of a base of `/p/<id>/`. */
const PROJECT = /^\/p\/([^/]+)\/$/u

/**
 * The origin each process at `trak` is served from, by name — `trak` `undefined` for the
 * project checkout — or `undefined` with no page domain. The function answers `undefined`
 * for a process whose label would not fit in a hostname. `domain` is the tag's content, and
 * `baseURI` the page's.
 */
export const pageOriginsAt = (
  domain: string | undefined,
  baseURI: string,
  trak: string | undefined,
): ((process: string) => string | undefined) | undefined => {
  const base = new URL(baseURI)
  const project = PROJECT.exec(base.pathname)?.[1]
  if (domain === undefined || domain === "" || project === undefined) return undefined
  const id = decodeURIComponent(project)
  return (process) => {
    const label = pageLabel(process, trak, id)
    return label === undefined ? undefined : `${base.protocol}//${label}.${domain}`
  }
}

/** `pageOriginsAt` for this page. */
export const pageOrigins = (
  trak: string | undefined,
): ((process: string) => string | undefined) | undefined =>
  pageOriginsAt(
    document.querySelector<HTMLMetaElement>(`meta[name="${PAGE_DOMAIN_META}"]`)?.content,
    document.baseURI,
    trak,
  )
