// The pure half of the opener scan: what a plist declares, where an executable's
// bundle is, one `ps` line, and the guess's rules per kind. The plist fixtures are the
// declarations actually read off this machine's applications — including Slack, the
// false positive that is the whole reason the terminal claim checks the content type
// beside the role, and QuickTime Player, which declares `Editor` over `public.folder` to
// play a folder of stills as an image sequence. Slack is the sweep's own false positive
// and QuickTime is not — it sits in `/System/Applications`, which the sweep does not
// read — so this fixture pins the *shape* the media check drops rather than an app the
// scan has ever had to reject.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  bundleOf,
  guessFrom,
  psLine,
  openerFromPlist,
  openersOn,
  preferenceDirOn,
  type OpenerApp,
} from "./openers.js"

const ghostty = {
  CFBundleIdentifier: "com.mitchellh.ghostty",
  CFBundleName: "Ghostty",
  CFBundleIconFile: "AppIcon.icns",
  CFBundleDocumentTypes: [
    {
      CFBundleTypeName: "Terminal scripts",
      CFBundleTypeExtensions: ["command", "tool", "sh", "zsh", "csh", "pl"],
      CFBundleTypeRole: "Editor",
      CFBundleTypeIconFile: "AppIcon.icns",
    },
    { CFBundleTypeName: "Folders", CFBundleTypeRole: "Editor", LSHandlerRank: "Alternate" },
    { CFBundleTypeRole: "Shell", LSItemContentTypes: ["public.unix-executable"] },
  ],
}

const slack = {
  CFBundleIdentifier: "com.tinyspeck.slackmacgap",
  CFBundleName: "Slack",
  CFBundleDocumentTypes: [
    {
      CFBundleTypeName: "Slack token",
      CFBundleTypeExtensions: ["slacktoken"],
      CFBundleTypeRole: "Shell",
      LSHandlerRank: "Owner",
    },
  ],
}

const zed = {
  CFBundleIdentifier: "dev.zed.Zed",
  CFBundleName: "Zed",
  CFBundleDisplayName: "Zed",
  CFBundleIconFile: "Zed.icns",
  CFBundleDocumentTypes: [
    {
      CFBundleTypeIconFile: "Document",
      CFBundleTypeRole: "Editor",
      LSItemContentTypes: [
        "public.folder",
        "public.plain-text",
        "public.text",
        "public.utf8-plain-text",
      ],
      LSHandlerRank: "Alternate",
    },
    {
      CFBundleTypeName: "Zed Text Document",
      CFBundleTypeRole: "Editor",
      CFBundleTypeOSTypes: ["****"],
      LSHandlerRank: "Default",
      CFBundleTypeExtensions: ["c", "css", "go", "js", "json", "md", "py", "rs", "ts", "tsx"],
      CFBundleTypeIconFile: "Document",
    },
  ],
}

const quicktime = {
  CFBundleIdentifier: "com.apple.QuickTimePlayerX",
  CFBundleName: "QuickTime Player",
  CFBundleDisplayName: "QuickTime Player",
  CFBundleIconFile: "AppIcon",
  CFBundleDocumentTypes: [
    {
      CFBundleTypeRole: "Editor",
      LSItemContentTypes: ["com.apple.quicktimeplayerx-composition"],
      NSDocumentClass: "MGPlaybackDocument",
      LSHandlerRank: "Owner",
    },
    {
      CFBundleTypeRole: "Viewer",
      LSItemContentTypes: ["public.movie"],
      NSDocumentClass: "MGPlaybackDocument",
      LSHandlerRank: "Default",
    },
    {
      CFBundleTypeRole: "Editor",
      NSDocumentClass: "MGOpenImageSequenceDocument",
      LSItemContentTypes: [
        "public.camera-raw-image",
        "public.jpeg",
        "public.png",
        "public.tiff",
        "public.heif",
        "public.folder",
      ],
    },
  ],
}

describe("openerFromPlist", () => {
  it("keeps a bundle declaring the shell role on unix executables, as a terminal", () => {
    expect(openerFromPlist("/Applications/Ghostty.app", ghostty)).toStrictEqual({
      id: "com.mitchellh.ghostty",
      name: "Ghostty",
      path: "/Applications/Ghostty.app",
      iconFile: "AppIcon.icns",
      kinds: ["terminal"],
    })
  })

  it("keeps a bundle declaring the editor role on folders, as an editor", () => {
    expect(openerFromPlist("/Applications/Zed.app", zed)).toStrictEqual({
      id: "dev.zed.Zed",
      name: "Zed",
      path: "/Applications/Zed.app",
      iconFile: "Zed.icns",
      kinds: ["editor"],
    })
  })

  it("drops the shell role on any other content type — Slack's token files", () => {
    expect(openerFromPlist("/Applications/Slack.app", slack)).toBeUndefined()
  })

  it("drops a folder claim shared with image types — QuickTime's image sequences", () => {
    expect(openerFromPlist("/System/Applications/QuickTime Player.app", quicktime)).toBeUndefined()
  })

  it("drops an app with neither claim, and one with no identifier", () => {
    const viewer = {
      CFBundleIdentifier: "com.example.viewer",
      CFBundleDocumentTypes: [
        { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["public.folder"] },
        { CFBundleTypeRole: "Editor", LSItemContentTypes: ["public.shell-script"] },
      ],
    }
    const anonymous = {
      CFBundleDocumentTypes: [
        { CFBundleTypeRole: "Shell", LSItemContentTypes: ["public.unix-executable"] },
      ],
    }
    expect(openerFromPlist("/Applications/Viewer.app", viewer)).toBeUndefined()
    expect(openerFromPlist("/Applications/Anon.app", anonymous)).toBeUndefined()
  })

  it("keeps a bundle claiming both, under both kinds", () => {
    const both = {
      CFBundleIdentifier: "com.example.both",
      CFBundleDocumentTypes: [
        { CFBundleTypeRole: "Shell", LSItemContentTypes: ["public.unix-executable"] },
        { CFBundleTypeRole: "Editor", LSItemContentTypes: ["public.folder"] },
      ],
    }
    expect(openerFromPlist("/Applications/Both.app", both)?.kinds).toStrictEqual([
      "terminal",
      "editor",
    ])
  })

  it("skips a document this shape cannot read, rather than failing the scan", () => {
    expect(openerFromPlist("/Applications/Odd.app", "not a plist")).toBeUndefined()
    expect(openerFromPlist("/Applications/Odd.app", { CFBundleDocumentTypes: 3 })).toBeUndefined()
  })

  it("falls back to the bundle's filename when no name is declared", () => {
    const bare = {
      CFBundleIdentifier: "com.example.term",
      CFBundleDocumentTypes: [
        { CFBundleTypeRole: "Shell", LSItemContentTypes: ["public.unix-executable"] },
      ],
    }
    expect(openerFromPlist("/Applications/My Term.app", bare)?.name).toBe("My Term")
  })
})

