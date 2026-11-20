// The hostname a process's page is served at behind the host: `<label>.<page domain>`, one
// per process per trak per project, so no tool needs a base path and a page an agent wrote
// never shares Orkestra's origin. The host splits a label back to its three parts; the
// client builds one to frame and to recognise in a link. One copy, so the two cannot
// disagree about which name means which page.
//
// **The label is `<process>--<trak>--<project>`.** A process name is kebab and a trak id
// is words joined by single hyphens, so neither holds `--`, and splitting at the first two
// is exact. A project id may hold `--`, which is why it goes last. A DNS label is 63
// characters at most: past that the project id becomes an eight-hex hash of it, and past
// that again there is no label at all.
//
// **A process on the project checkout, which no trak owns, takes `checkout` as its trak.**
// No trak id can be that word: a minted one is three words joined by hyphens and a legacy
// one is a UUID, so every trak id holds a hyphen and `checkout` holds none. The reserved
// word keeps the label three parts, where a two-part form would have to be told apart from
// a project id holding `--`.

/**
 * The `<meta name>` the host writes into each project's page, beside its `<base href>`,
 * whose `content` is the page domain. Absent, there is none, and a page is framed at its
 * loopback address.
 */
export const PAGE_DOMAIN_META = "orkestra-page-domain"

/** The longest DNS label. */
const LABEL_LIMIT = 63

const JOIN = "--"

/** The trak segment that names the project checkout, which no trak id can be. */
const CHECKOUT = "checkout"

/**
 * FNV-1a over the UTF-16 code units, as eight hex digits. Not a secret and not a
 * guard — only short — and synchronous, which the browser's `crypto.subtle` is not.
 */
const shortHash = (text: string): string => {
  let hash = 0x81_1c_9d_c5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/**
 * The label for `process` at `trak` in `project` — `trak` `undefined` for the project
 * checkout — or `undefined` when even the hashed form is longer than a DNS label allows.
 */
export const pageLabel = (
  process: string,
  trak: string | undefined,
  project: string,
): string | undefined => {
  const at = trak ?? CHECKOUT
  const whole = [process, at, project].join(JOIN)
  if (whole.length <= LABEL_LIMIT) return whole
  const hashed = [process, at, shortHash(project)].join(JOIN)
  return hashed.length <= LABEL_LIMIT ? hashed : undefined
}

export interface PageParts {
  readonly process: string
  /** `undefined` for the project checkout. */
  readonly trak: string | undefined
  readonly project: string
}

/**
 * The process, trak and project `label` names, out of the projects in `projects` — or
 * `undefined` when it names none of them, or more than one. A label is taken only in the
 * form `pageLabel` builds, so a project is never reached by its hash where its whole id
 * fits, nor by its whole id where it does not.
 */
export const parsePageLabel = (
  label: string,
  projects: readonly string[],
): PageParts | undefined => {
  const first = label.indexOf(JOIN)
  const second = first === -1 ? -1 : label.indexOf(JOIN, first + JOIN.length)
  if (first < 1 || second <= first + JOIN.length) return undefined
  const process = label.slice(0, first)
  const segment = label.slice(first + JOIN.length, second)
  const trak = segment === CHECKOUT ? undefined : segment
  const matches = projects.filter((project) => pageLabel(process, trak, project) === label)
  const [project] = matches
  return matches.length === 1 && project !== undefined ? { process, trak, project } : undefined
}
