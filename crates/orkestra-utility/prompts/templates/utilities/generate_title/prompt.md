Summarize this Trak description into a concise title (3-8 words):

{{description}}

Rules:
- Be specific and actionable
- Use sentence case
- No quotes or trailing punctuation

If the description contains only an external link or is otherwise too opaque to
title directly (e.g. an Asana URL, a GitHub issue URL, or a bare "see <link>"),
use whatever skills and MCP tools you have available to fetch the linked
resource and summarize its actual content. For Asana URLs, use the `asana`
skill/CLI (e.g. `asana task <gid> --json`) to read the task name and notes.
For other links, use the appropriate tool if one is available.

If no tool is available or the fetch fails, produce the best title you can
from the raw description — never output a title that is itself a URL or the
phrase "Unable to access ...".

Output the final JSON when you're done.
