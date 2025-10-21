// pizzaz_server_node/src/server.ts
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type PizzazWidget = {
  id: string;
  title: string;
  templateUri: string;
  invoking: string;
  invoked: string;
  html: string;
  responseText: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");

function readWidgetHtml(componentName: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "pnpm run build" before starting the server.`
    );
  }
  const directPath = path.join(ASSETS_DIR, `${componentName}.html`);
  let htmlContents: string | null = null;

  if (fs.existsSync(directPath)) {
    htmlContents = fs.readFileSync(directPath, "utf8");
  } else {
    const candidates = fs
      .readdirSync(ASSETS_DIR)
      .filter(f => f.startsWith(`${componentName}-`) && f.endsWith(".html"))
      .sort();
    const fallback = candidates[candidates.length - 1];
    if (fallback) htmlContents = fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
  }

  if (!htmlContents) {
    throw new Error(
      `Widget HTML for "${componentName}" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`
    );
  }
  return htmlContents;
}

function widgetMeta(w: PizzazWidget) {
  return {
    "openai/outputTemplate": w.templateUri,
    "openai/toolInvocation/invoking": w.invoking,
    "openai/toolInvocation/invoked": w.invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
  } as const;
}

const widgets: PizzazWidget[] = [
  { id: "pizza-map", title: "Show Pizza Map", templateUri: "ui://widget/pizza-map.html", invoking: "Hand-tossing a map", invoked: "Served a fresh map", html: readWidgetHtml("pizzaz"), responseText: "Rendered a pizza map!" },
  { id: "pizza-carousel", title: "Show Pizza Carousel", templateUri: "ui://widget/pizza-carousel.html", invoking: "Carousel some spots", invoked: "Served a fresh carousel", html: readWidgetHtml("pizzaz-carousel"), responseText: "Rendered a pizza carousel!" },
  { id: "pizza-albums", title: "Show Pizza Album", templateUri: "ui://widget/pizza-albums.html", invoking: "Hand-tossing an album", invoked: "Served a fresh album", html: readWidgetHtml("pizzaz-albums"), responseText: "Rendered a pizza album!" },
  { id: "pizza-list", title: "Show Pizza List", templateUri: "ui://widget/pizza-list.html", invoking: "Hand-tossing a list", invoked: "Served a fresh list", html: readWidgetHtml("pizzaz-list"), responseText: "Rendered a pizza list!" },
];

const widgetsById = new Map<string, PizzazWidget>();
const widgetsByUri = new Map<string, PizzazWidget>();
widgets.forEach(w => { widgetsById.set(w.id, w); widgetsByUri.set(w.templateUri, w); });

const toolInputSchema = {
  type: "object",
  properties: { pizzaTopping: { type: "string", description: "Topping to mention when rendering the widget." } },
  required: ["pizzaTopping"],
  additionalProperties: false,
} as const;
const toolInputParser = z.object({ pizzaTopping: z.string() });

const tools: Tool[] = widgets.map(w => ({
  name: w.id,
  description: w.title,
  inputSchema: toolInputSchema,
  title: w.title,
  _meta: widgetMeta(w),
  annotations: { destructiveHint: false, openWorldHint: false, readOnlyHint: true },
}));

const resources: Resource[] = widgets.map(w => ({
  uri: w.templateUri,
  name: w.title,
  description: `${w.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(w),
}));

const resourceTemplates: ResourceTemplate[] = widgets.map(w => ({
  uriTemplate: w.templateUri,
  name: w.title,
  description: `${w.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(w),
}));

function createPizzazServer(): Server {
  const server = new Server({ name: "pizzaz-node", version: "0.1.0" }, { capabilities: { resources: {}, tools: {} } });

  server.setRequestHandler(ListResourcesRequestSchema, async (_r: ListResourcesRequest) => ({ resources }));
  server.setRequestHandler(ReadResourceRequestSchema, async (r: ReadResourceRequest) => {
    const w = widgetsByUri.get(r.params.uri);
    if (!w) throw new Error(`Unknown resource: ${r.params.uri}`);
    return { contents: [{ uri: w.templateUri, mimeType: "text/html+skybridge", text: w.html, _meta: widgetMeta(w) }] };
  });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_r: ListResourceTemplatesRequest) => ({ resourceTemplates }));
  server.setRequestHandler(ListToolsRequestSchema, async (_r: ListToolsRequest) => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (r: CallToolRequest) => {
    const w = widgetsById.get(r.params.name);
    if (!w) throw new Error(`Unknown tool: ${r.params.name}`);
    const args = toolInputParser.parse(r.params.arguments ?? {});
    return { content: [{ type: "text", text: w.responseText }], structuredContent: { pizzaTopping: args.pizzaTopping }, _meta: widgetMeta(w) };
  });

  return server;
}

type SessionRecord = { server: Server; transport: SSEServerTransport };
const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";

async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // wichtig gegen Proxy-Buffering

  try { res.write(":\n\n"); /* erstes Byte */ /* @ts-ignore */ res.flushHeaders?.(); } catch {}

  const keepAlive = setInterval(() => {
    try { res.write("event: ping\ndata: {}\n\n"); } catch {}
  }, 15000);

  const server = createPizzazServer();
  const transport = new SSEServerTransport(postPath, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => { clearInterval(keepAlive); sessions.delete(sessionId); await server.close(); };
  transport.onerror = (e) => { console.error("SSE transport error", e); };

  try {
    await server.connect(transport);
  } catch (e) {
    clearInterval(keepAlive);
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", e);
    if (!res.headersSent) res.writeHead(500).end("Failed to establish SSE connection");
  }
}

async function handlePostMessage(req: IncomingMessage, res: ServerResponse, url: URL) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) { res.writeHead(400).end("Missing sessionId query parameter"); return; }
  const session = sessions.get(sessionId);
  if (!session) { res.writeHead(404).end("Unknown session"); return; }
  try {
    await session.transport.handlePostMessage(req, res);
  } catch (e) {
    console.error("Failed to process message", e);
    if (!res.headersSent) res.writeHead(500).end("Failed to process message");
  }
}

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url) { res.writeHead(400).end("Missing URL"); return; }
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && (url.pathname === ssePath || url.pathname === postPath)) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    });
    res.end(); return;
  }

  if (req.method === "GET" && url.pathname === ssePath) { await handleSseRequest(res); return; }
  if (req.method === "POST" && url.pathname === postPath) { await handlePostMessage(req, res, url); return; }

  res.writeHead(404).end("Not Found");
});

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

httpServer.listen(port, () => {
  console.log(`Pizzaz MCP server listening on http://localhost:${port}`);
  console.log(`  SSE stream: GET http://localhost:${port}${ssePath}`);
  console.log(`  Message post endpoint: POST http://localhost:${port}${postPath}?sessionId=...`);
});
