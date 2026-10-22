import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: { input: { main: resolve(__dirname, "index.html"), animals: resolve(__dirname, "animals.html"), drones: resolve(__dirname, "drones.html"), bench: resolve(__dirname, "bench.html") } },
  },
  server: { port: 5173 },
});
