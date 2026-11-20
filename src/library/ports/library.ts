// ports: how a consumer reaches the loaded library.
//
// The tag lives here, not in workflow/runtime.ts where it started, because an
// adapter can only provide a tag it is allowed to import — and library/ must not
// import workflow/. Moving it is what lets a Layer read `.orkestra` from disk.

import { Context } from "effect"
import type { Library } from "../types/library.js"

/** `Lib`, not `Library`: the tag and the interface it carries need distinct names. */
export class Lib extends Context.Tag("library/Library")<Lib, Library>() {}
