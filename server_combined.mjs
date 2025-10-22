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
mcpChild.on("exit", (code) => console.log("MCP child exited:", code));

// --- Express (Frontserver) ---
const app = express();

// ---- gemeinsame Header-Helper ----
function addCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function addNoBuffer(res) {
  // wichtig für Render/Proxies, damit SSE nicht gepuffert wird
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
}

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

// --- CORS-Preflight (wird von ChatGPT sehr oft vorab gesendet) ---
app.options("/mcp", (req, res) => {
  addCors(res);
  addNoBuffer(res);
  res.status(204).end();
});
app.options("/mcp/messages", (req, res) => {
  addCors(res);
  addNoBuffer(res);
  res.status(204).end();
});

// --- Proxy zu MCP-Server (SSE + POST) ---
const mcpTarget = `http://127.0.0.1:${MCP_PORT}`;

// Mini-Logger, damit du im Render-Log siehst, dass Requests ankommen
app.use((req, _res, next) => {
  if (req.path === "/mcp" || req.path === "/mcp/messages") {
    console.log(`[MCP] ${req.method} ${req.originalUrl}`);
  }
  next();
});

const mcpProxy = createProxyMiddleware({
  target: mcpTarget,
  changeOrigin: false,
  ws: false,
  // wichtig: keine Timeouts/Abbrüche für lange SSE-Sessions
  proxyTimeout: 0,
  timeout: 0,
  preserveHeaderKeyCase: true,
  selfHandleResponse: false, // Upstream liefert die Antwort, wir fummeln nicht am Body
  onProxyReq: (proxyReq, req) => {
    // für GET /mcp (SSE) gerne explizit halten
    proxyReq.setHeader("Connection", "keep-alive");
    if (req.method === "GET" && req.path === "/mcp") {
      // Browser/ChatGPT setzen das meist selbst — schadet aber nicht:
      proxyReq.setHeader("Accept", "text/event-stream");
      proxyReq.setHeader("Cache-Control", "no-cache");
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    addCors(res);
    addNoBuffer(res);
    // bei SSE sicherstellen, dass Content-Type passt
    if (req.method === "GET" && req.path === "/mcp") {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      // content-length bei Streams ist kontraproduktiv
      res.removeHeader?.("Content-Length");
      delete proxyRes.headers?.["content-length"];
    }
  },
});

// Diese Pfade 1:1 an den MCP-Server weiterleiten
app.get("/mcp", (req, res, next) => {
  addCors(res);
  addNoBuffer(res);
  return mcpProxy(req, res, next);
});
app.post("/mcp/messages", (req, res, next) => {
  addCors(res);
  addNoBuffer(res);
  return mcpProxy(req, res, next);
});

// Bequeme Kurzpfade (optional) – Hashes ggf. beim nächsten Build anpassen
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
