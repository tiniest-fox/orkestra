/**
 * Validates a mermaid diagram using mermaid.parse().
 * Reads the diagram text from argv[2].
 * Exits 0 if valid, 1 if invalid, with a message on stderr.
 */
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false });

const diagram = process.argv[2] ?? '';

try {
  await mermaid.parse(diagram);
  process.exit(0);
} catch (err) {
  const msg = String(err?.message ?? err);
  // DOMPurify error means parse failed but we can't surface the exact reason
  // in a Node.js environment — the diagram is still invalid.
  if (msg.includes('DOMPurify') || msg.includes('is not a function')) {
    process.stderr.write('Invalid mermaid syntax (parse error)\n');
  } else {
    process.stderr.write(`Invalid mermaid syntax: ${msg}\n`);
  }
  process.exit(1);
}
