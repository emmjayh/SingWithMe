import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@audio": path.resolve(__dirname, "src/audio"),
      "@components": path.resolve(__dirname, "src/components"),
      "@state": path.resolve(__dirname, "src/state")
    }
  },
  server: {
    port: 5173
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2020"
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2020"
    }
  }
});
