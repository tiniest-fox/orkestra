// Compact trak-level token usage summary bar.

import type { TaskTokenUsage } from "../../types/workflow";

interface TokenUsageSummaryProps {
  tokenUsage: TaskTokenUsage;
}

export function TokenUsageSummary({ tokenUsage }: TokenUsageSummaryProps) {
  const { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } =
    tokenUsage.total;
  const cache = cache_creation_input_tokens + cache_read_input_tokens;
  const total = input_tokens + output_tokens + cache;

  return (
    <div className="px-5 pt-4 pb-1 font-mono text-forge-mono-label text-text-quaternary">
      Total tokens — In: {input_tokens.toLocaleString()} · Out: {output_tokens.toLocaleString()} ·
      Cache: {cache.toLocaleString()} ({total.toLocaleString()} total)
    </div>
  );
}
