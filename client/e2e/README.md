# `e2e/` — the app as it is served

Boots the real engine and the real Vite dev server, and drives a real browser.

**Nothing here may press a control that spends money.** The engine is the real one,
pointed at this checkout's own `.orkestra/.database/`, so clicking _Start trak_ would run
a composer and bill for it. Opening the drawer, typing into the field and reading the
list are all free; submitting is not.

**What this tier is for is composition.** A page test builds its own router, a hook test
is handed a fake stream, and the transport test never opens a socket — so the provider
tree, the root route, the Vite proxy and a real `EventSource` are reachable only here. It
was written after a `Link` placed outside `RouterProvider` shipped past every unit test
and rendered the app blank in a browser.

```
pnpm --filter @orkestra/client e2e
```

**Two projects, split by file.** `app.spec.ts` runs at the default desktop viewport;
`phone.spec.ts` runs under the `phone` project — 375×667 with a coarse pointer — and is
the standing check on the phone layout. Its cases _measure_: touch targets against the
44px floor, the trak page against the viewport, the safe-area padding as computed style.
happy-dom can see none of that, which is why those claims live here and not in a
`*.phone.test.tsx`.

**What only a host's build draws is not measured here.** The ownership band and a host's
rail come from slots whose public defaults draw nothing, so a case about either fails here;
a host's own build measures them. The helpers a phone spec shares are in `phone.ts`.

It runs on GitHub on every push and pull request, and **not in `verify`**. It was in
`verify` until 2026-10-22: on the machine that runs the traks it shared the cores with
every other trak's suite, and a different page load timed out on most full runs. Run it
by hand when a change is about composition, the proxy or the phone layout —
`playwright install chromium` first if the browser is missing.
