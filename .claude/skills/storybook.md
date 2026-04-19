---
name: storybook
description: Storybook story requirements, provider setup, screenshot workflow, and file conventions for UI components
---

# Storybook Stories

## Story Requirements

Every new UI component and every existing component with changed props, new visual states, or modified appearance must have a Storybook story. This is a hard requirement, not a nice-to-have.

- **New components** in `src/components/` --- at minimum one story showing the default/happy path
- **Conditional rendering branches** (loading, error, empty, disabled) --- each meaningful state gets its own named story
- **Changed components** --- update existing stories to cover new behavior; add stories for states that did not exist before

## File Conventions

Stories live in `src/stories/`. The shared infrastructure is in `src/stories/storybook-helpers.tsx`.

Name story files `ComponentName.stories.tsx` and place them in a subdirectory matching the component domain (e.g., `src/stories/TaskDetail/MyComponent.stories.tsx`).

## Provider Setup

Every story needs the full provider stack. Use `storybookDecorator` (registered globally in `.storybook/preview.ts`) --- it wraps all stories automatically:

```tsx
import { storybookDecorator } from "../stories/storybook-helpers";
export default { decorators: [storybookDecorator] };
```

**`useWorkflowConfig` vs `useWorkflowConfigState`**: Use `useWorkflowConfigState()` in Storybook --- `useWorkflowConfig()` throws when config is null, which happens before async startup resolves. `StorybookProviders` includes a `ConfigGate` that handles this, but consumers should use the safe variant.

**Custom transport stories**: When a story group needs different stage names, data, or RPC behaviour than the global mock, every story file in that group must explicitly wrap with `StorybookProviders` passing a custom transport --- do not rely on the global decorator:

```tsx
const decorator = (Story: React.ComponentType) => (
  <StorybookProviders transport={createDemoTransport()}>
    <Story />
  </StorybookProviders>
);
export default { decorators: [decorator] };
```

`createMockTransport` returns a `Transport` with `supportsLocalOperations: false` and a routing table for every RPC method. The `default` branch returns a never-resolving promise to pause unhandled polling. When adding a new RPC method to the mock, verify the return shape against the `transport.call<T>()` call at the usage site.

See `src/stories/Demo/AppShell.stories.tsx` for the custom transport reference pattern.

## Screenshot-as-Resource Workflow

After writing stories, generate screenshots and register them as resources so they appear in the Trak drawer throughout the workflow.

> **Headless agents:** You cannot run `pnpm storybook` or take screenshots in a headless environment. At minimum, run `pnpm build-storybook` to catch import and bundling errors. Visual verification and screenshots are only possible in interactive/human runs — skip steps 1–3 below and note this limitation in your work summary.

1. Run Storybook: `pnpm storybook` (serves at `http://localhost:6006`)
2. Navigate to the component story and verify every story variant renders correctly
3. Take screenshots --- either via `pnpm test-storybook` with a snapshot configuration, or manually from the browser
4. Save screenshots to `.orkestra/screenshots/ComponentName.png`
5. Register each screenshot as a resource in your structured output:

```json
{"name": "screenshot:ResourceItem", "url": "/absolute/path/to/.orkestra/screenshots/ResourceItem.png", "description": "ResourceItem --- image and link variants"}
{"name": "screenshot:FeedRow", "url": "/absolute/path/to/.orkestra/screenshots/FeedRow.png", "description": "FeedRow --- default and selected states"}
```

Use `screenshot:ComponentName` as the resource key so multiple screenshots coexist without collision. In Tauri, local image paths render as inline `<img>` tags in the Trak drawer Resources tab.

## Build Limitation

`pnpm build-storybook` only bundles JavaScript --- it does not render stories. Runtime errors (missing providers, undefined hooks, broken context) are invisible to the build step and to `checks.sh`. The only way to catch these is running Storybook locally (`pnpm storybook` at `http://localhost:6006`) and reviewing each story variant manually.

## Reference Files

| File | Role |
|------|------|
| `src/stories/storybook-helpers.tsx` | `StorybookProviders`, `storybookDecorator`, `createMockTransport` |
| `.storybook/preview.ts` | Global decorator registration |
| `src/stories/Demo/AppShell.stories.tsx` | Custom transport pattern reference |
| `src/CLAUDE.md` — Storybook Stories section | Authoritative source for edge cases and full detail |
