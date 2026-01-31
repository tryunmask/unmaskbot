import type { MoltbotPluginApi } from "../../src/plugins/types.js";

import { createUnmaskTools } from "./src/tools.js";

const GUARDED_AGENT_IDS = new Set(["scout", "talent", "company"]);
const pendingShouldRespond = new Map<string, number>();
const UNMASK_TOOL_PREFIX = "unmask_";

function shouldGuardAgent(params: { agentId?: string; sessionKey?: string }): boolean {
  const agentId = params.agentId?.trim();
  if (!agentId || !GUARDED_AGENT_IDS.has(agentId)) return false;
  return Boolean(params.sessionKey?.trim());
}

function sanitizeToolParams(params: Record<string, unknown>) {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("phone") ||
      normalizedKey.includes("token") ||
      normalizedKey.includes("name") ||
      normalizedKey.includes("notes")
    ) {
      redacted[key] = "[redacted]";
      continue;
    }
    redacted[key] = value;
  }
  return redacted;
}

export default function register(api: MoltbotPluginApi) {
  api.registerTool((ctx) => createUnmaskTools(api, ctx), { optional: true });

  api.on("before_agent_start", (_event, ctx) => {
    if (!shouldGuardAgent(ctx)) return;
    pendingShouldRespond.set(ctx.sessionKey!, Date.now());
    return {
      prependContext:
        "Before replying or calling any action tools, call unmask_should_respond. If shouldRespond is false, reply with NO_REPLY only.",
    };
  });

  api.on("before_tool_call", (event, ctx) => {
    if (!shouldGuardAgent(ctx)) return;
    if (event.toolName === "unmask_should_respond") return;
    if (!pendingShouldRespond.has(ctx.sessionKey!)) return;
    return {
      block: true,
      blockReason: "Call unmask_should_respond before any other tools.",
    };
  });

  api.on("after_tool_call", (event, ctx) => {
    if (!shouldGuardAgent(ctx)) return;
    if (event.toolName !== "unmask_should_respond") return;
    pendingShouldRespond.delete(ctx.sessionKey!);
  });

  api.on("after_tool_call", (event, ctx) => {
    if (!shouldGuardAgent(ctx)) return;
    if (!event.toolName.startsWith(UNMASK_TOOL_PREFIX)) return;
    const payload = {
      event: "unmask.tool_call",
      toolName: event.toolName,
      agentId: ctx.agentId,
      sessionKey: ctx.sessionKey,
      durationMs: event.durationMs,
      ok: !event.error,
      error: event.error,
      params: sanitizeToolParams(event.params ?? {}),
    };
    api.logger.info(JSON.stringify(payload));
  });

  api.on("agent_end", (_event, ctx) => {
    if (!ctx.sessionKey) return;
    pendingShouldRespond.delete(ctx.sessionKey);
  });
}
