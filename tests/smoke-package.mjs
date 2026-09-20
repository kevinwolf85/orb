import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cli = resolve(process.argv[2] || 'dist/server/cli.js');
const home = await mkdtemp(join(tmpdir(), 'orb-package-'));
const runCli = (args) => promisify(execFile)(process.execPath, [cli, ...args], { env: { ...process.env, ORB_HOME: home } });
const clients = [];
const transports = [];
let daemonPid;
function snapshot(result) {
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  return result.structuredContent || JSON.parse(result.content.find((item) => item.type === 'text').text);
}
async function call(client, name, args = {}) {
  return snapshot(await client.callTool({ name, arguments: args }));
}
try {
  await Promise.all(['one', 'two'].map(async (name) => {
    const client = new Client({ name: `orb-smoke-${name}`, version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [cli, 'mcp'],
      env: { ...process.env, ORB_HOME: home }, stderr: 'pipe',
    });
    clients.push(client);
    transports.push(transport);
    await client.connect(transport);
    const listed = (await client.listTools()).tools;
    assert.deepEqual(listed.map((tool) => tool.name).sort(), ['get_orb_status', 'open_orb', 'report_activity']);
    const schema = listed.find((tool) => tool.name === 'report_activity').inputSchema;
    assert.deepEqual(schema.required, ['sessionId', 'eventId', 'state']);
    assert.equal(schema.properties.sessionId.maxLength, 128);
    assert.equal(schema.properties.parentSessionId.maxLength, 128);
    assert.ok(schema.properties.state.enum.includes('working'));
  }));
  const [a, b] = clients;
  assert.match((await runCli(['share', 'status'])).stdout, /sharing is off/);
  assert.match((await runCli(['share', 'stop'])).stdout, /sharing is off/);
  await assert.rejects(runCli(['share', '--port', '0']), /Usage:/);
  await assert.rejects(runCli(['share', '--host']), /Usage:/);
  await Promise.all([
    call(a, 'report_activity', { sessionId: 'smoke-a', eventId: 'a1', state: 'working', operationId: 'op-a', phase: 'start' }),
    call(b, 'report_activity', { sessionId: 'smoke-b', parentSessionId: 'smoke-a', eventId: 'b1', state: 'working', operationId: 'op-b', phase: 'start' }),
  ]);
  const combined = await call(a, 'get_orb_status');
  assert.equal(combined.state, 'working');
  assert.equal(combined.sessionCount, 2);
  assert.equal(combined.activeCount, 2);
  const child = combined.sessions.find((session) => session.isSubagent);
  assert.ok(child);
  assert.ok(combined.sessions.some((session) => session.key === child.parentKey));
  assert.equal(JSON.stringify(combined).includes('smoke-a'), false);
  await call(a, 'report_activity', { sessionId: 'smoke-a', eventId: 'a2', state: 'completed' });
  assert.equal((await call(a, 'get_orb_status')).state, 'working');
  await call(b, 'report_activity', { sessionId: 'smoke-b', eventId: 'b2', state: 'waiting' });
  assert.equal((await call(a, 'get_orb_status')).state, 'waiting');
  await call(b, 'report_activity', { sessionId: 'smoke-b', eventId: 'b3', state: 'completed' });
  assert.equal((await call(a, 'get_orb_status')).state, 'completed');
  await call(b, 'report_activity', { sessionId: 'smoke-b', eventId: 'b2', state: 'waiting' });
  assert.equal((await call(a, 'get_orb_status')).state, 'completed');
  const invalid = await a.callTool({ name: 'report_activity', arguments: { sessionId: 'smoke-a', eventId: 'bad', state: 'arbitrary' } });
  assert.equal(invalid.isError, true);
  console.log('PASS: packed CLI exposes three MCP tools; two concurrent clients share parent linkage, aggregation, priority, completion, deduplication, and validation.');
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  // Daemon discovery contains a PID so this isolated smoke service can be cleaned up.
  try {
    const { readdir } = await import('node:fs/promises');
    for (const name of await readdir(home)) {
      if (!name.endsWith('.json')) continue;
      const entry = JSON.parse(await readFile(join(home, name), 'utf8'));
      if (Number.isInteger(entry.pid)) daemonPid = entry.pid;
    }
    if (daemonPid) process.kill(daemonPid, 'SIGTERM');
  } catch { /* already exited */ }
  await rm(home, { recursive: true, force: true });
}
