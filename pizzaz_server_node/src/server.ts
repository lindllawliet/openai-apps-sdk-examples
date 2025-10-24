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
      .filter(
        (file) => file.startsWith(`${componentName}-`) && file.endsWith(".html")
      )
      .sort();
    const fallback = candidates[candidates.length - 1];
    if (fallback) {
      htmlContents = fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
    }
  }

  if (!htmlContents) {
    throw new Error(
      `Widget HTML for "${componentName}" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`
    );
  }

  return htmlContents;
}

function widgetMeta(widget: PizzazWidget) {
  return {
    "openai/outputTemplate": widget.templateUri,
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
  } as const;
}

const widgets: PizzazWidget[] = [
  {
    id: "pizza-map",
    title: "Show Pizza Map",
    templateUri: "ui://widget/pizza-map.html",
    invoking: "Hand-tossing a map",
    invoked: "Served a fresh map",
    html: readWidgetHtml("pizzaz"),
    responseText: "Rendered a pizza map!",
  },
  {
    id: "pizza-carousel",
    title: "Show Pizza Carousel",
    templateUri: "ui://widget/pizza-carousel.html",
    invoking: "Carousel some spots",
    invoked: "Served a fresh carousel",
    html: readWidgetHtml("pizzaz-carousel"),
    responseText: "Rendered a pizza carousel!",
  },
  {
    id: "pizza-albums",
    title: "Show Pizza Album",
    templateUri: "ui://widget/pizza-albums.html",
    invoking: "Hand-tossing an album",
    invoked: "Served a fresh album",
    html: readWidgetHtml("pizzaz-albums"),
    responseText: "Rendered a pizza album!",
  },
  {
    id: "pizza-list",
    title: "Show Pizza List",
    templateUri: "ui://widget/pizza-list.html",
    invoking: "Hand-tossing a list",
    invoked: "Served a fresh list",
    html: readWidgetHtml("pizzaz-list"),
    responseText: "Rendered a pizza list!",
  },
];

const widgetsById = new Map<string, PizzazWidget>();
const widgetsByUri = new Map<string, PizzazWidget>();
widgets.forEach((w) => {
  widgetsById.set(w.id, w);
  widgetsByUri.set(w.templateUri, w);
});

const toolInputSchema = {
  type: "object",
  properties: {
    pizzaTopping: {
      type: "string",
      description: "Topping to mention when rendering the widget.",
    },
  },
  required: ["pizzaTopping"],
  additionalProperties: false,
} as const;

const toolInputParser = z.object({ pizzaTopping: z.string() });

const tools: Tool[] = widgets.map((w) => ({
  name: w.id,
  description: w.title,
  inputSchema: toolInputSchema,
  title: w.title,
  _meta: widgetMeta(w),
  annotations: { destructiveHint: false, openWorldHint: false, readOnlyHint: true },
}));

const resources: Resource[] = widgets.map((w) => ({
  uri: w.templateUri,
  name: w.title,
  description: `${w.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(w),
}));

const resourceTemplates: ResourceTemplate[] = widgets.map((w) => ({
  uriTemplate: w.templateUri,
  name: w.title,
  description: `${w.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(w),
}));

function createPizzazServer(): Server {
  const server = new Server(
    { name: "pizzaz-node", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req: ReadResourceRequest) => {
    const w = widgetsByUri.get(req.params.uri);
    if (!w) throw new Error(`Unknown resource: ${req.params.uri}`);
    return {
      contents: [
        {
          uri: w.templateUri,
          mimeType: "text/html+skybridge",
          text: w.html,
          _meta: widgetMeta(w),
        },
      ],
    };
  });

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (_req: ListResourceTemplatesRequest) => ({ resourceTemplates })
  );

  server.setRequestHandler(ListToolsRequestSchema, async (_req: ListToolsRequest) => ({ tools }));

  // WICHTIG: nur URI angeben, kein Inline-HTML:
  server.setRequestHandler(
    CallToolRequestSchema,
    async (req: CallToolRequest) => {
      const w = widgetsById.get(req.params.name);
      if (!w) throw new Error(`Unknown tool: ${req.params.name}`);
      const args = toolInputParser.parse(req.params.arguments ?? {});
      return {
        content: [{ type: "text", text: w.responseText }],
        structuredContent: { pizzaTopping: args.pizzaTopping },
        _meta: {
          ...widgetMeta(w),
          // Nur Verweis auf die Vorlage:
          "openai/widget": { type: "html", uri: w.templateUri },
        },
      };
    }
  );

  return server;
}

type SessionRecord = { server: Server; transport: SSEServerTransport };
const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";
const MCP_PORT = Number(process.env.MCP_PORT ?? 18000);
const HOST = "0.0.0.0";

async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const server = createPizzazServer();
  const transport = new SSEServerTransport(postPath, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    await server.close();
  };
  transport.onerror = (err) => console.error("SSE transport error", err);

  const hb = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {}
  }, 15000);

  try {
    await server.connect(transport);
  } catch (err) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", err);
    if (!res.headersSent) res.writeHead(500).end("Failed to establish SSE connection");
  } finally {
    clearInterval(hb);
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return void res.writeHead(400).end("Missing sessionId");

  const session = sessions.get(sessionId);
  if (!session) return void res.writeHead(404).end("Unknown session");

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (err) {
    console.error("Failed to process message", err);
    if (!res.headersSent) res.writeHead(500).end("Failed to process message");
  }
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) return void res.writeHead(400).end("Missing URL");
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && (url.pathname === ssePath || url.pathname === postPath)) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Cache-Control": "no-cache, no-transform",
    });
    return void res.end();
  }

  if (req.method === "GET" && url.pathname === ssePath) return void handleSseRequest(res);
  if (req.method === "POST" && url.pathname === postPath)
    return void handlePostMessage(req, res, url);

  res.writeHead(404).end("Not Found");
});

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

httpServer.listen(MCP_PORT, HOST, () => {
  console.log(`Pizzaz MCP server listening on http://${HOST}:${MCP_PORT}`);
  console.log(`  SSE stream: GET http://${HOST}:${MCP_PORT}${ssePath}`);
  console.log(
    `  Message post endpoint: POST http://${HOST}:${MCP_PORT}${postPath}?sessionId=...`
  );
});
