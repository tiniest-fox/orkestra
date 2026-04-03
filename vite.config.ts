import { resolve } from "path";
import { readFileSync, existsSync } from "node:fs";
import { execFile, execSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// ============================================================================
// Service mock plugin
// ============================================================================
//
// Activated only when running `pnpm dev --mode service` (command === 'serve').
// Provides:
//   - URL rewrite so / serves service.html
//   - In-memory mock API at /api/* with realistic project states + transitions
//   - Auth token injection so PortalPage skips the PairingForm gate
//
// State lives in this module's closure and persists across HMR but resets on
// server restart.

type MockProject = {
  id: string;
  name: string;
  status: string;
  error_message?: string;
};

function serviceMockPlugin(): Plugin {
  const projects: MockProject[] = [
    { id: "proj-1", name: "orkestra", status: "running" },
    { id: "proj-2", name: "my-rails-app", status: "stopped" },
    {
      id: "proj-3",
      name: "data-pipeline",
      status: "error",
      error_message: "Container failed to start: OOMKilled",
    },
    { id: "proj-4", name: "frontend", status: "starting" },
  ];

  function readBody(req: IncomingMessage): Promise<Record<string, string>> {
    return new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(raw || "{}"));
        } catch {
          resolve({});
        }
      });
    });
  }

  function json(res: ServerResponse, data: unknown, status = 200) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  }

  return {
    name: "service-mock",

    // Inject a dev auth token so PortalPage skips the PairingForm gate.
    // Only runs in serve mode — not during pnpm build --mode service.
    transformIndexHtml(html) {
      return html.replace(
        "</head>",
        `<script>localStorage.setItem('orkestra.service_token','dev-mock');</script></head>`,
      );
    },

    configureServer(server) {
      // Rewrite / → /service.html so Vite serves the right entry point.
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/" || req.url === "/index.html") req.url = "/service.html";
        next();
      });

      // Mock /api/* — req.url here is the path AFTER the /api prefix (connect behaviour).
      server.middlewares.use("/api", async (req, res) => {
        const urlPath = req.url ?? "";
        const projectMatch = urlPath.match(/^\/projects\/([^/]+)(\/.*)?$/);

        if (urlPath === "/projects" && req.method === "GET") {
          json(res, projects);
        } else if (urlPath === "/projects" && req.method === "POST") {
          const body = await readBody(req);
          const p: MockProject = {
            id: `proj-${Date.now()}`,
            name: body.name ?? "new-project",
            status: "cloning",
          };
          projects.push(p);
          setTimeout(() => {
            p.status = "stopped";
          }, 3000);
          json(res, {});
        } else if (projectMatch && req.method === "DELETE") {
          const i = projects.findIndex((p) => p.id === projectMatch[1]);
          if (i >= 0) projects.splice(i, 1);
          json(res, {});
        } else if (projectMatch?.[2] === "/start" && req.method === "POST") {
          const p = projects.find((p) => p.id === projectMatch[1]);
          if (p) {
            p.status = "starting";
            setTimeout(() => {
              p.status = "running";
            }, 2000);
          }
          json(res, {});
        } else if (projectMatch?.[2] === "/stop" && req.method === "POST") {
          const p = projects.find((p) => p.id === projectMatch[1]);
          if (p) {
            p.status = "stopping";
            setTimeout(() => {
              p.status = "stopped";
            }, 2000);
          }
          json(res, {});
        } else if (projectMatch?.[2] === "/rebuild" && req.method === "POST") {
          const p = projects.find((p) => p.id === projectMatch[1]);
          if (p) {
            p.status = "rebuilding";
            setTimeout(() => {
              p.status = "running";
            }, 3000);
          }
          json(res, {});
        } else if (projectMatch?.[2] === "/logs") {
          json(res, { lines: ["[dev] Mock server — no real logs available."] });
        } else if (urlPath === "/github/status") {
          const available = await new Promise<boolean>((resolve) => {
            execFile("gh", ["auth", "status"], (err) => resolve(!err));
          });
          json(res, available ? { available: true } : { available: false, error: "gh auth status failed — run: gh auth login" });
        } else if (urlPath.startsWith("/github/repos")) {
          const search = new URL(req.url!, "http://localhost").searchParams.get("search")?.toLowerCase() ?? "";
          type Repo = { name: string; nameWithOwner: string; description: string; url: string };
          const all = await new Promise<Repo[]>((resolve) => {
            execFile("gh", ["repo", "list", "--json", "name,nameWithOwner,description,url", "--limit", "100"], (err, stdout) => {
              if (err) { resolve([]); return; }
              try { resolve(JSON.parse(stdout)); } catch { resolve([]); }
            });
          });
          const repos = search
            ? all.filter((r) => r.nameWithOwner.toLowerCase().includes(search) || (r.description ?? "").toLowerCase().includes(search))
            : all;
          json(res, repos);
        } else if (urlPath === "/pairing-code" && req.method === "POST") {
          json(res, { code: "DEV-1234" });
        } else {
          json(res, { error: "Not found" }, 404);
        }
      });
    },
  };
}

