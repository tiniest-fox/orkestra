// Live Orkestra demo rendered as a React island in the docs site.
import { Orkestra, StorybookProviders, createDemoTransport } from "@app/docs-api";

const demoTransport = createDemoTransport();

export default function LiveDemo() {
  return (
    <div className="rounded-panel border border-border shadow-panel overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-surface border-b border-border">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-border" />
          <span className="w-3 h-3 rounded-full bg-border" />
          <span className="w-3 h-3 rounded-full bg-border" />
        </div>
        <span className="text-xs text-text-tertiary font-mono ml-2">orkestra demo</span>
      </div>
      <StorybookProviders transport={demoTransport}>
        <div className="w-full h-[700px] bg-canvas">
          <Orkestra />
        </div>
      </StorybookProviders>
    </div>
  );
}
