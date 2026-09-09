import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const mobile = ["android", "ios"].includes(process.env.TAURI_ENV_PLATFORM ?? "");

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Listen on every interface so the phone can reach the dev server whatever the PC's LAN IP is.
    host: host || mobile ? "0.0.0.0" : false,
    // Phone: no live-reload channel at all. The WebView drops the socket whenever the app is
    // backgrounded, and Vite's client answers a dropped socket with a full page reload on resume —
    // which re-scanned the library at every unlock. Changes reach the phone by reopening the app.
    hmr: mobile
      ? false
      : host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
