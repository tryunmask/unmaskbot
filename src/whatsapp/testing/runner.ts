import { loadConfig } from "../../config/config.js";
import { callGateway, randomIdempotencyKey } from "../../gateway/call.js";
import type { RuntimeEnv } from "../../runtime.js";
import { listAgentIds } from "../../agents/agent-scope.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { DEFAULT_CHAT_CHANNEL } from "../../channels/registry.js";
import { normalizeWhatsAppTarget } from "../normalize.js";
import { resolveSessionKeyForRequest } from "../../commands/agent/session.js";
import { formatCliCommand } from "../../cli/command-format.js";
import {
  getWhatsAppTestScenario,
  listWhatsAppTestScenarios,
  type Scenario,
  type ScenarioRole,
} from "./scenarios.js";

type AgentTargets = Record<ScenarioRole, string>;
type AgentIds = Record<ScenarioRole, string>;
type AgentSessionIds = Partial<Record<ScenarioRole, string>>;

type GatewayAgentResponse = {
  runId?: string;
  status?: string;
  summary?: string;
  result?: {
    payloads?: Array<{
      text?: string;
      mediaUrl?: string | null;
      mediaUrls?: string[];
    }>;
    meta?: unknown;
  };
};

type RunScenarioOptions = {
  scenarioId: string;
  channel?: string;
  accountId?: string;
  agentIds: AgentIds;
  sessionIds?: AgentSessionIds;
  targets: AgentTargets;
  allowTargets?: string[];
  allowAnyTarget?: boolean;
  tag?: string;
  personaName?: string;
  personaContact?: string;
  thinking?: string;
  timeoutSeconds?: number;
  deliver?: boolean;
  waitMs?: number;
  runtime: RuntimeEnv;
};

type StepResult = {
  stepId: string;
  from: ScenarioRole;
  to: ScenarioRole;
  prompt: string;
  outputText: string;
  delivered: boolean;
};

const DEFAULT_PERSONA_NAME = "Test Persona";
const DEFAULT_PERSONA_CONTACT = "test.persona@example.com | +15555550123";

const buildTemplateVars = (params: {
  personaName?: string;
  personaContact?: string;
  tag?: string;
  lastMessages: Partial<Record<ScenarioRole, string>>;
}) => ({
  persona_name: params.personaName ?? DEFAULT_PERSONA_NAME,
  persona_contact: params.personaContact ?? DEFAULT_PERSONA_CONTACT,
  tag: params.tag ?? "",
  last_persona: params.lastMessages.persona ?? "",
  last_scout: params.lastMessages.scout ?? "",
  last_talent: params.lastMessages.talent ?? "",
  last_company: params.lastMessages.company ?? "",
});

const renderTemplate = (value: string, vars: Record<string, string>) => {
  return value.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, key: string) => {
    const replacement = vars[key];
    return replacement === undefined ? "" : replacement;
  });
};

