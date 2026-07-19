#!/usr/bin/env node
// Optional local CORS proxy for LLM providers that refuse direct browser calls
// from the Excel task pane. Zero dependencies, binds 127.0.0.1 only, and only
// forwards to a whitelist of known provider hosts — never an open proxy.
//
// Usage:  node proxy/cors-proxy.mjs          (or: npm run proxy)
// Then enable "Use proxy" for the affected provider in MP Analyzer settings.
// The client rewrites  https://api.deepseek.com/chat/completions
//                 to   https://localhost:8788/https://api.deepseek.com/chat/completions
//
// HTTPS matters: the task pane is a secure context, so the proxy reuses the
// office-addin-dev-certs localhost certificate (`npm run certs` creates it).
import https from "node:https";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 8788);

const DEFAULT_HOSTS = [
  "api.deepseek.com",
  "api.moonshot.cn",
  "api.moonshot.ai",
  "open.bigmodel.cn",
  "dashscope.aliyuncs.com",
  "dashscope-intl.aliyuncs.com",
  "api.minimaxi.com",
  "api.minimax.io",
  "api.minimax.chat",
];
const ALLOW = new Set(
  [...DEFAULT_HOSTS, ...(process.env.ALLOW_HOSTS || "").split(",")].map((h) => h.trim()).filter(Boolean)
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Api-Key",
  "Access-Control-Max-Age": "86400",
};

function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  let url;
  try {
    url = new URL((req.url || "").replace(/^\//, ""));
  } catch {
    res.writeHead(400, CORS_HEADERS);
    res.end("Bad target URL — expected /https://<provider-host>/<path>");
    return;
  }
  if (url.protocol !== "https:" || !ALLOW.has(url.hostname)) {
    res.writeHead(403, CORS_HEADERS);
    res.end(`Host not allowed: ${url.hostname} (add via ALLOW_HOSTS env if intentional)`);
    return;
  }
  const headers = {};
  for (const h of ["authorization", "content-type", "accept", "x-api-key"]) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  const upstream = https.request(url, { method: req.method, headers }, (up) => {
    console.log(`${req.method} ${url.hostname}${url.pathname} -> ${up.statusCode}`);
    const responseHeaders = { ...CORS_HEADERS };
    if (up.headers["content-type"]) responseHeaders["Content-Type"] = up.headers["content-type"];
    res.writeHead(up.statusCode || 502, responseHeaders);
    up.pipe(res); // streams SSE through unbuffered
  });
  upstream.on("error", (e) => {
    console.log(`${req.method} ${url.hostname}${url.pathname} -> upstream error: ${e.message}`);
    if (!res.headersSent) res.writeHead(502, CORS_HEADERS);
    res.end("Upstream error: " + e.message);
  });
  req.pipe(upstream);
}

const certDir = join(homedir(), ".office-addin-dev-certs");
const crt = join(certDir, "localhost.crt");
const key = join(certDir, "localhost.key");

if (existsSync(crt) && existsSync(key)) {
  https
    .createServer({ cert: readFileSync(crt), key: readFileSync(key) }, handler)
    .listen(PORT, "127.0.0.1", () => console.log(`CORS proxy listening on https://localhost:${PORT}`));
} else {
  console.warn(
    "WARNING: office-addin-dev-certs not found — serving plain http. " +
      "The Office task pane will likely block mixed content; run `npm run certs` first."
  );
  http.createServer(handler).listen(PORT, "127.0.0.1", () => console.log(`CORS proxy listening on http://localhost:${PORT}`));
}
