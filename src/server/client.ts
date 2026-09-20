import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoveryPath, serviceDirectory, type ServiceInfo } from "./service.js";
import type { ActivityEvent, Snapshot } from "./store.js";

export async function getService(): Promise<{ url: string; token: string } | null> {
  const info = await readInfo();
  if (!info || !(await alive(info))) return null;
  return { url: info.url, token: info.token };
}

export async function ensureService(): Promise<{ url: string; token: string }> {
  const existing = await getService(); if (existing) return existing;
  const lock = join(serviceDirectory(), "start.lock");
  await mkdir(serviceDirectory(), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 });
      try {
        await writeFile(join(lock, "owner"), `${process.pid}\n${Date.now()}`, { mode: 0o600 });
        const again = await getService(); if (again) return again;
        const child = spawn(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "serve"], { detached: true, stdio: "ignore" });
        child.on("error", () => undefined);
        child.unref();
        const started = await waitForService(); if (started) return started;
      } finally { await rm(lock, { recursive: true, force: true }); }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockInfo = await stat(lock).catch(() => null);
      if (lockInfo && Date.now() - lockInfo.mtimeMs > 10_000) await rm(lock, { recursive: true, force: true }).catch(() => undefined);
    }
    const found = await waitForService(); if (found) return found;
  }
  throw new Error("Orb service did not start");
}

export async function reportActivity(event: ActivityEvent, startService = false): Promise<boolean> {
  const service = startService ? await ensureService() : await getService();
  if (!service) return false;
  const response = await fetch(`${service.url}/api/activity`, {
    method: "POST", headers: { Authorization: `Bearer ${service.token}`, "Content-Type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(2_000),
  }).catch(() => null);
  return response?.ok === true;
}

export async function getStatus(): Promise<Snapshot | null> {
  const service = await getService(); if (!service) return null;
  const response = await fetch(`${service.url}/api/status`, { headers: { Authorization: `Bearer ${service.token}` }, signal: AbortSignal.timeout(2_000) }).catch(() => null);
  return response?.ok ? await response.json() as Snapshot : null;
}

export type SharingStatus = { enabled: false } | { enabled: true; url: string };
export async function sharing(options?: { enabled: boolean; host?: string; port?: number }): Promise<SharingStatus> {
  const service = options?.enabled ? await ensureService() : await getService();
  if (!service) return { enabled: false };
  const response = await fetch(`${service.url}/api/sharing`, {
    method: options ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${service.token}`, ...(options ? { 'Content-Type': 'application/json' } : {}) },
    ...(options ? { body: JSON.stringify(options) } : {}),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('Restart the Orb service to enable LAN sharing support.');
    const detail = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(detail.error || `LAN sharing request failed (${response.status}).`);
  }
  return await response.json() as SharingStatus;
}

export async function openOrb(): Promise<string> {
  const service = await ensureService();
  const target = `${service.url}/#token=${encodeURIComponent(service.token)}`;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    // Some Linux openers remain attached to the browser they launch.
    const timer = setTimeout(() => { child.unref(); resolve(); }, 3_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Unable to launch your browser; install a default browser or xdg-open.")); });
    child.once("exit", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("The browser opener exited unsuccessfully.")); });
  });
  return service.url;
}

async function readInfo(): Promise<ServiceInfo | null> {
  try {
    const value = JSON.parse(await readFile(discoveryPath(), "utf8")) as ServiceInfo;
    if (!value || typeof value.url !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.url) || typeof value.token !== "string" || value.token.length < 20 || !Number.isInteger(value.pid)) throw new Error("invalid");
    return value;
  } catch { return null; }
}
async function alive(info: ServiceInfo): Promise<boolean> {
  try {
    process.kill(info.pid, 0);
    const response = await fetch(`${info.url}/api/status`, { headers: { Authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    await rm(discoveryPath(), { force: true }).catch(() => undefined);
    return false;
  }
}
async function waitForService(): Promise<{ url: string; token: string } | null> {
  for (let i = 0; i < 20; i++) { await new Promise((resolve) => setTimeout(resolve, 50)); const service = await getService(); if (service) return service; }
  return null;
}

export function activity(sessionId: string, state: ActivityEvent["state"], extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return { sessionId, state, eventId: randomUUID(), ...extra };
}
