/**
 * Tier 1: what a shell call did, read from its command.
 *
 * Every row is a command shape taken from a stored Claude or Codex log — the paths and
 * strings shortened, the shape kept.
 */

import { describe, expect, it } from "vitest"
import { type ShellVerb, shellVerbs } from "./shellVerb"

/** What one call on its own says: its verbs, with `undefined` for `ran commands`. */
const shellVerb = (command: string): readonly (ShellVerb | undefined)[] | undefined =>
  shellVerbs([command])[0]

/** How Codex wraps every command it runs. */
const codex = (command: string): string => `/bin/zsh -lc '${command.replaceAll("'", `'"'"'`)}'`

const VERBS: readonly (readonly [command: string, verb: ShellVerb])[] = [
  // read
  ["cat .orkestra/.trak/trak.md .orkestra/.trak/1-build.md", "read"],
  ["sed -n '130,230p' app/views/widgets/show.html.erb", "read"],
  ["nl -ba src/app/dto.ts | sed -n 1550,1600p", "read"],
  ["head -40 lib/widgets/table.rb", "read"],
  ["tail -3 /tmp/run.log", "read"],
  ["wc -l docs/guide.md", "read"],
  ["git show abc1234:src/widgets/table.ts", "read"],
  ["cd /home/dev/widgets; cat spec/lib/table_spec.rb", "read"],
  // searched
  ["rg -n 'x' src --glob '!*.min.js'", "searched"],
  ['grep -rn "a\\|b" app --include=*.rb | head -30', "searched"],
  ["git grep -n useWidget src", "searched"],
  ["find . -name '*.test.ts' -not -path './node_modules/*'", "searched"],
  ["fd -e ts widget", "searched"],
  ["sed -n 1,75p a.yaml; ls dir; grep -n reads b.md", "searched"],
  // listed
  ["ls -la .orkestra/.trak/", "listed"],
  ["tree -L 2 client/src/format", "listed"],
  ["find build/screenshots -maxdepth 1", "listed"],
  ["git ls-files -- '*.md' | head -20", "listed"],
  // edited
  ["sed -i '' 's/a/b/' src/widget.ts && grep -n b src/widget.ts", "edited"],
  ["perl -pi -e 's/foo/bar/g' lib/x.rb", "edited"],
  [
    "python3 - <<'EOF'\np='src/server.ts'\ns=open(p).read()\ns=s.replace('a','b')\nopen(p,'w').write(s)\nEOF\ngrep -n b src/server.ts",
    "edited",
  ],
  [
    "node -e \"const fs=require('fs');const s=fs.readFileSync('a.json','utf8');fs.writeFileSync('a.json',s.trim())\"",
    "edited",
  ],
  // wrote
  ["cat > src/boot.ts <<'EOF'\n// a file\nexport {}\nEOF", "wrote"],
  ["cat >> client/src/a.test.tsx <<'EOF'\ndescribe('x', () => {})\nEOF", "wrote"],
  ["touch app/assets/builds/.keep", "wrote"],
  ["cp /tmp/bench.test.ts src/bench/bench.test.ts", "wrote"],
  ["sed 's#a#b#' page.tsx > page.next.tsx", "wrote"],
  ["printf 'x\\n' | tee docs/out.md", "wrote"],
  [
    "python3 - <<'EOF'\nimport json\nopen('fixtures/a.json','w').write(json.dumps({}))\nEOF",
    "wrote",
  ],
  // deleted
  ["rm spec/models/widget_spec.rb", "deleted"],
  ["git rm -q src/app/old.ts", "deleted"],
  ["find dist -name '*.map' -delete", "deleted"],
  ["find . -name '*.orig' -exec rm {} \\;", "deleted"],
  ["git ls-files -z '*.bak' | xargs -0 rm", "deleted"],
  // moved
  ["git mv src/widget.ts src/widgets/widget.ts", "moved"],
  ["mv spec/old/a_spec.rb spec/jobs/a_spec.rb", "moved"],
  // tested
  ["mise exec -- bundle exec rspec spec/models/widget_spec.rb 2>&1 | sed -n 6,35p", "tested"],
  ["cd client && pnpm exec vitest run src/widgets 2>&1 | tail -8", "tested"],
  ["npx vitest run test/e2e/widget.test.ts", "tested"],
  ["pnpm --filter @orkestra/client test 2>&1 | tail -20", "tested"],
  ["npm run test", "tested"],
  ["timeout 900 npx vitest run --project flows test/a.test.ts", "tested"],
  ["for i in 1 2 3; do pnpm test test/e2e/a.test.ts 2>&1 | grep Tests; done", "tested"],
  ["./node_modules/.bin/vitest run test/contract/a.test.ts", "tested"],
  ["bin/rails test test/models", "tested"],
  ["go test ./...", "tested"],
  ["python -m pytest -q tests", "tested"],
  // checked
  ["pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | head -20", "checked"],
  ["pnpm lint 2>&1 | tail -15", "checked"],
  ["(cd client && pnpm check 2>&1 | tail -15)", "checked"],
  ["bundle exec rubocop -A lib/widgets/table.rb", "checked"],
  ["bin/brakeman --no-pager -q -w2", "checked"],
  ["pnpm format:check", "checked"],
  ["npx prettier --check src", "checked"],
  ["cargo clippy --all-targets", "checked"],
  // committed
  ["git add -A && git commit -q -m 'Add the widget'", "committed"],
  // waited
  ["sleep 200", "waited"],
  ["sleep 595; echo waited", "waited"],
  ["until grep -q 'Tests' /tmp/run.log; do sleep 5; done", "waited"],
  ["while ! curl -sf localhost:5173 >/dev/null; do sleep 1; done", "waited"],
  ["git commit -qam 'Fix the widget' && git log --oneline -1", "committed"],
]

