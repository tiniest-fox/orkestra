import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  // biome-ignore lint/suspicious/noExplicitAny: vite-plugin-pwa is optional dep, loaded dynamically
  const plugins: any[] = [react()];

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
    base: mode === "pwa" ? "/app/" : "/",
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
