# Frontend Guidelines

## Component Structure

- One exported component per file, named to match the file (PascalCase).
- Small subcomponents that only serve one parent are fine in their own file alongside it.
- Nest component directories to reflect hierarchy. If `TaskDetail` contains `ArtifactsTab`, `DetailsTab`, etc., those live in `components/TaskDetail/`.
- Import sibling components directly (`import { ArtifactsTab } from "./ArtifactsTab"`), not through barrel exports. Barrel exports (`index.ts`) are only for the `ui/` design system.

## Logic and Hooks

- Keep component files focused on rendering. Extract complex logic (data fetching, form state, derived computations) into hooks.
- Component-specific hooks live alongside the component they serve, in the same directory.
- Shared hooks (used by multiple components) go in `hooks/`.
- Name hooks `useXxx.ts` — the hook name should describe what it provides, not what it wraps.

## State Management

- Use the existing Context + hooks pattern (`TasksProvider`, `WorkflowConfigProvider`). No Redux, Zustand, or other state libraries.
- Access shared state via the provider hooks (`useTasks()`, `useWorkflowConfig()`). Don't prop-drill shared data.
- Local UI state (open/closed, selected tab, form inputs) stays in the component via `useState`.

## Styling

- Tailwind classes only. No CSS modules, styled-components, or inline style objects.
- Use the project's custom design tokens: `stone-*` (neutrals), `orange-*` (accent), semantic colors (`info`, `warning`, `error`, `success`), `panel` border radius and shadows.
- Dark mode is via `darkMode: 'media'` (system preference). Use `dark:` variants where needed.

## UI Components

- Use the existing design system in `components/ui/` — `Panel`, `Button`, `Badge`, `IconButton`, `TabbedPanel`, etc.
- The `Panel` component uses compound subcomponents: `Panel.Header`, `Panel.Body`, `Panel.Footer`, etc.
- Icons come from `lucide-react`. Animations use `framer-motion`.

## Types

- Use `import type` for type-only imports.
- Workflow domain types live in `types/workflow.ts`.
- Don't duplicate backend types — the Tauri bindings generate TypeScript types from Rust.

## Testing

- Tests use Vitest + React Testing Library.
- Test files sit alongside the component: `Component.test.tsx`.
