import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityStore, type ActivityEvent } from "./store.js";

export interface ServiceInfo { url: string; token: string; pid: number; }
const MAX_BODY = 8 * 1024;

export function serviceDirectory(): string {
  return process.env.ORB_HOME || join(process.env.XDG_CACHE_HOME || join(process.env.HOME || tmpdir(), ".cache"), "orb");
}
export function discoveryPath(): string { return join(serviceDirectory(), "service.json"); }

export async function runService(): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const store = new ActivityStore();
  const clients = new Set<ServerResponse>();
  let origin = "";
  const broadcast = () => {
    const data = `event: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`;
    for (const client of clients) if (!client.write(data)) client.destroy();
  };
  const server = createServer((req, res) => { void handle(req, res).catch(() => reply(res, 400)); });
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", "http://localhost");
    if (!validHost(req, origin) || !validOrigin(req, origin)) return reply(res, 403);
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return reply(res, 405);
      return asset(url.pathname, res, req.method === "HEAD");
    }
    if (!authorized(req, token)) return reply(res, 401);
    if (req.method === "GET" && url.pathname === "/api/status") return json(res, 200, store.snapshot());
    if (req.method === "GET" && url.pathname === "/api/events") {
      if (clients.size >= 100) return reply(res, 503);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      clients.add(res); broadcast(); req.on("close", () => clients.delete(res)); return;
    }
    if (req.method === "POST" && url.pathname === "/api/activity") {
      const parsed = await activity(req).catch(() => null);
      if (!parsed) return reply(res, 400);
      const accepted = store.report(parsed); if (accepted) broadcast();
      return json(res, 200, { accepted });
    }
    reply(res, 404);
  }
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine Orb service address");
  const info: ServiceInfo = { url: `http://127.0.0.1:${address.port}`, token, pid: process.pid };
  origin = info.url;
  await writeDiscovery(info);
  const tick = setInterval(broadcast, 1_000); tick.unref();
  const cleanup = async () => {
    clearInterval(tick);
    for (const client of clients) client.destroy();
    try { if (JSON.parse(await readFile(discoveryPath(), "utf8")).pid === process.pid) await unlink(discoveryPath()); } catch { /* already replaced or absent */ }
    server.close();
    server.closeAllConnections();
  };
  process.once("SIGTERM", cleanup); process.once("SIGINT", cleanup);
}

async function writeDiscovery(info: ServiceInfo): Promise<void> {
  await mkdir(dirname(discoveryPath()), { recursive: true, mode: 0o700 });
  const temp = `${discoveryPath()}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await writeFile(temp, JSON.stringify(info), { mode: 0o600 });
  await rename(temp, discoveryPath());
}
function authorized(req: IncomingMessage, token: string): boolean {
  const value = req.headers.authorization;
  const candidate = typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : "";
  const a = Buffer.from(candidate), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
function validHost(req: IncomingMessage, origin: string): boolean {
  if (!origin) return false;
  return req.headers.host === new URL(origin).host;
}
function validOrigin(req: IncomingMessage, expectedOrigin: string): boolean {
  const requestOrigin = req.headers.origin; if (!requestOrigin) return true;
  return requestOrigin === expectedOrigin;
}
async function activity(req: IncomingMessage): Promise<ActivityEvent> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const data = Buffer.from(chunk); size += data.length; if (size > MAX_BODY) throw new Error("large"); chunks.push(data); }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  const allowed = new Set(["sessionId", "eventId", "state", "operationId", "phase", "source"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("fields");
  const string = (key: string, optional = false) => { const item = value[key]; if (optional && item === undefined) return undefined; if (typeof item !== "string" || item.length === 0 || item.length > 128) throw new Error(key); return item; };
  const state = string("state")!; const phase = string("phase", true); const source = string("source", true);
  if (!(["idle", "thinking", "working", "waiting", "completed", "error", "disconnected"] as string[]).includes(state)) throw new Error("state");
  if (phase && !["start", "end"].includes(phase)) throw new Error("phase");
  if (source && !["codex", "claude", "mcp"].includes(source)) throw new Error("source");
  return { sessionId: string("sessionId")!, eventId: string("eventId")!, state: state as ActivityEvent["state"], operationId: string("operationId", true), phase: phase as ActivityEvent["phase"], source: source as ActivityEvent["source"] };
}
function reply(res: ServerResponse, status: number) { res.writeHead(status); res.end(); }
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); }
async function asset(pathname: string, res: ServerResponse, head = false): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!relative || normalize(relative).startsWith("..")) return reply(res, 404);
  const runtime = dirname(fileURLToPath(import.meta.url));
  const files = [join(runtime, "../web", relative), join(runtime, "../../web", relative)];
  try {
    let body: Buffer | undefined; let file = files[0];
    for (const candidate of files) try { body = await readFile(candidate); file = candidate; break; } catch { /* try source layout */ }
    if (!body) return reply(res, 404);
    const type = ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" } as Record<string, string>)[extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": extname(file) === ".html" ? "no-store" : "public, max-age=3600" }); res.end(head ? undefined : body);
  } catch { reply(res, 404); }
}
