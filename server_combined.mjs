// server_combined.mjs
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createProxyMiddleware } from "http-proxy-middleware";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 10000);
const MCP_PORT = Number(process.env.MCP_PORT ?? 18000);

// --- MCP-Server (TypeScript via tsx) starten ---
console.log("Starte MCP-Server (tsx)…");
const mcpChild = spawn(
  process.execPath,
  ["--import", "tsx/esm", path.join(__dirname, "pizzaz_server_node/src/server.ts")],
  { stdio: "inherit", env: process.env }
);

mcpChild.on("exit", (code) => {
  console.log("MCP child exited:", code);
});

// --- Express (Frontserver) ---
const app = express();

// Health
app.get("/healthz", (req, res) => res.json({ ok: true }));

// Info-Seite
app.get("/", (req, res) => {
  res.type("text/plain").send(
    [
      "Pizzaz combined server live.",
      "Assets: /pizzaz.html  /pizzaz.js  /pizzaz.css …",
      "MCP endpoint: GET /mcp (SSE), POST /mcp/messages?sessionId=…",
      "Health: /healthz",
    ].join("\n")
  );
});

// Statische Assets aus /assets
const assetsDir = path.join(__dirname, "assets");
app.use(express.static(assetsDir, { fallthrough: true, index: false }));

// Keine Pufferung für SSE
function sseNoBuffer(req, res, next) {
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  next();
}

// Proxy zu MCP-Server (SSE + POST)
const mcpTarget = `http://127.0.0.1:${MCP_PORT}`;

const mcpProxy = createProxyMiddleware({
  target: mcpTarget,
  changeOrigin: false,
  ws: false,
  proxyTimeout: 0,
  timeout: 0,
  pathRewrite: (path) => path,
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader("Connection", "keep-alive");
  },
  onProxyRes: (proxyRes, req, res) => {
    res.setHeader("X-Accel-Buffering", "no");
  },
});

// Diese Pfade 1:1 an den MCP-Server weiterleiten
app.get("/mcp", sseNoBuffer, mcpProxy);               // SSE (GET)
app.post("/mcp/messages", sseNoBuffer, mcpProxy);     // POST messages

// Bequeme Kurzpfade (optional)
app.get("/pizzaz.js", (req, res) => res.sendFile(path.join(assetsDir, "pizzaz-2d2b.js")));
app.get("/pizzaz.css", (req, res) => res.sendFile(path.join(assetsDir, "pizzaz-2d2b.css")));
app.get("/pizzaz.html", (req, res) => res.sendFile(path.join(assetsDir, "pizzaz.html")));

// 404 Fallback
app.use((req, res) => res.status(404).type("text/plain").send("Not Found"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Combined server läuft auf http://0.0.0.0:${PORT}`);
  console.log(`- MCP-Proxy aktiv unter /mcp → 127.0.0.1:${MCP_PORT}`);
  console.log(`- Beispiel: http://0.0.0.0:${PORT}/pizzaz.js`);
});
