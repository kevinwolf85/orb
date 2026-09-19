import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getStatus, openOrb, reportActivity } from "./client.js";

const activityInput = z.object({
  sessionId: z.string().min(1).max(128), eventId: z.string().min(1).max(128),
  state: z.enum(["idle", "thinking", "working", "waiting", "completed", "error", "disconnected"]),
  operationId: z.string().min(1).max(128).optional(), phase: z.enum(["start", "end"]).optional(), source: z.enum(["mcp"]).optional(),
}).strict();
const activitySchema = {
  type: "object", additionalProperties: false,
  required: ["sessionId", "eventId", "state"],
  properties: {
    sessionId: { type: "string", minLength: 1, maxLength: 128 }, eventId: { type: "string", minLength: 1, maxLength: 128 },
    state: { type: "string", enum: ["idle", "thinking", "working", "waiting", "completed", "error", "disconnected"] },
    operationId: { type: "string", minLength: 1, maxLength: 128 }, phase: { type: "string", enum: ["start", "end"] }, source: { type: "string", enum: ["mcp"] },
  },
};

export async function runMcp(): Promise<void> {
  const server = new Server({ name: "orb", version: "0.1.13" }, { capabilities: { tools: {} } });
  server.setRequestHandler(z.object({ method: z.literal("tools/list") }), async () => ({ tools: [
    { name: "open_orb", description: "Open the local Orb activity display.", inputSchema: { type: "object", properties: {} } },
    { name: "get_orb_status", description: "Read Orb status without starting the service.", inputSchema: { type: "object", properties: {} } },
    { name: "report_activity", description: "Report activity to Orb. Reuse a sessionId for this conversation and a unique eventId for each event. For overlapping tools, use distinct operationIds with phase start/end; an end state describes what happens next (usually thinking). Report completed when the turn finishes. Do not include prompts, code, or tool output.", inputSchema: activitySchema },
  ] }));
  server.setRequestHandler(z.object({ method: z.literal("tools/call"), params: z.object({ name: z.string(), arguments: z.record(z.unknown()).optional() }) }), async (request) => {
    const args = request.params.arguments || {};
    if (request.params.name === "open_orb") {
      await openOrb();
      return text("Opened Orb in your browser.");
    }
    if (request.params.name === "get_orb_status") {
      const status = (await getStatus()) ?? { state: "idle", sessionCount: 0, activeCount: 0, staleCount: 0, updatedAt: 0 };
      return { ...text(JSON.stringify(status)), structuredContent: status };
    }
    if (request.params.name === "report_activity") {
      const parsed = activityInput.safeParse(args);
      if (!parsed.success) return { ...text(JSON.stringify({ accepted: false })), structuredContent: { accepted: false }, isError: true };
      const accepted = await reportActivity({ ...parsed.data, source: "mcp" }, true);
      return { ...text(JSON.stringify({ accepted })), structuredContent: { accepted }, ...(accepted ? {} : { isError: true }) };
    }
    throw new Error("Unknown tool");
  });
  await server.connect(new StdioServerTransport());
}
function text(value: string) { return { content: [{ type: "text" as const, text: value }] }; }