/** Each shape the classifier must refuse to name, so the call reads `ran commands`. */
const UNNAMED: readonly (readonly [why: string, command: string])[] = [
  ["a delete of scratch only", "rm -rf /tmp/flake"],
  ["a delete of the macOS temp directory", "rm -rf /var/folders/89/T/widgets"],
  ["a delete of the experiments directory", "rm -rf .experiments/probe"],
  ["a delete through a variable", "D=$(mktemp -d); rm -rf $D"],
  ["a scratch script, then running it", "cat > /tmp/x.rb <<'EOF'\nputs 1\nEOF\nruby /tmp/x.rb"],
  ["a fetch", "git fetch -q origin"],
  ["a stash listing", "git stash list"],
  ["a status, which changes nothing", "git status --short"],
  ["the engine's diff preamble", "branch=$(git rev-parse --abbrev-ref HEAD)\ngit diff --stat"],
  ["a project CLI", "widgetctl render x --width 1100 2>&1 | tail -2"],
  ["a repository's check script", "bash scripts/checks.sh > /tmp/verify.log 2>&1"],
  [
    "an inline script that only prints",
    "python3 -c \"import json; print(json.load(open('a.json')))\"",
  ],
  ["a heredoc script that only prints", "python3 - <<'EOF'\nprint(open('a').read())\nEOF"],
  ["GitHub", "gh pr view 42 --json comments"],
  ["a network call", "curl -s http://127.0.0.1:3000/api/widgets"],
  ["a read beside an unknown command", "cat package.json; some-cli run"],
  ["a script file run by its interpreter", "python3 scripts/seed.py"],
  ["a package script nothing here knows", "pnpm verify"],
  ["an empty command", ""],
]

/** One run's shell calls, as `phraseForRun` hands them over. */
const run = (...commands: readonly string[]): readonly (readonly (ShellVerb | undefined)[])[] =>
  shellVerbs(commands)

describe("shellVerbs, one call at a time", () => {
  it.each(VERBS)("names %j as %s", (command, verb) => {
    expect(shellVerb(command)).toEqual([verb])
  })

  it.each(VERBS)("names %j the same when Codex wraps it", (command, verb) => {
    expect(shellVerb(codex(command))).toEqual([verb])
  })

  it.each(UNNAMED)("names nothing for %s", (_why, command) => {
    expect(shellVerb(command)).toEqual([undefined])
  })

  it("unwraps Codex's quoting, which splices quoted pieces into one argument", () => {
    // Verbatim from a stored Codex call: a double-quoted script holding a single-quoted
    // glob, written as `'"'"'` splices.
    expect(shellVerb(`/bin/zsh -lc "rg -n 'x' app --glob '"'!*.min.js'"'"`)).toEqual(["searched"])
  })

  it("names every distinct effect, in the order the call had them", () => {
    expect(shellVerb("git mv a.ts b.ts && rm c.ts")).toEqual(["moved", "deleted"])
    expect(shellVerb("sed -i '' 's/a/b/' f.ts && pnpm test && pnpm lint")).toEqual([
      "edited",
      "tested",
      "checked",
    ])
    expect(shellVerb("rm old.ts && mv new.ts old.ts")).toEqual(["deleted", "moved"])
  })

  it("names a command it cannot name beside the effects", () => {
    expect(shellVerb("mv a.ts b.ts; some-cli run")).toEqual(["moved", undefined])
  })

  it("lets read-only verbs speak only for a call with no effect, and then only the strongest", () => {
    expect(shellVerb("sed -i '' 's/a/b/' f.ts && grep -n b f.ts")).toEqual(["edited"])
    expect(shellVerb("grep x f | head")).toEqual(["searched"])
    expect(shellVerb("cat a.ts; ls src; grep -n x b.ts")).toEqual(["searched"])
  })

  it("does not call a wait that also read anything a wait", () => {
    expect(shellVerb("sleep 5 && cat f")).toEqual(["read"])
    expect(shellVerb("sleep 5; gh run view 1")).toEqual([undefined])
  })

  it("ignores a filter stage after a pipe unless it writes a file", () => {
    expect(shellVerb("git diff | grep -n x")).toEqual([undefined])
    expect(shellVerb("git diff | tee docs/diff.txt")).toEqual(["wrote"])
  })

  it("reads a heredoc's body as data, not as commands", () => {
    // The body mentions `rm`; the command only writes a file.
    expect(shellVerb("cat > docs/a.md <<'EOF'\nrm -rf everything\nEOF")).toEqual(["wrote"])
  })
})

