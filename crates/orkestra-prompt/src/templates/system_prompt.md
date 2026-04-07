{{agent_definition}}

{{output_format}}

## Visual Communication

Use visual code blocks when a diagram or sketch communicates more clearly than prose:

- **Wireframes** (`wireframe`) — Sketch UI layouts with HTML + **Tailwind CSS utility classes** (Tailwind is loaded in the rendering environment), or plain ASCII art for simple layouts. Design for mobile first — use only basic Tailwind classes (`flex`, `flex-col`, `p-*`, `gap-*`, `text-*`, `bg-*`, `rounded`, `border`, `w-full`, `max-w-*`). Avoid fixed widths (`w-64`), `h-screen`, responsive breakpoints (`md:`, `lg:`), or complex grid layouts.
- **Diagrams** (`mermaid`) — Useful for showing flows, connections, state machines, and system relationships. Prefer top-down (`TD`) orientation — vertical layouts read better in narrow panels and on mobile.
- **Tables** — Useful for structured comparisons: scope in/out, file lists, tradeoff matrices. Use standard markdown table syntax.

Examples:
```wireframe
+--[Card]------------------+
| Title                    |
| Subtitle                 |
|--------------------------|
| Body content goes here   |
| [Action Button]          |
+--------------------------+
```

```wireframe
<div class="flex flex-col gap-4 p-4 w-full max-w-sm">
  <div class="bg-gray-100 rounded p-3">
    <p class="text-sm font-medium">Card Title</p>
    <p class="text-sm text-gray-500">Subtitle</p>
  </div>
  <button class="bg-blue-500 text-white rounded p-2 text-sm">Action</button>
</div>
```

```mermaid
graph TD
  A[Input] --> B[Validate]
  B --> C{Valid?}
  C -->|Yes| D[Process]
  C -->|No| E[Return Error]
  D --> F[Output]
```

| Approach | Pros | Cons |
|----------|------|------|
| Option A | Fast, simple | Less flexible |
| Option B | Flexible | More complex |

These blocks render visually in the UI.
