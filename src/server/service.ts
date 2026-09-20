import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityStore, type ActivityEvent } from "./store.js";

export interface ServiceInfo { url: string; token: string; pid: number; }
const MAX_BODY = 8 * 1024;
interface Sharing { server: Server; host: string; port: number; origin: string; token: string; }

export function serviceDirectory(): string {
  return process.env.ORB_HOME || join(process.env.XDG_CACHE_HOME || join(process.env.HOME || tmpdir(), ".cache"), "orb");
}
export function discoveryPath(): string { return join(serviceDirectory(), "service.json"); }

export async function runService(): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const store = new ActivityStore();
  const clients = new Set<ServerResponse>();
  const sharingClients = new Set<ServerResponse>();
  let origin = "";
  let sharing: Sharing | undefined;
  let sharingPending: Promise<unknown> = Promise.resolve();
  const broadcast = () => {
    const data = `event: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`;
    for (const client of [...clients, ...sharingClients]) if (!client.write(data)) client.destroy();
  };
  const server = createServer((req, res) => { void handle(req, res, false).catch(() => reply(res, 400)); });
  async function handle(req: IncomingMessage, res: ServerResponse, lan: boolean): Promise<void> {
    const url = new URL(req.url || "/", "http://localhost");
    const expectedOrigin = lan ? sharing?.origin || "" : origin;
    if (!validHost(req, expectedOrigin) || !validOrigin(req, expectedOrigin)) return reply(res, 403);
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return reply(res, 405);
      return asset(url.pathname, res, req.method === "HEAD");
    }
    if (!authorized(req, lan ? sharing?.token || "" : token)) return reply(res, 401);
    if (req.method === "GET" && url.pathname === "/api/status") return json(res, 200, store.snapshot());
    if (req.method === "GET" && url.pathname === "/api/events") {
      const subscribers = lan ? sharingClients : clients;
      if (subscribers.size >= 100) return reply(res, 503);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      subscribers.add(res); broadcast(); req.on("close", () => subscribers.delete(res)); return;
    }
    if (lan) return reply(res, 404);
    if (req.method === "GET" && url.pathname === "/api/sharing") return json(res, 200, sharingInfo(sharing));
    if (req.method === "POST" && url.pathname === "/api/sharing") {
      const request = await sharingRequest(req).catch(() => null);
      if (!request) return json(res, 400, { error: "Invalid sharing request" });
      const result = await serializeSharing(() => updateSharing(request));
      return json(res, result.status, result.value);
    }
    if (req.method === "POST" && url.pathname === "/api/activity") {
      const parsed = await activity(req).catch(() => null);
      if (!parsed) return reply(res, 400);
      const accepted = store.report(parsed); if (accepted) broadcast();
      return json(res, 200, { accepted });
    }
    reply(res, 404);
  }
  function serializeSharing<T>(action: () => Promise<T>): Promise<T> {
    const result = sharingPending.then(action, action);
    sharingPending = result.then(() => undefined, () => undefined);
    return result;
  }
  async function updateSharing(request: SharingRequest): Promise<{ status: number; value: SharingInfo | { error: string } }> {
    if (!request.enabled) {
      await closeSharing();
      return { status: 200, value: { enabled: false } };
    }
    const host = request.host || firstPrivateIPv4();
    if (!host) return { status: 400, value: { error: "No assigned private IPv4 address available" } };
    const port = request.port || 4318;
    if (sharing) {
      if (sharing.host === host && sharing.port === port) return { status: 200, value: sharingInfo(sharing) };
      return { status: 409, value: { error: "Sharing is already enabled; disable it before changing host or port" } };
    }
    const viewToken = randomBytes(32).toString("base64url");
    const next: Sharing = { server: createServer((req, res) => { void handle(req, res, true).catch(() => reply(res, 400)); }), host, port, origin: `http://${host}:${port}`, token: viewToken };
    try {
      await listen(next.server, port, host);
    } catch {
      next.server.close();
      return { status: 500, value: { error: "Unable to start sharing listener" } };
    }
    sharing = next;
    return { status: 200, value: sharingInfo(next) };
  }
  async function closeSharing(): Promise<void> {
    const active = sharing;
    if (!active) return;
    sharing = undefined;
    for (const client of sharingClients) client.destroy();
    sharingClients.clear();
    active.server.closeAllConnections();
    await new Promise<void>((resolve) => active.server.close(() => resolve()));
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
    await closeSharing();
    try { if (JSON.parse(await readFile(discoveryPath(), "utf8")).pid === process.pid) await unlink(discoveryPath()); } catch { /* already replaced or absent */ }
    server.close();
    server.closeAllConnections();
  };
  process.once("SIGTERM", cleanup); process.once("SIGINT", cleanup);
}

interface SharingRequest { enabled: boolean; host?: string; port?: number; }
type SharingInfo = { enabled: false } | { enabled: true; url: string; };
function sharingInfo(sharing: Sharing | undefined): SharingInfo {
  return sharing ? { enabled: true, url: `${sharing.origin}/#token=${sharing.token}` } : { enabled: false };
}
async function sharingRequest(req: IncomingMessage): Promise<SharingRequest> {
  const value = await requestJson(req);
  if (Object.keys(value).some((key) => key !== "enabled" && key !== "host" && key !== "port")) throw new Error("fields");
  if (typeof value.enabled !== "boolean") throw new Error("enabled");
  if (value.host !== undefined && (typeof value.host !== "string" || !assignedPrivateIPv4(value.host))) throw new Error("host");
  if (value.port !== undefined && (!Number.isInteger(value.port) || typeof value.port !== "number" || value.port < 1024 || value.port > 65535)) throw new Error("port");
  return { enabled: value.enabled, host: value.host as string | undefined, port: value.port as number | undefined };
}
async function requestJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const data = Buffer.from(chunk); size += data.length; if (size > MAX_BODY) throw new Error("large"); chunks.push(data); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("object");
  return value as Record<string, unknown>;
}
function firstPrivateIPv4(): string | undefined {
  return Object.values(networkInterfaces()).flat().find((address) => address && address.family === "IPv4" && privateIPv4(address.address))?.address;
}
function assignedPrivateIPv4(host: string): boolean {
  return privateIPv4(host) && Object.values(networkInterfaces()).flat().some((address) => address?.family === "IPv4" && address.address === host);
}
function privateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(); }); });
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
  const allowed = new Set(["sessionId", "eventId", "state", "operationId", "phase", "source", "parentSessionId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("fields");
  const string = (key: string, optional = false) => { const item = value[key]; if (optional && item === undefined) return undefined; if (typeof item !== "string" || item.length === 0 || item.length > 128) throw new Error(key); return item; };
  const state = string("state")!; const phase = string("phase", true); const source = string("source", true);
  if (!(["idle", "thinking", "working", "waiting", "completed", "error", "disconnected"] as string[]).includes(state)) throw new Error("state");
  if (phase && !["start", "end"].includes(phase)) throw new Error("phase");
  if (source && !["codex", "claude", "mcp"].includes(source)) throw new Error("source");
  const sessionId = string("sessionId")!; const parentSessionId = string("parentSessionId", true);
  if (parentSessionId === sessionId) throw new Error("parentSessionId");
  return { sessionId, eventId: string("eventId")!, state: state as ActivityEvent["state"], operationId: string("operationId", true), phase: phase as ActivityEvent["phase"], source: source as ActivityEvent["source"], parentSessionId };
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