/**
 * Commands whose verbs must not change when a `cd` comes first: scratch and variable paths
 * are judged as written, not after the current directory is joined onto them.
 */
const CD_PROOF: readonly (readonly [command: string, verbs: readonly (ShellVerb | undefined)[]])[] =
  [
    ['rm -rf "$tmp"', [undefined]],
    ["rm -rf $D", [undefined]],
    ["rm -rf tmp/x", [undefined]],
    ["rm -rf .experiments/probe", [undefined]],
    ['echo hi > "$TMPDIR/out"', [undefined]],
    ['cp a.ts "$saved"', [undefined]],
    ['find "$tmp" -type f -delete', [undefined]],
    ["find /tmp/x -delete", [undefined]],
    ["find tmp -name '*.log' -delete", [undefined]],
    ["find src -name '*.orig' -delete", ["deleted"]],
    ["find . -name '*.orig' -delete", ["deleted"]],
    ["rm -rf src/old", ["deleted"]],
    ["cp a.ts b.ts", ["wrote"]],
  ]

describe("shellVerbs, paths after a cd", () => {
  it.each(CD_PROOF)("names %j the same with and without a leading cd", (command, verbs) => {
    expect(shellVerb(command)).toEqual(verbs)
    expect(shellVerb(`cd /repo && ${command}`)).toEqual(verbs)
    expect(shellVerb(`cd src && ${command}`)).toEqual(verbs)
  })
})

/**
 * Each command entering a directory held in a variable, beside the same work spelled with
 * `$D/` paths and no `cd`. The two must vote alike: after `cd "$D"`, a relative path is the
 * variable it resolves under.
 */
const IN_VARIABLE_DIR: readonly (readonly [entered: string, spelled: string])[] = [
  ["cd $D && rm -rf x", "rm -rf $D/x"],
  ['D=$(mktemp -d) && cd "$D" && rm -rf x', "D=$(mktemp -d) && rm -rf $D/x"],
  ["cd $D && find . -delete", 'find "$D" -delete'],
  ["pushd $D && rm x", "rm $D/x"],
  ["cd $D && cat > f.ts <<X\nx\nX\nrm f.ts", "cat > $D/f.ts <<X\nx\nX\nrm $D/f.ts"],
  ["cd ${D}/sub && touch a.ts", "touch ${D}/sub/a.ts"],
  ["cd $D && cd sub && cp a.ts b.ts", "cp $D/sub/a.ts $D/sub/b.ts"],
  ['cd "$(mktemp -d)" && rm -rf x', "rm -rf $(mktemp -d)/x"],
]

describe("shellVerbs, paths after a cd into a variable directory", () => {
  it.each(IN_VARIABLE_DIR)("names %j as it names %j", (entered, spelled) => {
    expect(shellVerb(entered)).toEqual(shellVerb(spelled))
    expect(shellVerb(entered)).not.toContain("deleted")
    expect(shellVerb(entered)).not.toContain("wrote")
  })

  it("judges an absolute path as written after it", () => {
    expect(shellVerb("cd $D && rm -rf /repo/src/old")).toEqual(["deleted"])
  })

  it("lands back in the work after a cd to a known place", () => {
    expect(shellVerb("cd $D && cd /repo && rm -rf src/old")).toEqual(["deleted"])
  })

  it("follows a variable the call assigned a literal, so a worktree stays the work", () => {
    expect(shellVerb("W=/repo/worktree; cd $W; sed -i '' s/a/b/ src/a.ts")).toEqual(["edited"])
    expect(shellVerb("W=/tmp/probe; cd $W; rm -rf out")).toEqual([undefined])
  })

  it("takes the checkout's root for the work", () => {
    expect(shellVerb('cd "$(git rev-parse --show-toplevel)" && rm -rf src/old')).toEqual([
      "deleted",
    ])
  })

  it("leaves a cd to home unknown, judging paths after it as written", () => {
    expect(shellVerb("cd ~ && rm -rf docs/x")).toEqual(["deleted"])
  })
})

