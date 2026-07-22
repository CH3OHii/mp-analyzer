import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Office requires the pane to load over https. office-addin-dev-certs creates and
// trusts a localhost cert (`npm run certs`, admin once). Until those cert files
// exist we fall back to plain http so build/test tooling never blocks on a prompt.
async function httpsOptions() {
  // Escape hatch for browser-based previews whose trust store lacks the dev CA
  // (Excel itself always needs the https server).
  if (process.env.MP_NO_HTTPS) return undefined;
  const certDir = join(homedir(), ".office-addin-dev-certs");
  if (!existsSync(join(certDir, "localhost.crt"))) return undefined;
  const { getHttpsServerOptions } = await import("office-addin-dev-certs");
  return await getHttpsServerOptions();
}

export default defineConfig(async () => {
  const https = await httpsOptions();
  return {
    plugins: [react()],
    server: { host: "localhost", port: 3000, strictPort: true, https },
    preview: { host: "localhost", port: 3000, strictPort: true, https },
    build: { target: "es2022" },
  };
});
