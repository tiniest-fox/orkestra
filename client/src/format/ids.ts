/**
 * Session ids (`SessionId`) and git SHAs (`CommitSha`) — long enough that a row of
 * them is unreadable, and neither is meant to be typed. A prefix is what a person
 * actually uses one for: telling two apart in the activity feed.
 *
 * Eight characters because that is git's own default abbreviation and the first block
 * of a UUID, so a shortened id here is the same string the terminal shows.
 *
 * **Not for a trak id, which is shown whole.** A trak is named with three words a
 * person says out loud and types into `ork resume`, so half of one is not a shorter
 * version of it — it is a different string that matches nothing. The traks named with
 * a UUID before that change are shown whole too, for the plainer reason that one
 * helper cannot tell the two apart and nothing should have to.
 *
 * **Display only.** Every request takes the full id — `api/` puts it in the
 * path — so nothing may round-trip through this. It does not fail on a short input; it
 * simply returns what it was given, because a truncation helper that throws is worse
 * than one that under-shortens.
 */
export const shortId = (id: string): string => id.slice(0, 8)
