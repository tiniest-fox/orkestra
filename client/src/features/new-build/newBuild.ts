/**
 * Whether the engine serves a newer client than this page is running, decided from three
 * ids and nothing else.
 *
 * Kind `pure`: the hook beside it asks the engine and holds what *Later* dismissed; this
 * says what the answer means.
 */

declare global {
  interface ImportMetaEnv {
    /** Compiled in by `vite.config.ts`'s build stamp. Absent under the dev server. */
    readonly VITE_BUILD_ID?: string
  }
}

/** The build this page was loaded from, or `undefined` under Vite's dev server. */
export const OWN_BUILD: string | undefined = import.meta.env.VITE_BUILD_ID

/**
 * The build id to offer a reload into, or `undefined` where there is nothing to offer.
 *
 * **Every *could not tell* is `undefined`**: a page with no id of its own, a read that
 * has not answered, and an engine reporting no id. Only an id that differs from this
 * page's and from the one *Later* set aside is news, so a second rebuild after a
 * dismissal is offered again.
 */
export const newerBuild = (
  own: string | undefined,
  reported: string | undefined,
  dismissed: string | undefined,
): string | undefined => {
  if (own === undefined || reported === undefined) return undefined
  if (reported === own || reported === dismissed) return undefined
  return reported
}
