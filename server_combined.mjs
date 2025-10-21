// server_combined.mjs
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createProxyMiddleware } from "http-proxy-middleware";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_PORT = Number(process.env.PORT || 8080); // Render setzt PORT (z. B. 10000)
const HOST = "0.0.0.0";

// *** Eigener Port für den MCP-Child-Prozess ***
const MCP_PORT = Number(process.env.MCP_PORT || 18000);

const app = express();

// ---------- Assets statisch ----------
const assetsDir = path.join(__dirname, "assets");
app.use(express.static(assetsDir, { maxAge: 0, etag: false, lastModified: false }));

// Shortcuts zu den gebauten Dateien (Hash 2d2b aus deinem Build-Log)
["pizzaz", "pizzaz-list", "pizzaz-carousel", "pizzaz-albums", "solar-system", "todo"].forEach(
  (name) => {
    app.get(`/${name}.js`, (_, res) => res.sendFile(path.join(assetsDir, `${name}-2d2b.js`)));
    app.get(`/${name}.css`, (_, res) => res.sendFile(path.join(assetsDir, `${name}-2d2b.css`)));
    app.get(`/${name}.html`, (_, res) => res.sendFile(path.join(assetsDir, `${name}.html`)));
  }
);

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---------- MCP-Server als Child starten ----------
console.log("Starte MCP-Server (Windows-kompatibel)...");
const tsxCmd = process.platform === "win32"
  ? path.join(__dirname, "node_modules", ".bin", "tsx.cmd")
  : path.join(__dirname, "node_modules", ".bin", "tsx");

const child = spawn(
  tsxCmd,
  [path.join(__dirname, "pizzaz_server_node", "src", "server.ts")],
  {
    env: { ...process.env, MCP_PORT: String(MCP_PORT) }, // <-- WICHTIG: eigener Port
    stdio: "inherit",
  }
);
child.on("exit", (code) => console.log("MCP child exited:", code));

// ---------- /mcp → http://127.0.0.1:MCP_PORT (ohne Timeouts, SSE-tauglich) ----------
app.use(
  "/mcp",
  createProxyMiddleware({
    target: `http://127.0.0.1:${MCP_PORT}`,
    changeOrigin: true,
    ws: true,
    proxyTimeout: 0,
    timeout: 0,
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader("Connection", "keep-alive");
      proxyReq.setHeader("Cache-Control", "no-cache, no-transform");
    },
    onProxyRes: (proxyRes) => {
      proxyRes.headers["X-Accel-Buffering"] = "no";
      proxyRes.headers["Cache-Control"] = "no-cache, no-transform";
      proxyRes.headers["Connection"] = "keep-alive";
    },
  })
);

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

app.listen(WEB_PORT, HOST, () => {
  console.log(`✅ Combined server läuft auf http://${HOST}:${WEB_PORT}`);
  console.log(`- MCP-Proxy aktiv unter /mcp → 127.0.0.1:${MCP_PORT}`);
  console.log(`- Beispiel: http://${HOST}:${WEB_PORT}/pizzaz.js`);
});
