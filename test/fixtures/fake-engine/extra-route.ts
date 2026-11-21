// The fake engine with one route of a host's own, launched as `test/package-exports.test.ts`
// launches it: what a host's tests run in place of `test/support/fake-engine.ts`.

import { serveFakeEngine } from "@orkestra/engine/test/support/fake-engine"

serveFakeEngine({
  "/api/extra": (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ extra: true }))
  },
})
