# `models.yaml`

**Path:** `.orkestra/models.yaml`, and `.orkestra/.local/models.yaml` for one person's
additions.

The models an agent may name, grouped by the CLI that runs each one. It is what checks
every agent's `model:` at load, so a misspelt model fails at startup rather than in the
middle of a turn.

## A minimal example

```yaml
default: sonnet
models:
  claude:
    - name: opus
      effort: high
    - name: sonnet
    - name: haiku
```

**Without the file**, the engine allows `opus`, `sonnet` and `haiku` on `claude`, with
`sonnet` as the default and no effort set.

## Keys

| Key | Type | Default | What it does |
|---|---|---|---|
| `default:` | string | **required** | The model the composer runs on, and every agent Orkestra ships that no project file gives a `model:`. Must be a model listed under `models:` |
| `models:` | mapping of CLI to a list of entries | **required** | Every model an agent may name. The key is the CLI that runs the model: `claude` or `codex` |
| `models:` entry `name:` | string | **required** | The model's name as its CLI knows it, without a `/` |
| `models:` entry `effort:` | string | none | The reasoning effort turns on this model run at, unless the agent file sets `effort:`. `claude` accepts `low`, `medium`, `high`, `xhigh` and `max`; `codex` accepts `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` and `persistent` |
| `context_windows:` | mapping of model name to number of tokens | none | How many tokens each model's context holds. The app divides by this to draw how full a step's context is, where the CLI did not report a window itself. Every key must be a listed model |

`ranked:`, an older flat list, fails the load with the shape to write instead. Any other
key is ignored, so check the spelling of the three above.

## How an agent names a model

A model under `claude:` is named bare: `model: opus`. A model under any other CLI is named
`<cli>/<name>`: a `gpt-5.6-sol` entry under `codex:` is `model: codex/gpt-5.6-sol`, and the
same spelling is used under `context_windows:`.

## The local file

`.orkestra/.local/models.yaml` adds to the team's file rather than replacing it, and every
key in it is optional:

- an entry under `models:` is added, or replaces the team's entry of the same name, which
  is how one person changes a model's effort;
- `default:` replaces the team's default;
- `context_windows:` lays over the team's one model at a time.
