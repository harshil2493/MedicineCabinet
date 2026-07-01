import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Repo is served at https://<user>.github.io/MedicineCabinet/
export default defineConfig({
  base: "/MedicineCabinet/",
  plugins: [react()],
  server: {
    port: 9999,
    strictPort: true,
  },
});
