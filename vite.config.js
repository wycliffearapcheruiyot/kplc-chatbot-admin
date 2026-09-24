import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server on 3000: the gateway always allows http://localhost:3000 in CORS.
export default defineConfig({ plugins: [react()], server: { port: 3000 } });
