#!/usr/bin/env node
import { runMcp } from "./mcp.js";
import { openOrb, getStatus, sharing } from "./client.js";
import { reportHook, type HookClient } from "./hooks.js";
import { doctor, remove, setup, type SetupClient } from "./setup.js";
import { runService } from "./service.js";

const client = (value: string | undefined): HookClient | null => value === "codex" || value === "claude" ? value : null;
const stdin = () => new Promise<string>((resolve, reject) => {
  let body = "";
  const timeout = setTimeout(() => { process.stdin.destroy(); resolve(""); }, 500);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    body += chunk;
    if (Buffer.byteLength(body) > 1_048_576) { clearTimeout(timeout); process.stdin.destroy(); reject(new Error("hook input too large")); }
  });
  process.stdin.once("end", () => { clearTimeout(timeout); resolve(body); });
  process.stdin.once("error", reject);
});
const main = async () => {
  const [command = "mcp", ...args] = process.argv.slice(2);
  if (command === "mcp") return runMcp();
  if (command === "serve") return runService();
  if (command === "open") return openOrb();
  if (command === 'share') {
    const action = args[0] === 'stop' || args[0] === 'status' ? args.shift() : 'start';
    const options: { enabled: boolean; host?: string; port?: number } = { enabled: action === 'start' };
    while (args.length) {
      const flag = args.shift(), value = args.shift();
      if (action !== 'start' || !value) throw new Error('Usage: orb share [--host LAN_IP] [--port PORT] | orb share stop | orb share status');
      if (flag === '--host' && options.host === undefined) options.host = value;
      else if (flag === '--port' && options.port === undefined && /^\d+$/.test(value) && Number(value) >= 1024 && Number(value) <= 65535) options.port = Number(value);
      else throw new Error('Usage: orb share [--host LAN_IP] [--port PORT] | orb share stop | orb share status');
    }
    const result = await sharing(action === 'status' ? undefined : options);
    process.stdout.write(result.enabled ? `LAN display (read-only):\n${result.url}\nStop sharing: orb share stop\n` : 'LAN sharing is off.\n');
    return;
  }
  if (command === "report") {
    const name = client(args[args.indexOf("--client") + 1]);
    if (!name) process.exitCode = 2;
    else {
      const deadline = setTimeout(() => process.exit(0), 1_000);
      try { await reportHook(JSON.parse(await stdin()), name); } catch {}
      finally { clearTimeout(deadline); }
    }
    return;
  }
  if (command === "setup" || command === "remove") {
    const name = client(args[0]);
    if (!name) { process.exitCode = 2; return; }
    process.stdout.write(`${await (command === "setup" ? setup(name) : remove(name))}\n`);
    return;
  }
  if (command === "doctor") {
    const lan = await sharing().catch(() => null);
    process.stdout.write(JSON.stringify({ status: await getStatus().catch(() => null), hooks: await doctor(), sharing: lan ? { enabled: lan.enabled } : null }) + "\n");
    return;
  }
  process.exitCode = 2;
};
void main().catch((error: Error) => { process.stderr.write(`orb: ${error.message}\n`); process.exitCode = 1; });
