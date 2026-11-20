// logic: a model name as `models.yaml` lists it, split into the CLI it names and
// the name that CLI is handed.

/**
 * `codex/gpt-5.6-sol` names a provider and a model; `opus` names a model alone, and
 * `provider` is then absent — which the registry reads as its first adapter, the one
 * every name meant before names could be qualified.
 *
 * Split at the first slash only: what follows is the provider's own vocabulary, and a
 * slash in there is not this file's to interpret.
 */
export interface QualifiedModel {
  readonly provider: string | undefined
  readonly model: string
}

export const splitModel = (name: string): QualifiedModel => {
  const at = name.indexOf("/")
  return at < 0
    ? { provider: undefined, model: name }
    : { provider: name.slice(0, at), model: name.slice(at + 1) }
}
