// The cases only real git can answer — a third of `vcs-git.test.ts` once, split off so
// the files run beside each other. The remote's cases are in
// `vcs-git-remote.test.ts` and `vcs-git-push.test.ts`.

import { Layer } from "effect"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { GitCliLayer } from "../../src/vcs/adapters/git-cli.js"
import { testRepo } from "../support/vcs-fixture.js"
import { vcsGitContract } from "./vcs.js"

vcsGitContract({
  label: "git",
  repository: testRepo,
  layer: (repoDir) => GitCliLayer(repoDir).pipe(Layer.provide(NodeProcessLayer)),
  timeoutMs: 20_000,
})
