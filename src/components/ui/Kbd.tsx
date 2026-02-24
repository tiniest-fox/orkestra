//! Keyboard hint chip — monospace label styled as a keyboard key.

interface KbdProps {
  children: string;
}

export function Kbd({ children }: KbdProps) {
  return (
    <kbd className="inline-flex items-center font-mono text-[10px] font-medium text-text-tertiary bg-canvas border border-border rounded px-1.5 py-0.5 leading-none select-none">
      {children}
    </kbd>
  );
}
