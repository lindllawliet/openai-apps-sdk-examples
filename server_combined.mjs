// server_combined.mjs
// Kombinierter Server: UI + MCP (Windows-kompatible Version mit cmd.exe)

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// ========== 1) UI-Assets ==========
const assetsDir = path.join(__dirname, "assets");
app.use("/assets", express.static(assetsDir, { maxAge: "1h", immutable: true }));

app.get("/:name.:ext", (req, res, next) => {
  const { name, ext } = req.params;
  try {
    const files = fs.readdirSync(assetsDir)
      .filter(f => f.startsWith(`${name}-`) && f.endsWith(`.${ext}`))
      .sort();
    if (files.length) return res.sendFile(path.join(assetsDir, files[0]));
  } catch (err) {
    console.error("Fehler beim Suchen der Datei:", err);
  }
  next();
});

// ========== 2) MCP-Server starten ==========
const MCP_PORT = process.env.MCP_PORT || "18000";
const mcpDir = path.join(__dirname, "pizzaz_server_node");
const tsxBin = path.join(__dirname, "node_modules", ".bin", "tsx.cmd");

console.log("Starte MCP-Server (Windows-kompatibel)...");

let child;

// 🪟 Windows-sicherer Spawn-Befehl
if (process.platform === "win32") {
  child = spawn("cmd.exe", ["/c", `"${tsxBin}" src/server.ts`], {
    cwd: mcpDir,
    env: { ...process.env, PORT: MCP_PORT },
    stdio: "inherit",
    shell: true
  });
} else {
  // Für Linux/macOS
  child = spawn(tsxBin, ["src/server.ts"], {
    cwd: mcpDir,
    env: { ...process.env, PORT: MCP_PORT },
    stdio: "inherit"
  });
}

child.on("error", err => {
  console.error("❌ Fehler beim Starten des MCP-Servers:", err);
});

// Proxy /mcp → MCP-Server
app.use("/mcp", createProxyMiddleware({
  target: `http://127.0.0.1:${MCP_PORT}`,
  changeOrigin: true,
  ws: true
}));

// ========== 3) Healthcheck + 404 ==========
app.get("/healthz", (req, res) => res.json({ ok: true }));
app.use((req, res) => res.status(404).send("Not found"));

// ========== 4) Server starten ==========
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n✅ Combined server läuft auf http://localhost:${PORT}`);
  console.log(`- MCP-Proxy aktiv unter /mcp → 127.0.0.1:${MCP_PORT}`);
  console.log(`- Beispiel: http://localhost:${PORT}/pizzaz.js\n`);
});
