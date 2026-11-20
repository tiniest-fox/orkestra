// The cases only real git can answer about sending to the remote — push, and a goal's
// branch and checkout. Split off from `vcs-git-remote.test.ts` so the files run beside
// each other.

import { Layer } from "effect"
import { NodeProcessLayer } from "../../src/agent/adapters/process-node.js"
import { GitCliLayer } from "../../src/vcs/adapters/git-cli.js"
import { testRepo } from "../support/vcs-fixture.js"
import { vcsGitPushContract } from "./vcs.js"

vcsGitPushContract({
  label: "git",
  repository: testRepo,
  layer: (repoDir) => GitCliLayer(repoDir).pipe(Layer.provide(NodeProcessLayer)),
  timeoutMs: 20_000,
})
