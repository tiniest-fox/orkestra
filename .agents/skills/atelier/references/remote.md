# A component the host's own server renders

Read this when the thing being designed has no React form — a Rails ViewComponent, a
server-rendered partial, anything whose HTML only the host application can produce. A
design puts it on screen with `RemoteComponent`; the host renders it, and the knobs tune
it like any other design.

```tsx
import { defineControls, RemoteComponent, type Props } from 'atelier'

export const controls = defineControls({
  size: { type: 'enum', options: { sm: 'sm', md: 'md', lg: 'lg' }, default: 'md' },
  label: { type: 'text', default: 'Save' },
})

export default function Button({ size, label }: Props<typeof controls>) {
  return <RemoteComponent component="Admin::ButtonComponent" props={{ size, label }} />
}
```

**`component` and `props` are exactly what the host receives, and nothing else is.** No
knob reaches the server unless the design passes it, so an enum's options carry the
strings the server expects and a knob left out of `props` is a knob the server never
sees — which `atelier check` reports the way it reports any unread prop. An error the host
answers for a value `check` sets fails the render stage, naming the knob and the value, so
the endpoint answers every value a knob can take. Every change to `props` renders again on
the host; the previous fragment stays on screen until the answer lands.

## What the host has to provide

`.atelier/atelier.config.json` names it:

```json
{
  "remoteComponent": {
    "url": "http://localhost:3000/atelier/render",
    "command": "bin/rails server -p 3000",
    "stylesheets": ["/assets/application.css"]
  }
}
```

- **`url`** — an endpoint that takes `POST` with a JSON body `{ "component": "…",
  "props": { … } }` and answers `text/html`: the component's markup as a fragment, with
  no document around it. `component` is opaque to atelier; the endpoint keys on it however
  it likes. A status outside 2xx is a render failure, and the first line of the body is
  what the failure quotes — so answer an error with a sentence, not a page.
- **`command`** — what starts the server when nothing answers at `url`. Every command that
  renders runs it if it has to, waits for `url` to answer, and stops it on the way out. A
  server already running is reused and left running. Leave it out and a host that is down
  fails at the render stage, naming the URL.
- **`stylesheets`** — paths the host serves, loaded once into every frame that renders a
  remote component. Root-relative paths are read against `url`'s origin; a full URL is
  loaded from where it is. A stylesheet that fails to load is a render failure, not an
  unstyled render.
- **`port`** — for a host whose port differs per checkout: a shell command, run at the
  root of the checkout, that prints the port and nothing else. The answer fills every
  `{port}` in `url` and `stylesheets`, and `command` starts with it in `PORT`, which Rails
  already reads. `port` and a `{port}` in `url` come together; a config with one and not
  the other is refused. Leave both out and `url` is used as written.

**Each checkout asks its own `port` command, so one committed config reaches the right
server in every worktree.**

```json
{
  "remoteComponent": {
    "url": "http://localhost:{port}/atelier/render",
    "port": "bin/port",
    "command": "bin/rails server"
  }
}
```

atelier asks once per checkout for as long as it runs, so a host that moves to another port
needs atelier restarted. The command has to print the same port every time it runs in that
checkout: a port the server picks for itself at boot is not one it can know. Prefer a
script in the repo to a tool found on PATH, because an agent's shell may not have what your
terminal has.

**An environment variable is not enough on its own.** `"port": "echo $RAILS_PORT"` runs,
but every checkout opened from the chrome's spine shares the environment of the `atelier
dev` that opened it, so every one of them gets the same answer. The command has to work the
port out from the checkout it runs in.

**A lookup that fails fails only the designs that render a `RemoteComponent`.** A command
that exits non-zero, prints anything but a port, or runs too long fails those designs at
the render stage, naming the command and quoting what it printed. React-only designs keep
rendering. Nothing falls back to another port, because a worktree's designs rendered by
another checkout's server look right and are wrong. A `command` that crashes is treated
the same way.

The request arrives from atelier's own dev server, not from a browser: it carries the
host's own `Host` header and no session, so **the endpoint has to skip forgery protection
and any authentication** — it is a development route, and should not exist in production.

**A design that declares `scopes` needs the fragment to carry them.** The attribute that
connects a panel section to the thing it controls is `data-atelier="<scope>"`, and
markup the host rendered has to say it the same way React markup does — so the endpoint
puts it on the element, or `atelier check` fails at the manifest stage.

Root-relative URLs in the fragment — a Rails `image_tag`, a `<link>` — are pointed back at
the host, so the endpoint writes them as it would on any page of its own. They are fetched
the way the render is, with no session, so what they name has to be public.

## What travels in an export

**A round or a design that contains a remote component still exports as one file, and it
works offline.** Before it builds, `atelier export` renders each design on the host at the
values the file will open on — the saved values, or the defaults — and carries what the
host answered inside the file, with the stylesheets, fonts and images folded in. A link's
`href` is the one reference left pointing at the host, because a page cannot be carried.

That is also why **`export --tweakable` refuses such a round**, naming the design: the file
holds HTML for the values it was captured at and no others, and a panel would move knobs
there is nothing to move. A React-only round in the same repo still exports tweakable.

The same limit reaches a design with state of its own. If `props` change after the file
opens — a click, a toggle held in `useState` — the file has no HTML for them, and the
design is replaced by an error saying no fragment was captured.

**An export that cannot carry all of it stops, rather than building a file that breaks
later.** A fragment, stylesheet, font or image the host cannot serve stops it, naming the
reference by its address on the host and the design whose fragment named it. So does any
design in the round that is not rendering when it is captured, React-only ones included —
which means the host has to answer, or `command` start it, whenever such a round exports —
and `port`, when there is one, has to find it.

## What it cannot do

- **Host JavaScript does not run.** The fragment is markup; a script in it is inert. A
  component whose behaviour is its point is not a candidate.
- **`useTweak` and `inject` do not reach inside it.** Both act on React elements, and the
  fragment never passes through either.
- **Children and slots are the host's convention.** Whatever the endpoint reads out of
  `props` to fill a slot is between the design and the endpoint.
- **Editing the host's template does not re-render.** atelier gets no signal from the
  host's files; reload the page.