describe("bundleOf", () => {
  it("names the bundle an executable runs inside", () => {
    expect(bundleOf("/Applications/Ghostty.app/Contents/MacOS/ghostty")).toBe(
      "/Applications/Ghostty.app",
    )
  })

  it("has no answer for a bare executable", () => {
    expect(bundleOf("/bin/zsh")).toBeUndefined()
    expect(bundleOf("/usr/bin/login")).toBeUndefined()
  })
})

describe("psLine", () => {
  it("reads the parent pid and the executable off one line", () => {
    expect(psLine("  2126 /usr/bin/login\n")).toStrictEqual({
      ppid: 2126,
      command: "/usr/bin/login",
    })
  })

  it("has no answer for output that is not a process line", () => {
    expect(psLine("")).toBeUndefined()
    expect(psLine("ps: no such process")).toBeUndefined()
  })
})

const app = (id: string, path: string, kinds: readonly ("terminal" | "editor")[]): OpenerApp => ({
  id,
  name: id,
  path,
  iconFile: undefined,
  kinds,
})

const apple = app("com.apple.Terminal", "/System/Applications/Utilities/Terminal.app", ["terminal"])
const ghosttyApp = app("com.mitchellh.ghostty", "/Applications/Ghostty.app", ["terminal"])
const xcode = app("com.apple.dt.Xcode", "/Applications/Xcode.app", ["editor"])
const zedApp = app("dev.zed.Zed", "/Applications/Zed.app", ["editor"])

describe("guessFrom", () => {
  it("prefers the opener the engine was started from", () => {
    expect(guessFrom("terminal", [apple, ghosttyApp], "/Applications/Ghostty.app")).toBe(ghosttyApp)
    expect(guessFrom("editor", [xcode, zedApp], "/Applications/Zed.app")).toBe(zedApp)
  })

  it("falls through a bundle that is not an opener — the engine's own app", () => {
    expect(guessFrom("terminal", [apple, ghosttyApp], "/Applications/Orkestra.app")).toBe(
      ghosttyApp,
    )
  })

  it("prefers anything over Apple's Terminal when nothing started the engine", () => {
    expect(guessFrom("terminal", [apple, ghosttyApp], undefined)).toBe(ghosttyApp)
  })

  it("takes the first editor by name, with nothing demoted — Xcode is a legitimate pick", () => {
    expect(guessFrom("editor", [xcode, zedApp], undefined)).toBe(xcode)
  })

  it("answers Apple's Terminal when it is the only one, and nothing on an empty scan", () => {
    expect(guessFrom("terminal", [apple], undefined)).toBe(apple)
    expect(guessFrom("terminal", [], undefined)).toBeUndefined()
    expect(guessFrom("editor", [], undefined)).toBeUndefined()
  })
})

describe("where the once-per-machine picks are kept", () => {
  it("is the desktop shell's directory on macOS, whatever XDG says", () => {
    expect(preferenceDirOn("darwin", { XDG_CONFIG_HOME: "/xdg" }, "/Users/p")).toBe(
      "/Users/p/Library/Application Support/Orkestra",
    )
  })

  it("is under XDG_CONFIG_HOME on Linux, and ~/.config where it is unset, empty or relative", () => {
    expect(preferenceDirOn("linux", { XDG_CONFIG_HOME: "/xdg" }, "/home/p")).toBe("/xdg/orkestra")
    expect(preferenceDirOn("linux", {}, "/home/p")).toBe("/home/p/.config/orkestra")
    expect(preferenceDirOn("linux", { XDG_CONFIG_HOME: "" }, "/home/p")).toBe(
      "/home/p/.config/orkestra",
    )
    expect(preferenceDirOn("linux", { XDG_CONFIG_HOME: "xdg" }, "/home/p")).toBe(
      "/home/p/.config/orkestra",
    )
  })
})

describe("the openers off macOS", () => {
  it("lists nothing and refuses a pick and a press as unsupported, running nothing", async () => {
    const linux = openersOn("linux")
    // A directory that does not exist: the refusal comes before any look at the disk.
    const answers = await Effect.runPromise(
      Effect.all([
        linux.list,
        linux.choose("terminal", "com.mitchellh.ghostty"),
        linux.openAt("terminal", "/no/such/checkout"),
        linux.openAt("editor", "/no/such/checkout"),
      ]),
    )
    expect(answers).toStrictEqual([undefined, "unsupported", "unsupported", "unsupported"])
  })
})
