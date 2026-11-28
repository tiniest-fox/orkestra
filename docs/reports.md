# Problem reports

A person on a trak's page can send a report of what went wrong: the trak's details, an
optional note, and a cleaned tail of the trak's log. This page is the contract a receiver
maps from.

## Who sends it

**The host that started the engine sends it, and only where the host has a destination.**
The engine builds the report and hands it to the host; where the destination is kept, and
how the send is signed, are the host's. An engine no host started has no destination, and
its trak pages offer no report.

The host may name its destination. The person sees *Sent to \<name\>* on the form and on
the receipt.

**Orkestra sends the report in its own terms.** It shapes nothing for any receiver, so a
receiver maps these fields onto its own.

## The report

One JSON object. `format` names the version, and a change a receiver could misread is a
new `format`, never an edit to this one.

```json
{
  "format": "orkestra-report/1",
  "madeAt": "2026-11-28T12:00:00.000Z",
  "note": "It retried four times and then stopped.",
  "trak": {
    "id": "careful-emerald-catshark",
    "title": "Let a person report a problem",
    "description": "As a person on a trak's page, I want to report …",
    "goal": "reporting-0f3a",
    "state": "Failed",
    "position": "5-review",
    "agent": "review"
  },
  "engine": { "version": "0.41.2", "platform": "darwin" },
  "log": {
    "_tag": "Included",
    "lines": ["{\"_tag\":\"TrakCreated\",\"at\":1764331200000, …}", "…"],
    "kept": { "lines": 2000, "bytes": 204811 },
    "leftOut": { "lines": 14212, "bytes": 1530120 },
    "redactions": 3
  }
}
```

| Field | Means |
|---|---|
| `format` | always `orkestra-report/1` for this shape |
| `madeAt` | when the engine built the report, ISO 8601 |
| `note` | what the person wrote, cleaned and cut — below; absent where they wrote nothing |
| `withheld` | `secrets-unreadable` where the engine could not read its list of secrets; absent otherwise. The note is then absent, `trak.title` is the trak's id and `trak.description` is empty |
| `cut` | the bytes the cut took off the end of `note`, `title` or `description`, naming only the fields it cut; absent where it cut none |
| `trak.id`, `trak.title`, `trak.description` | the trak, its plan's title or the request where it has no plan, and the request — the last two cleaned and cut — below |
| `trak.goal` | the goal that opened the trak; absent where none did |
| `trak.state` | the state's name — `AgentWorking`, `AwaitingHuman`, `Failed`, `Finished` and the rest; `Unreadable` where the stored log will not decode |
| `trak.position`, `trak.agent` | the step the state names, as `<index>-<agent>`, and its agent; absent where the state names no step |
| `engine.version`, `engine.platform` | the engine's version, and Node's `process.platform` |
| `log` | the log, or why it is absent — below |

## The log

**The log is the trak's events and the engine's warning and error lines that name the
trak, merged oldest first by time.** Agent transcripts are not included. Each line is one
JSON object: an event as the engine stores it, whose `at` is milliseconds since the epoch,
or `{ "at", "level", "message" }` for an engine line, whose `at` is ISO 8601.

`log._tag` is one of two:

| `_tag` | Carries |
|---|---|
| `Included` | `lines`; `kept` and `leftOut`, each `{ lines, bytes }`, a line counted with its newline; and `redactions`, how many marks the cleaning wrote |
| `LeftOut` | `reason`: `turned-off` where the person chose to send no log, `secrets-unreadable` where the engine could not read its list of secrets, `undecodable` where the trak's stored log will not decode |

**Every line is cleaned before it is cut.** The cleaning replaces each secret value the
engine holds, and each string shaped like a well-known credential — a GitHub token, an
Anthropic or OpenAI key, an AWS access key id or secret key, a `Bearer` token, a PEM
private key — with `[redacted]`. Where the engine cannot read its list of secrets, it sends
no log rather than a log cleaned of shapes alone.

## The typed text

**The note, the title and the description are cleaned as a log line is, whether or not the
log goes**, because each is text a person typed and may hold a credential. Each is then cut
from its start to 64 KB, never splitting a character, and `cut` says how many bytes each
lost. Where the engine cannot read its list of secrets, all three are withheld rather than
cleaned of shapes alone, and `withheld` says so.

## How long a log may be

**A long log is cut to its newest lines within 2,000 lines and 256 KB**, whichever is
reached first, and `leftOut` says how many older lines and bytes were left out.

## What the host answers

The host answers each send with one of two:

| Answer | The person sees |
|---|---|
| a `reference` — any string | *Report sent*, and the reference: a link where it is an `http` or `https` URL, text otherwise |
| a `reason` — a sentence | *The report did not go through*, the reason, and their note kept for *Try again* |

Nothing on the trak records a sent report. The receipt is the one place its reference
appears.
