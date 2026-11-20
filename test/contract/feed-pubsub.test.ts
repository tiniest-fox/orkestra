// The in-memory feed the daemon runs on. One implementation today, and the suite is
// written against the port because the second one is a durable feed — the thing that
// lets a watcher resume from further back than a process's own memory.

import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { feedContract } from "./feed.js"

feedContract({ label: "pubsub", layer: PubSubFeedLayer, buffer: 256 })
