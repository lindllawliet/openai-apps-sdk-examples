// pizzaz_server_node/src/server.ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type Widget = {
  id: string;
  title: string;
  htmlFile: string;
  html: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const ASSETS = path.resolve(ROOT, "assets");

function readHtml(file: string): string {
  const p = path.join(ASSETS, file);
  if (!fs.existsSync(p)) throw new Error(`Missing widget asset: ${p}`);
  return fs.readFileSync(p, "utf8");
}

const widgets: Widget[] = [
  { id: "pizza-map", title: "Pizza Map", htmlFile: "pizzaz.html", html: readHtml("pizzaz.html") },
  { id: "pizza-carousel", title: "Pizza Carousel", htmlFile: "pizzaz-carousel.html", html: readHtml("pizzaz-carousel.html") },
  { id: "pizza-albums", title: "Pizza Albums", htmlFile: "pizzaz-albums.html", html: readHtml("pizzaz-albums.html") },
  { id: "pizza-list", title: "Pizza List", htmlFile: "pizzaz-list.html", html: readHtml("pizzaz-list.html") },
];

const widgetsById = new Map(widgets.map(w => [w.id, w]));

const inputSchema = z.object({ pizzaTopping: z.string() });

function makeMeta(widget: Widget) {
  return {
    "openai/outputTemplate": `ui://widget/${widget.htmlFile}`,
    "openai/widget": { type: "html", uri: `ui://widget/${widget.htmlFile}` },
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
  } as const;
}

function createPizzazServer(): Server {
  const server = new Server({ name: "pizzaz", version: "1.0.0" }, { capabilities: { resources: {}, tools: {} } });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: widgets.map(w => ({
      uri: `ui://widget/${w.htmlFile}`,
      name: w.title,
      mimeType: "text/html",
      description: `${w.title} widget`,
      _meta: makeMeta(w),
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req: ReadResourceRequest) => {
    const widget = widgets.find(w => req.params.uri.endsWith(w.htmlFile));
    if (!widget) throw new Error(`Unknown widget: ${req.params.uri}`);
    return {
      contents: [{ uri: `ui://widget/${widget.htmlFile}`, mimeType: "text/html", text: widget.html, _meta: makeMeta(widget) }],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async (_req: ListToolsRequest) => ({
    tools: widgets.map(w => ({
      name: w.id,
      title: w.title,
      description: `Render ${w.title}`,
      inputSchema: { type: "object", properties: { pizzaTopping: { type: "string" } }, required: ["pizzaTopping"] },
      _meta: makeMeta(w),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
    const widget = widgetsById.get(req.params.name);
    if (!widget) throw new Error(`Unknown tool: ${req.params.name}`);
    const args = inputSchema.parse(req.params.arguments ?? {});
    return {
      content: [
        { type: "text", text: `Rendered ${widget.title} with topping ${args.pizzaTopping}` },
        { type: "text/html", text: widget.html },
      ],
      _meta: makeMeta(widget),
    };
  });

  return server;
}

// === HTTP handling ===
const MCP_PORT = Number(process.env.MCP_PORT ?? 18000);
const HOST = "0.0.0.0";
const ssePath = "/mcp";
const postPath = "/mcp/messages";
const sessions = new Map<string, { server: Server; transport: SSEServerTransport }>();

async function handleSse(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const server = createPizzazServer();
  const transport = new SSEServerTransport(postPath, res);
  sessions.set(transport.sessionId, { server, transport });
  await server.connect(transport);
}

async function handlePost(req: IncomingMessage, res: ServerResponse, url: URL) {
  const id = url.searchParams.get("sessionId");
  if (!id) return void res.writeHead(400).end("Missing sessionId");
  const s = sessions.get(id);
  if (!s) return void res.writeHead(404).end("Session not found");
  await s.transport.handlePostMessage(req, res);
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) return void res.writeHead(400).end("Missing URL");
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === ssePath) return void handleSse(res);
  if (req.method === "POST" && url.pathname === postPath) return void handlePost(req, res, url);
  res.writeHead(404).end("Not Found");
});

httpServer.listen(MCP_PORT, HOST, () => {
  console.log(`✅ Pizzaz MCP server running on port ${MCP_PORT}`);
});
