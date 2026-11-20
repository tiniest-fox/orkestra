// logic: whether the git on this machine can answer the questions the port asks.
//
// A dependency on the *machine* rather than on the manifest, which is why it is
// checked at startup and stated here: `package.json` can express a node version
// and nothing else, so the alternative is discovering it as a merge preview that
// never says *conflict*.

/** `merge-tree --write-tree` is 2.38, and it is what predicts a merge. */
const LEAST = { major: 2, minor: 38 } as const

/** What the refusal names, so the sentence and the comparison cannot disagree. */
export const MIN_GIT = `${String(LEAST.major)}.${String(LEAST.minor)}`

/**
 * Is the git that printed this line too old?
 *
 * `git --version` answers `git version 2.39.5 (Apple Git-154)` — the vendor
 * suffix is why this takes the first two numbers rather than reading the whole
 * line, and the patch level is deliberately not compared: nothing here turns on
 * one.
 *
 * **A line this cannot read answers `true`.** Not knowing is not the same as
 * being new enough, and the two mistakes are not symmetric: refusing to start on
 * a git whose output changed shape is a sentence a person can act on, where
 * starting anyway hands them a prediction that quietly never fires.
 */
export const gitTooOld = (versionLine: string): boolean => {
  const found = /(\d+)\.(\d+)/.exec(versionLine)
  const major = Number(found?.[1])
  const minor = Number(found?.[2])
  if (Number.isNaN(major) || Number.isNaN(minor)) return true
  return major < LEAST.major || (major === LEAST.major && minor < LEAST.minor)
}
