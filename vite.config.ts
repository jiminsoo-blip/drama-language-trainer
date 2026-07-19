import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
// base: production builds target GitHub Pages at /drama-language-trainer/;
// dev stays at '/'. Electron builds override with BUILD_BASE=./ (app:// root).
export default defineConfig(({ command }) => ({
  base: process.env.BUILD_BASE ?? (command === 'build' ? '/drama-language-trainer/' : '/'),
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
