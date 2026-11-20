// The public surface of prompts/: the templates, and how to fill them.
//
// Deliberately free of Effect: workflow/domain imports this, and domain must not
// reach Context or Layer. The `Prompts` Tag lives in ports/, the Layer in
// adapters/, and consumers import those directly — the same way workflow imports
// `Store` from ports/store.ts and `MemoryStoreLayer` from adapters/.

export { render, renderText } from "./logic/render.js"
export { TEMPLATE_NAMES } from "./types/template.js"
export type { TemplateName, Templates } from "./types/template.js"
