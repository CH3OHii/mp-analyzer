#!/usr/bin/env node
// Zero-dependency static server for the built add-in (dist/) on
// https://localhost:3000 — what the double-click launchers run, so no terminal
// is needed day-to-day. Exits quietly if a server is already on the port, and
// builds dist/ automatically the first time it's missing.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PORT = 3000;

if (!existsSync(join(DIST, "index.html"))) {
  console.log("dist/ missing — building once (can take ~30s)…");
  const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error("Build failed — run `npm run build` manually to see the error.");
    process.exit(1);
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function handler(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = normalize(join(DIST, urlPath));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  try {
    const body = readFileSync(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

const certDir = join(homedir(), ".office-addin-dev-certs");
const crt = join(certDir, "localhost.crt");
const key = join(certDir, "localhost.key");
const secure = existsSync(crt) && existsSync(key);
if (!secure && process.env.ALLOW_HTTP !== "1") {
  // Refuse to run rather than hold port 3000 with an http server Excel can't
  // use — otherwise a later, cert-fixed relaunch would see "already running"
  // and keep the broken one.
  console.error(
    "Dev certs missing — Excel requires https. Run `npm run certs` once, then relaunch.\n" +
      "(Set ALLOW_HTTP=1 only for browser-only preview without Excel.)"
  );
  process.exit(1);
}
if (!secure) {
  console.warn("WARNING: serving plain http (ALLOW_HTTP=1) — Excel will refuse the pane.");
}

const server = secure
  ? https.createServer({ cert: readFileSync(crt), key: readFileSync(key) }, handler)
  : http.createServer(handler);

server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    console.log(`Port ${PORT} already in use — server presumably running. Nothing to do.`);
    process.exit(0);
  }
  console.error(e.message ?? e);
  process.exit(1);
});

server.listen(PORT, "localhost", () =>
  console.log(`MP Analyzer serving dist/ on ${secure ? "https" : "http"}://localhost:${PORT}`)
);
