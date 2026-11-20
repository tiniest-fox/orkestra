// logic: whether a machine trusts what a print assumes, and so which assumptions it accepts.
//
// One switch for the whole machine rather than a list per check: a print skipped on one
// machine and run on another is the point, and an assumption added later is accepted
// without anybody editing anything. CI is where a wrong skip ships, so `CI` decides it.

import { ASSUMPTIONS, type Assumption } from "../types/recording.js"

/** Skeptical wherever `CI` is set to anything, which every CI service does; trusting otherwise. */
export const trustsOn = (env: Readonly<Record<string, string | undefined>>): boolean =>
  (env["CI"] ?? "") === ""

/** Every named assumption on a trusting machine, and none — the floor alone — on a skeptical one. */
export const acceptedOn = (trusts: boolean): readonly Assumption[] => (trusts ? ASSUMPTIONS : [])
