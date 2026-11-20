// ports: one service, one error. How a consumer reaches the loaded templates.

import { Context, Data } from "effect"
import type { Templates } from "../types/template.js"

export class Prompts extends Context.Tag("prompts/Prompts")<Prompts, Templates>() {}

export class TemplateMissing extends Data.TaggedError("TemplateMissing")<{
  readonly name: string
  readonly reason: string
}> {
  /** That `name: reason` line, as the `Error` message — `BuiltinPromptsLayer` can fail a
   * boot with this, and `serve.ts` reports one by rendering the `Cause`. */
  override get message(): string {
    return `${this.name}: ${this.reason}`
  }
}