describe("shellVerbs, scratch", () => {
  it("reads a probe spec written, run and removed in one call as the test it was", () => {
    // From a stored call, shortened.
    const probe = [
      "cp .experiments/widget_trace_spec.rb spec/requests/zz_widget_probe_spec.rb",
      "bundle exec rspec spec/requests/zz_widget_probe_spec.rb 2>&1 | tail -25",
      "rm spec/requests/zz_widget_probe_spec.rb",
      "git status --short",
    ].join("; ")
    expect(shellVerb(probe)).toEqual(["tested"])
    expect(
      shellVerb(
        "cat > spec/probe_spec.rb <<'EOF'\nit {}\nEOF\nbundle exec rspec spec/probe_spec.rb | head; rm spec/probe_spec.rb",
      ),
    ).toEqual(["tested"])
  })

  it("does not call removing a directory the call emptied with `git mv` a delete", () => {
    // From a stored Claude call: files moved by a loop, then the empty directory.
    const files = "Header.tsx Mark.tsx widgets.ts useWidgets.ts Overlay.tsx"
    const moving = [
      "cd /home/dev/widgets/src",
      `for f in ${files}; do git mv features/panel/$f widgets/panel/$f; done`,
      "mkdir -p widgets/form",
      "for f in features/form/*; do git mv $f widgets/form/; done",
      "git mv form.tsx widgets/form.tsx",
      "rmdir features/form 2>/dev/null",
      "cd widgets",
      'grep -n "^import" panel/Header.tsx form/* form.tsx | grep "\\.\\./"',
    ].join("; ")
    expect(shellVerb(moving)).toEqual(["moved"])
  })

  it("follows a `cd` into scratch, so a relative write under it is scratch too", () => {
    expect(shellVerb("cd .experiments/probe && cat > dbg.mjs <<'EOF'\nx\nEOF")).toEqual([undefined])
  })

  it("drops a file written in one call and removed two calls later", () => {
    expect(
      run(
        "cat > spec/zz_probe_spec.rb <<'EOF'\nit {}\nEOF",
        "bundle exec rspec spec/zz_probe_spec.rb",
        "rm spec/zz_probe_spec.rb",
      ),
    ).toEqual([[undefined], ["tested"], [undefined]])
  })

  it("reads a run that only makes and removes scratch as commands", () => {
    expect(run("touch docs/x.md", "ls docs", "rm docs/x.md")).toEqual([
      [undefined],
      ["listed"],
      [undefined],
    ])
    expect(run("mkdir -p probe && cat > probe/a.rb <<'EOF'\nx\nEOF", "rm -rf probe")).toEqual([
      [undefined],
      [undefined],
    ])
  })

  it("still names the delete of a file the run did not make", () => {
    expect(run("cat > a.ts <<'EOF'\nx\nEOF", "rm a.ts b.ts")).toEqual([[undefined], ["deleted"]])
  })

  it("leaves both standing where a path cannot be matched, so no verb gets stronger", () => {
    // A variable: the delete names nothing it can be matched against, and votes nothing
    // either, as it never did.
    expect(run("cat > spec/x_spec.rb <<'EOF'\nx\nEOF", "rm -f $T/x")).toEqual([
      ["wrote"],
      [undefined],
    ])
    // A glob: both stand.
    expect(shellVerb("cat > docs/a.tmp <<'EOF'\nx\nEOF\nrm docs/*.tmp")).toEqual([
      "wrote",
      "deleted",
    ])
    // A path spelled from two places that do not line up.
    expect(run("cd client && touch src/x.ts", "rm src/x.ts")).toEqual([["wrote"], ["deleted"]])
  })
})

describe("shellVerbs, undone edits", () => {
  it("drops an edit the run restores from its own backup", () => {
    expect(
      run(
        "cp src/widget.ts /tmp/widget.ts.bak && sed -i '' 's/a/b/' src/widget.ts",
        "pnpm vitest run src/widget.test.ts | tail",
        "cp /tmp/widget.ts.bak src/widget.ts",
      ),
    ).toEqual([[undefined], ["tested"], [undefined]])
  })

  it("drops an edit a later call checks out again", () => {
    expect(run("sed -i '' 's/a/b/' src/a.ts", "pnpm test", "git checkout -- src/a.ts")).toEqual([
      [undefined],
      ["tested"],
      [undefined],
    ])
    expect(
      run(
        "python3 - <<'EOF'\np='src/a.ts'\ns=open(p).read()\nopen(p,'w').write(s.replace('a','b'))\nEOF",
        "git restore src/a.ts",
      ),
    ).toEqual([[undefined], [undefined]])
  })

  it("keeps an edit to a path the run never restores", () => {
    expect(run("sed -i '' 's/a/b/' src/a.ts", "git checkout -- src/b.ts")).toEqual([
      ["edited"],
      [undefined],
    ])
  })
})
