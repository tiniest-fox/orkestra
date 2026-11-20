/**
 * The chord that opens the ⌘K palette on this platform, and how a hint spells it — one
 * answer for the listener and every hint, so what a press says is the key that works.
 *
 * Apple platforms take ⌘, everything else Ctrl: ⌘ is no key on a Linux or Windows
 * keyboard, and many of their fonts draw it as a box. Read off `navigator.platform`'s
 * string, which the caller hands in so this stays pure; an empty one is Ctrl.
 */

export interface PaletteChord {
  /** Whether the chord is ⌘ rather than Ctrl. */
  readonly meta: boolean
  readonly hint: string
}

export const paletteChordOn = (platform: string): PaletteChord =>
  /mac|iphone|ipad|ipod/i.test(platform)
    ? { meta: true, hint: "⌘K" }
    : { meta: false, hint: "Ctrl K" }