function ensureAllowedTargets(params: {
  targets: AgentTargets;
  allowTargets?: string[];
  allowAnyTarget?: boolean;
}) {
  if (params.allowAnyTarget) return;
  const allowlist = (params.allowTargets ?? [])
    .map((entry) => normalizeWhatsAppTarget(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (allowlist.length === 0) {
    throw new Error(
      `Refusing to send without an allowlist. Provide --allow-target (repeatable) or pass --allow-any-target.`,
    );
  }
  const normalizedTargets = Object.entries(params.targets).map(([role, target]) => {
    const normalized = normalizeWhatsAppTarget(target);
    if (!normalized) {
      throw new Error(`Invalid WhatsApp target for ${role}: ${target}`);
    }
    return { role, normalized };
  });
  for (const entry of normalizedTargets) {
    if (!allowlist.includes(entry.normalized)) {
      throw new Error(
        `Target ${entry.role}=${entry.normalized} not in allowlist. Update --allow-target or pass --allow-any-target.`,
      );
    }
  }
}

const resolveScenario = (scenarioId: string): Scenario => {
  if (scenarioId === "list") {
    const scenarios = listWhatsAppTestScenarios();
    throw new Error(
      `Pass a scenario id instead of "list". Known scenarios: ${scenarios.map((s) => s.id).join(", ")}`,
    );
  }
  const scenario = getWhatsAppTestScenario(scenarioId);
  if (!scenario) {
    const available = listWhatsAppTestScenarios()
      .map((entry) => entry.id)
      .join(", ");
    throw new Error(`Unknown scenario "${scenarioId}". Available: ${available}`);
  }
  return scenario;
};

const normalizeAgent = (raw: string) => normalizeAgentId(raw.trim());

const assertAgentIds = (agentIds: AgentIds) => {
  const cfg = loadConfig();
  const knownAgents = listAgentIds(cfg);
  const ensureKnown = (role: ScenarioRole, rawId: string) => {
    const normalized = normalizeAgent(rawId);
    if (!normalized || !knownAgents.includes(normalized)) {
      throw new Error(
        `Unknown ${role} agent id "${rawId}". Use "${formatCliCommand("moltbot agents list")}".`,
      );
    }
  };
  ensureKnown("persona", agentIds.persona);
  ensureKnown("scout", agentIds.scout);
  ensureKnown("talent", agentIds.talent);
  ensureKnown("company", agentIds.company);
};

const resolveTargetForStep = (
  step: { from: ScenarioRole; to: ScenarioRole },
  targets: AgentTargets,
) => (step.from === "persona" ? targets[step.to] : targets.persona);

const coerceTimeoutSeconds = (value?: number): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const cfg = loadConfig();
  return cfg.agents?.defaults?.timeoutSeconds ?? 600;
};

const buildTagHint = (tag?: string) => {
  if (!tag) return "";
  return `\n\nInclude this tag at the top of your message: ${tag}`;
};

async function runAgentTurn(params: {
  runtime: RuntimeEnv;
  agentId: string;
  to: string;
  channel: string;
  accountId?: string;
  message: string;
  deliver: boolean;
  sessionId?: string;
  thinking?: string;
  timeoutSeconds: number;
}): Promise<GatewayAgentResponse> {
  const cfg = loadConfig();
  const sessionKey = resolveSessionKeyForRequest({
    cfg,
    to: params.to,
    sessionId: params.sessionId,
    agentId: params.agentId,
  }).sessionKey;
  const timeoutMs = Math.max(10_000, (params.timeoutSeconds + 30) * 1000);
  return await callGateway<GatewayAgentResponse>({
    method: "agent",
    params: {
      message: params.message,
      agentId: params.agentId,
      to: params.to,
      sessionId: params.sessionId,
      sessionKey,
      deliver: params.deliver,
      channel: params.channel,
      replyChannel: params.channel,
      replyTo: params.deliver ? params.to : undefined,
      replyAccountId: params.accountId,
      thinking: params.thinking,
      timeout: params.timeoutSeconds,
      idempotencyKey: randomIdempotencyKey(),
    },
    expectFinal: true,
    timeoutMs,
  });
}

const extractAgentText = (response: GatewayAgentResponse): string => {
  const payloads = response.result?.payloads ?? [];
  const texts = payloads
    .map((payload) => (typeof payload.text === "string" ? payload.text.trim() : ""))
    .filter(Boolean);
  if (texts.length > 0) return texts.join("\n");
  const summary = typeof response.summary === "string" ? response.summary.trim() : "";
  return summary || "(no text response)";
};

export async function runWhatsAppTestScenario(options: RunScenarioOptions) {
  const scenario = resolveScenario(options.scenarioId);
  const channel = options.channel?.trim() || DEFAULT_CHAT_CHANNEL;
  const deliver = options.deliver !== false;
  const timeoutSeconds = coerceTimeoutSeconds(options.timeoutSeconds);
  const lastMessages: Partial<Record<ScenarioRole, string>> = {};
  const results: StepResult[] = [];
  const tagHint = buildTagHint(options.tag);

  assertAgentIds(options.agentIds);
  ensureAllowedTargets({
    targets: options.targets,
    allowTargets: options.allowTargets,
    allowAnyTarget: options.allowAnyTarget,
  });

  for (const step of scenario.steps) {
    const target = resolveTargetForStep(step, options.targets);
    const templateVars = buildTemplateVars({
      personaName: options.personaName,
      personaContact: options.personaContact,
      tag: options.tag,
      lastMessages,
    });
    const prompt = `${renderTemplate(step.prompt, templateVars)}${tagHint}`.trim();

    options.runtime.log(
      `→ ${step.from} → ${step.to}: ${prompt.replace(/\s+/g, " ").slice(0, 120)}...`,
    );

    const response = await runAgentTurn({
      runtime: options.runtime,
      agentId: normalizeAgent(options.agentIds[step.from]),
      to: target,
      channel,
      accountId: options.accountId,
      message: prompt,
      deliver,
      sessionId: options.sessionIds?.[step.from],
      thinking: options.thinking,
      timeoutSeconds,
    });

    const outputText = extractAgentText(response);
    lastMessages[step.from] = outputText;
    results.push({
      stepId: step.id,
      from: step.from,
      to: step.to,
      prompt,
      outputText,
      delivered: deliver,
    });

    options.runtime.log(`✓ ${step.from} reply (${outputText.length} chars)`);

    if (options.waitMs && options.waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.waitMs));
    }
  }

  return {
    scenario,
    results,
  };
}
