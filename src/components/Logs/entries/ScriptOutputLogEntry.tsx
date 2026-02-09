/**
 * Script output log entry - displays script terminal output with ANSI colors.
 */

import AnsiToHtml from "ansi-to-html";

// Converter for ANSI escape codes to HTML (for script output with terminal colors)
const ansiConverter = new AnsiToHtml({
  fg: "inherit", // inherit from parent text color
  bg: "transparent",
  newline: true,
  escapeXML: true,
});

interface ScriptOutputLogEntryProps {
  content: string;
}

export function ScriptOutputLogEntry({ content }: ScriptOutputLogEntryProps) {
  const htmlContent = ansiConverter.toHtml(content);

  return (
    <div className="py-1 px-3 bg-stone-100 dark:bg-stone-800/50 border-l-2 border-stone-300 dark:border-stone-600 rounded-r">
      <pre
        className="text-stone-700 dark:text-stone-300 text-sm whitespace-pre-wrap font-mono overflow-x-auto"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is from our own script logs with ANSI codes escaped
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  );
}
