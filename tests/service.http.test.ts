import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("service reconnects through discovery and rejects unauthenticated or malformed activity", async () => {
  const home = await mkdtemp(join(tmpdir(), "orb-test-"));
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/cli.ts", "serve"], { cwd: process.cwd(), env: { ...process.env, ORB_HOME: home }, stdio: "ignore" });
  const streamAbort = new AbortController();
  const reconnectedAbort = new AbortController();
  try {
    const info = await eventually(async () => JSON.parse(await readFile(join(home, "service.json"), "utf8")) as { url: string; token: string });
    const unauthenticated = await fetch(`${info.url}/api/status`);
    assert.equal(unauthenticated.status, 401);
    const status = await fetch(`${info.url}/api/status`, { headers: { Authorization: `Bearer ${info.token}` } });
    assert.equal(status.status, 200);
    assert.equal(await requestStatus(info.url, "/", { Host: "example.test" }), 403);
    assert.equal((await fetch(`${info.url}/api/status`, { headers: { Authorization: `Bearer ${info.token}`, Origin: "http://127.0.0.1:1" } })).status, 403);
    const page = await fetch(`${info.url}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    const stream = await fetch(`${info.url}/api/events`, { headers: { Authorization: `Bearer ${info.token}` }, signal: streamAbort.signal });
    const reader = stream.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: snapshot/);
    assert.match(first, /"state":"idle"/);
    const malformed = await fetch(`${info.url}/api/activity`, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "a", eventId: "b", state: "working", content: "forbidden" }) });
    assert.equal(malformed.status, 400);
    const reported = await fetch(`${info.url}/api/activity`, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "a", eventId: "b", state: "working" }) });
    assert.equal(reported.status, 200);
    const selfParent = await fetch(`${info.url}/api/activity`, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "self", eventId: "self", state: "working", parentSessionId: "self" }) });
    assert.equal(selfParent.status, 400);
    const reportedChild = await fetch(`${info.url}/api/activity`, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "private-child", eventId: "child", state: "thinking", parentSessionId: "a" }) });
    assert.equal(reportedChild.status, 200);
    const childStatus = await (await fetch(`${info.url}/api/status`, { headers: { Authorization: `Bearer ${info.token}` } })).json() as { sessions: Array<{ isSubagent?: boolean; parentKey?: number }> };
    assert.equal(typeof childStatus.sessions.find((session) => session.isSubagent)?.parentKey, "number");
    assert.equal(JSON.stringify(childStatus).includes("private-child"), false);
    let update = "";
    for (let attempt = 0; attempt < 4 && !update.includes('"state":"working"'); attempt++) {
      update = new TextDecoder().decode((await reader.read()).value);
    }
    assert.match(update, /"state":"working"/);
    streamAbort.abort();
    const reconnected = await fetch(`${info.url}/api/events`, { headers: { Authorization: `Bearer ${info.token}` }, signal: reconnectedAbort.signal });
    assert.match(new TextDecoder().decode((await reconnected.body!.getReader().read()).value), /"state":"working"/);
    // Shutdown must finish even while a browser holds an SSE connection open.
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("daemon did not close SSE clients")), 2_000); timer.unref(); })]);
  } finally {
    streamAbort.abort();
    reconnectedAbort.abort();
    child.kill("SIGTERM");
    await rm(home, { recursive: true, force: true });
  }
});

test("service shares a view-only LAN listener and revokes it on disable", async (t) => {
  const host = Object.values(networkInterfaces()).flat().find((address) => address && address.family === "IPv4" && privateIpv4(address.address))?.address;
  if (!host) return t.skip("no assigned private IPv4 address");
  const home = await mkdtemp(join(tmpdir(), "orb-sharing-test-"));
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/cli.ts", "serve"], { cwd: process.cwd(), env: { ...process.env, ORB_HOME: home }, stdio: "ignore" });
  let occupied: ReturnType<typeof createServer> | undefined;
  try {
    const info = await eventually(async () => JSON.parse(await readFile(join(home, "service.json"), "utf8")) as { url: string; token: string });
    occupied = createServer();
    await new Promise<void>((resolve, reject) => { occupied!.once("error", reject); occupied!.listen(0, host, resolve); });
    const occupiedAddress = occupied.address();
    if (!occupiedAddress || typeof occupiedAddress === "string") throw new Error("no occupied test port");
    const busy = await fetch(`${info.url}/api/sharing`, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, host, port: occupiedAddress.port }) });
    assert.equal(busy.status, 500);
    assert.deepEqual(await (await fetch(`${info.url}/api/sharing`, { headers: { Authorization: `Bearer ${info.token}` } })).json(), { enabled: false });
    await new Promise<void>((resolve, reject) => occupied!.close((error) => error ? reject(error) : resolve()));
    occupied = undefined;
    const port = await unusedPort(host);
    const noHost = await fetch(`${info.url}/api/sharing`, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, host: "127.0.0.1" }) });
    assert.equal(noHost.status, 400);
    const enabled = await fetch(`${info.url}/api/sharing`, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, host, port }) });
    assert.equal(enabled.status, 200);
    const sharing = await enabled.json() as { enabled: boolean; url: string };
    assert.equal(sharing.enabled, true);
    assert.match(sharing.url, new RegExp(`^http://${host.replaceAll(".", "\\.")}:${port}/#token=.+$`));
    const viewToken = new URL(sharing.url).hash.slice("#token=".length);
    assert.equal((await fetch(`http://${host}:${port}/api/status`, { headers: { Authorization: `Bearer ${info.token}` } })).status, 401);
    assert.equal((await fetch(`${info.url}/api/status`, { headers: { Authorization: `Bearer ${viewToken}` } })).status, 401);
    assert.equal((await fetch(`http://${host}:${port}/api/status`, { headers: { Authorization: `Bearer ${viewToken}` } })).status, 200);
    assert.equal((await fetch(`http://${host}:${port}/api/activity`, { method: "POST", headers: { Authorization: `Bearer ${viewToken}`, "Content-Type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(`http://${host}:${port}/api/sharing`, { headers: { Authorization: `Bearer ${viewToken}` } })).status, 404);
    const disabled = await fetch(`${info.url}/api/sharing`, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.deepEqual(await disabled.json(), { enabled: false });
  } finally {
    if (occupied) await new Promise<void>((resolve) => occupied!.close(() => resolve()));
    child.kill("SIGTERM");
    await rm(home, { recursive: true, force: true });
  }
});

async function eventually<T>(read: () => Promise<T>): Promise<T> {
  let error: unknown;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await read(); } catch (reason) { error = reason; await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  throw error;
}

function requestStatus(origin: string, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${origin}${path}`, { headers }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode || 0)); });
    req.on("error", reject); req.end();
  });
}

function privateIpv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function unusedPort(host: string): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, host, resolve); });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("no test port");
  return address.port;
}
