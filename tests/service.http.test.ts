import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
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
