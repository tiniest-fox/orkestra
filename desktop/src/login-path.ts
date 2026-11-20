// The `PATH` a terminal would have, read from the login shell inside a project.
//
// An app launched from Finder inherits `/usr/bin:/bin:/usr/sbin:/sbin`. `claude`, `git`
// and `gh` are in none of them, so every turn, every worktree operation and every forge
// read would fail on a machine where all three work in a terminal — and the failure is
// a spawn `ENOENT`, which reads as the tool being absent rather than as the app not
// being able to see it. So the shell's `PATH` is resolved here and handed to each engine
// the app starts; the engine then inherits it into everything *it* spawns.
//
// **In the project's own directory, and therefore once per project rather than once per
// launch.** A per-repository version manager — mise, asdf, a `.nvmrc` hook — puts the
// toolchain on `PATH` only while the shell is inside the repository that declares it, so
// a shell run anywhere else answers without the `node` and `pnpm` that repository's
// checks and `worktrees/setup.sh` call. Two projects on one machine legitimately get
// different answers.
//
// Interactive and login (`-ilc`), because that is what a terminal tab runs: Homebrew,
// nvm and the like are set up in `.zshrc` as often as in `.zprofile`, and a login-only
// shell misses the first kind — and a version manager's hook is in the interactive half
// too. The value is fenced, since an rc file may print.

import { execFile } from "node:child_process"

const FENCE = "__ORKESTRA_PATH__"

/** Bounded: an rc file that waits on input would otherwise hold the app at launch. */
const TIMEOUT_MS = 5000

/**
 * The login shell's `PATH` in `cwd`, or `undefined` when the shell did not answer — which
 * includes `cwd` not existing, since that is a shell that cannot start. A caller falls
 * back to its own `PATH` and says so; nothing here guesses at directories.
 */
export const loginShellPath = (
  cwd: string,
  shell: string = process.env["SHELL"] ?? "/bin/zsh",
): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '%s' '${FENCE}'"$PATH"'${FENCE}'`],
      { cwd, timeout: TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          resolve(undefined)
          return
        }
        const start = stdout.indexOf(FENCE)
        const end = stdout.lastIndexOf(FENCE)
        if (start === -1 || end <= start) {
          resolve(undefined)
          return
        }
        const path = stdout.slice(start + FENCE.length, end)
        resolve(path === "" ? undefined : path)
      },
    )
  })