function resolveHashFromGitFiles(dir: string): string {
  const headPath = resolve(dir, '.git/HEAD');
  const content = readFileSync(headPath, 'utf8').trim();
  if (/^[0-9a-f]{40}$/.test(content)) {
    return content.slice(0, 7);
  }
  if (content.startsWith('ref: ')) {
    const refPath = content.slice(5).trim();
    const refFile = resolve(dir, '.git', refPath);
    if (existsSync(refFile)) {
      return readFileSync(refFile, 'utf8').trim().slice(0, 7);
    }
    const packedRefsPath = resolve(dir, '.git/packed-refs');
    if (existsSync(packedRefsPath)) {
      const packedRefs = readFileSync(packedRefsPath, 'utf8');
      for (const line of packedRefs.split('\n')) {
        if (line.startsWith('#') || line.startsWith('^')) continue;
        const parts = line.split(' ');
        if (parts.length >= 2 && parts[1] === refPath) {
          return parts[0].slice(0, 7);
        }
      }
    }
  }
  throw new Error('Cannot resolve commit hash from .git/HEAD');
}

const commitHash = (() => {
  const envHash = process.env.VITE_COMMIT_HASH;
  if (envHash && envHash !== 'dev') return envHash;
  try {
    return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname }).toString().trim();
  } catch {
    // fall through
  }
  try {
    return resolveHashFromGitFiles(import.meta.dirname);
  } catch {
    return 'dev';
  }
})();

const releaseVersion = process.env.VITE_RELEASE_VERSION ?? '';

// https://vitejs.dev/config/
export default defineConfig(async ({ mode, command }) => {
  if (mode === "service") {
    return {
      plugins: [react(), ...(command === "serve" ? [serviceMockPlugin()] : [])],
      define: {
        'import.meta.env.VITE_COMMIT_HASH': JSON.stringify(commitHash),
        'import.meta.env.VITE_RELEASE_VERSION': JSON.stringify(releaseVersion),
      },
      base: "/",
      server: {
        port: 5174,
        strictPort: true,
        watch: {
          ignored: ["**/src-tauri/**", "**/.orkestra/**"],
        },
      },
      build: {
        outDir: "dist-service",
        rollupOptions: {
          input: resolve(import.meta.dirname, "service.html"),
        },
      },
      clearScreen: false,
    };
  }

  // biome-ignore lint/suspicious/noExplicitAny: vite-plugin-pwa is optional dep, loaded dynamically
  const plugins: any[] = [
    react(),
    // Stub virtual:pwa-register in non-PWA modes so the dev server can resolve
    // the dynamic import in main.tsx. In PWA mode, VitePWA provides the real module.
    ...(mode !== "pwa"
      ? [
          {
            name: "stub-pwa-register",
            resolveId(id: string) {
              if (id === "virtual:pwa-register") return id;
            },
            load(id: string) {
              if (id === "virtual:pwa-register")
                return "export const registerSW = () => {};";
            },
          },
        ]
      : []),
  ];

  if (mode === "pwa") {
    // Dynamic import to avoid loading the PWA plugin in Tauri builds.
    // vite-plugin-pwa is a devDependency so this is safe at build time.
    const { VitePWA } = await import("vite-plugin-pwa");
    plugins.push(
      VitePWA({
        registerType: "autoUpdate",
        strategies: "generateSW",
        workbox: {
          // Network-first for all requests — the daemon is the data store.
          // No meaningful offline support; the app needs the daemon to function.
          runtimeCaching: [
            {
              urlPattern: /.*/,
              handler: "NetworkFirst",
              options: {
                cacheName: "orkestra-runtime",
                expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
              },
            },
          ],
        },
        manifest: {
          name: "Orkestra",
          short_name: "Orkestra",
          description: "AI task orchestration",
          display: "standalone",
          theme_color: "#1a1a2e",
          background_color: "#1a1a2e",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
        },
      }),
    );
  }

  return {
    plugins,
    define: {
      'import.meta.env.VITE_COMMIT_HASH': JSON.stringify(commitHash),
      'import.meta.env.VITE_RELEASE_VERSION': JSON.stringify(releaseVersion),
    },
    base: "/",
    envPrefix: ["VITE_", "TAURI_ENV_"],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**", "**/.orkestra/**"],
      },
    },
  };
});
