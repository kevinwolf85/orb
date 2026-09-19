#!/usr/bin/env node
import { runMcp } from "./mcp.js";
import { openOrb, getStatus } from "./client.js";
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
  if (command === "doctor") { process.stdout.write(JSON.stringify({ status: await getStatus().catch(() => null), hooks: await doctor() }) + "\n"); return; }
  process.exitCode = 2;
};
void main().catch((error: Error) => { process.stderr.write(`orb: ${error.message}\n`); process.exitCode = 1; });
