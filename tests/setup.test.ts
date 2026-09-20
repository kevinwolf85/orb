import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remove, setup } from "../src/server/setup.js";

test("setup preserves unrelated hooks and removal only removes Orb", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orb-"));
  const file = join(dir, "hooks.json");
  await writeFile(file, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "keep-me" }] }] } }));
  const options = { configFile: file, nodePath: "/node", cliPath: "/orb-cli" };
  await setup("codex", options);
  await setup("codex", options);
  let config = JSON.parse(await readFile(file, "utf8"));
  assert.equal(config.hooks.PreToolUse[0].hooks[0].command, "keep-me");
  assert.equal(config.hooks.PreToolUse.filter((group: { hooks: unknown[] }) => group.hooks.some((entry: { command: string }) => entry.command.includes("report --client codex"))).length, 1);
  assert.equal(config.hooks.PreToolUse.at(-1).hooks[0].async, undefined);
  assert.equal(config.hooks.PostToolUseFailure, undefined);
  await remove("codex", options);
  config = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(config.hooks.PreToolUse, [{ matcher: "Bash", hooks: [{ type: "command", command: "keep-me" }] }]);
});

test("setup rejects malformed hooks without altering the configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orb-"));
  const file = join(dir, "hooks.json");
  const malformed = '{"hooks":[]}';
  await writeFile(file, malformed);
  await assert.rejects(setup("codex", { configFile: file }), /hooks must be an object/);
  assert.equal(await readFile(file, "utf8"), malformed);
});

test("clients install documented lifecycle differences", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orb-"));
  const codex = join(dir, "codex.json");
  const claude = join(dir, "claude.json");
  await setup("codex", { configFile: codex, nodePath: "/node", cliPath: "/orb-cli" });
  await setup("claude", { configFile: claude, nodePath: "/node", cliPath: "/orb-cli" });
  assert.equal(JSON.parse(await readFile(codex, "utf8")).hooks.PostToolUseFailure, undefined);
  assert.equal(JSON.parse(await readFile(claude, "utf8")).hooks.PostToolUseFailure.length, 1);
  for (const file of [codex, claude]) {
    const hooks = JSON.parse(await readFile(file, "utf8")).hooks;
    assert.equal(hooks.SubagentStart.length, 1);
    assert.equal(hooks.SubagentStop.length, 1);
  }
});
