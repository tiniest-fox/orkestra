const GITHUB_URL = "https://api.github.com/repos/tiniest-fox/orkestra/releases";

export async function onRequest(context) {
  const upstream = await fetch(GITHUB_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "orkestra-docs",
    },
    cf: { cacheTtl: 300, cacheEverything: true, cacheTtlByStatus: { "200-299": 300, "400-599": 0 } },
  });

  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: "Failed to fetch releases" }), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
