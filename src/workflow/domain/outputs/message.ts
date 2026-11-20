// The agent said something, and that is all it did.
//
// The one output the RUNTIME constructs rather than the agent: on a turn caused
// by a human typing, prose is a complete answer, so `converse` hands the text
// back and this wraps it. An agent never writes this envelope — which is why it
// is absent from `AgentStepOutput`/`AgentComposerOutput` and from the output
// contracts, and why nothing can dodge producing an artifact by emitting it.
//
// It still discriminates on `type`, because it is a member of unions that cross
// the agent boundary and a union needs one discriminator.

import { Schema } from "effect"

export const Message = Schema.Struct({
  type: Schema.tag("message"),
  text: Schema.String,
})
export type Message = Schema.Schema.Type<typeof Message>

export const message = (text: string): Message => Message.make({ text })
