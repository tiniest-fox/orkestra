import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  if (mode === "service") {
    return {
      plugins: [react()],
      base: "/",
      build: {
        outDir: "dist-service",
        rollupOptions: {
          input: resolve(import.meta.dirname, "service.html"),
        },
      },
      clearScreen: false,
    };
  }

  return {
    plugins: [react()],
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
