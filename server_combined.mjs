// server_combined.mjs
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createProxyMiddleware } from "http-proxy-middleware";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";

// ---------- 1) Assets statisch ausliefern ----------
const app = express();
const assetsDir = path.join(__dirname, "assets");
app.use(express.static(assetsDir, { maxAge: 0, etag: false, lastModified: false }));

// Shortcuts auf die gebauten Dateien
["pizzaz", "pizzaz-list", "pizzaz-carousel", "pizzaz-albums", "solar-system", "todo"].forEach(
  (name) => {
    app.get(`/${name}.js`, (_, res) => res.sendFile(path.join(assetsDir, `${name}-2d2b.js`)));
    app.get(`/${name}.css`, (_, res) => res.sendFile(path.join(assetsDir, `${name}-2d2b.css`)));
    app.get(`/${name}.html`, (_, res) => res.sendFile(path.join(assetsDir, `${name}.html`)));
  }
);

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---------- 2) MCP-Server starten (Node/tsx) ----------
console.log("Starte MCP-Server (Windows-kompatibel)...");
const tsxCmd = process.platform === "win32"
  ? path.join(__dirname, "node_modules", ".bin", "tsx.cmd")
  : path.join(__dirname, "node_modules", ".bin", "tsx");

const child = spawn(tsxCmd, [path.join(__dirname, "pizzaz_server_node", "src", "server.ts")], {
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code) => console.log("MCP child exited:", code));

// ---------- 3) /mcp → 127.0.0.1:18000 (ohne Timeouts, SSE-tauglich) ----------
app.use(
  "/mcp",
  createProxyMiddleware({
    target: "http://127.0.0.1:18000",
    changeOrigin: true,
    ws: true,
    // Timeouts für SSE deaktivieren:
    proxyTimeout: 0,
    timeout: 0,
    onProxyReq: (proxyReq, req, res) => {
      // Sicherheitshalber
      proxyReq.setHeader("Connection", "keep-alive");
      proxyReq.setHeader("Cache-Control", "no-cache, no-transform");
    },
    onProxyRes: (proxyRes, req, res) => {
      proxyRes.headers["X-Accel-Buffering"] = "no";
      proxyRes.headers["Cache-Control"] = "no-cache, no-transform";
      proxyRes.headers["Connection"] = "keep-alive";
    },
  })
);

// Root: einfache Info
app.get("/", (_req, res) => {
  res.type("text/plain").send(
    [
      "Pizzaz combined server live.",
      "Assets: /pizzaz.html  /pizzaz.js  /pizzaz.css ...",
      "MCP endpoint: GET /mcp (SSE), POST /mcp/messages?sessionId=...",
      "Health: /healthz",
    ].join("\n")
  );
});

app.listen(PORT, HOST, () => {
  console.log(`✅ Combined server läuft auf http://${HOST}:${PORT}`);
  console.log(`- MCP-Proxy aktiv unter /mcp → 127.0.0.1:18000`);
  console.log(`- Beispiel: http://${HOST}:${PORT}/pizzaz.js`);
});
