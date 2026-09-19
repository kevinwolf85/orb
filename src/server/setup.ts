import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export type SetupClient = "codex" | "claude";
export type SetupOptions = { configFile?: string; nodePath?: string; cliPath?: string };

const quote = (value: string) => `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
const own = (value: unknown, client: SetupClient) => typeof value === "object" && value !== null &&
  typeof (value as { command?: unknown }).command === "string" &&
  (value as { command: string }).command.includes("report --client " + client + " # orb");

export function configPath(client: SetupClient): string {
  return join(homedir(), client === "codex" ? ".codex/hooks.json" : ".claude/settings.json");
}

function command(client: SetupClient, options: SetupOptions): string {
  return `${quote(options.nodePath ?? process.execPath)} ${quote(options.cliPath ?? fileURLToPath(import.meta.url).replace(/setup\.[cm]?js$/, "cli.js"))} report --client ${client} # orb`;
}

function hook(command: string) { return { type: "command", command, timeout: 3 }; }
const events = (client: SetupClient) => client === "codex"
  ? ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop", "Interrupt"]
  : ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Stop", "StopFailure", "Interrupt"];

async function load(path: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("configuration must be an object");
    return value as Record<string, unknown>;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error(`Invalid JSON in ${path}: ${(error as Error).message}`); }
}

function validate(config: Record<string, unknown>) {
  if (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks))) throw new Error("hooks must be an object");
  for (const groups of Object.values(config.hooks ?? {})) {
    if (!Array.isArray(groups) || groups.some((group) => !group || typeof group !== "object" || Array.isArray(group) || ("hooks" in group && !Array.isArray((group as { hooks?: unknown }).hooks)))) throw new Error("hook groups must be objects with hooks arrays");
  }
}

async function exists(path: string) { try { await stat(path); return true; } catch { return false; } }
async function save(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.orb-${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, path);
}

export async function setup(client: SetupClient, options: SetupOptions = {}): Promise<string> {
  const path = options.configFile ?? configPath(client);
  const config = await load(path);
  validate(config);
  const hadFile = await exists(path);
  const backup = path + ".orb.bak";
  if (hadFile && !(await exists(backup))) await cp(path, backup);
  const hooks = (config.hooks && typeof config.hooks === "object" ? config.hooks : {}) as Record<string, unknown>;
  config.hooks = hooks;
  for (const event of events(client)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] as Array<Record<string, unknown>> : [];
    const withoutOurs = groups.map((group) => ({ ...group, hooks: Array.isArray(group.hooks) ? group.hooks.filter((entry) => !own(entry, client)) : [] }))
      .filter((group) => (group.hooks as unknown[]).length > 0);
    withoutOurs.push({ hooks: [hook(command(client, options))] });
    hooks[event] = withoutOurs;
  }
  await save(path, config);
  return path;
}

export async function remove(client: SetupClient, options: SetupOptions = {}): Promise<string> {
  const path = options.configFile ?? configPath(client);
  const config = await load(path);
  validate(config);
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== "object") return path;
  for (const event of events(client)) {
    const groups = (hooks as Record<string, unknown>)[event];
    if (!Array.isArray(groups)) continue;
    const kept = groups.map((group) => {
      if (!group || typeof group !== "object") return group;
      const entries = (group as { hooks?: unknown }).hooks;
      return Array.isArray(entries) ? { ...group as Record<string, unknown>, hooks: entries.filter((entry) => !own(entry, client)) } : group;
    }).filter((group) => !group || typeof group !== "object" || !Array.isArray((group as { hooks?: unknown[] }).hooks) || (group as { hooks: unknown[] }).hooks.length > 0);
    if (kept.length) (hooks as Record<string, unknown>)[event] = kept;
    else delete (hooks as Record<string, unknown>)[event];
  }
  await save(path, config);
  return path;
}

export async function doctor(client?: SetupClient, options: SetupOptions = {}) {
  const clients: SetupClient[] = client ? [client] : ["codex", "claude"];
  return Promise.all(clients.map(async (name) => ({ client: name, path: options.configFile ?? configPath(name), installed: (await exists(options.configFile ?? configPath(name))) && JSON.stringify(await load(options.configFile ?? configPath(name))).includes("report --client " + name + " # orb") })));
}
