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
type AgentIds = Record<Exclude<ScenarioRole, "persona">, string>;
type AgentAccountIds = Partial<Record<ScenarioRole, string>>;

type SessionsPreviewItem = {
  role?: string;
  text?: string;
};

type SessionsPreviewEntry = {
  key: string;
  status: "ok" | "empty" | "missing" | "error";
  items: SessionsPreviewItem[];
};

type SessionsPreviewResult = {
  ts: number;
  previews: SessionsPreviewEntry[];
};

type GatewayAgentResponse = {
  runId?: string;
  status?: string;
  summary?: string;
  result?: {
    payloads?: Array<{
      text?: string;
    }>;
  };
};

type RunScenarioOptions = {
  scenarioId: string;
  channel?: string;
  accountId?: string;
  accountIds?: AgentAccountIds;
  agentIds: AgentIds;
  personaAgentId?: string;
  scoutPersonaAgentId?: string;
  talentPersonaAgentId?: string;
  companyPersonaAgentId?: string;
  targets: AgentTargets;
  allowTargets?: string[];
  allowAnyTarget?: boolean;
  tag?: string;
  personaName?: string;
  personaContact?: string;
  personaLinkedIn?: string;
  introCompany?: string;
  candidateName?: string;
  candidatePhone?: string;
  candidateEmail?: string;
  candidateLinkedIn?: string;
  companyName?: string;
  companyUserName?: string;
  timeoutSeconds?: number;
  responseTimeoutSeconds?: number;
  followupTimeoutSeconds?: number;
  followupMaxTurns?: number;
  pollIntervalMs?: number;
  deliver?: boolean;
  waitMs?: number;
  resetBefore?: boolean;
  resetMessage?: string;
  splitMessages?: boolean;
  splitMaxChars?: number;
  splitDelayMs?: number;
  runtime: RuntimeEnv;
};

type StepResult = {
  stepId: string;
  to: Exclude<ScenarioRole, "persona">;
  prompt: string;
  replyText: string;
  delivered: boolean;
};

const DEFAULT_PERSONA_NAME = "Henry Allen";
const DEFAULT_PERSONA_CONTACT = "";
const DEFAULT_INTRO_COMPANY = "Anthropic";
const DEFAULT_CANDIDATE_NAME = "Henry Allen";
const DEFAULT_CANDIDATE_PHONE = "+447484718110";
const DEFAULT_CANDIDATE_EMAIL = "henry.allen@example.com";
const DEFAULT_CANDIDATE_LINKEDIN = "https://www.linkedin.com/in/henry-allen";
const DEFAULT_COMPANY_NAME = "Anthropic";
const DEFAULT_COMPANY_USER_NAME = "Lewis";

const maskTarget = (value: string) => {
  const trimmed = value.trim();
  const suffix = trimmed.slice(-4);
  return `***${suffix}`;
};

const buildTemplateVars = (params: {
  personaName?: string;
  personaContact?: string;
  personaLinkedIn?: string;
  introCompany?: string;
  candidateName?: string;
  candidatePhone?: string;
  candidateEmail?: string;
  candidateLinkedIn?: string;
  companyName?: string;
  companyUserName?: string;
  tag?: string;
  lastMessages: Partial<Record<ScenarioRole, string>>;
}) => ({
  persona_name: params.personaName ?? DEFAULT_PERSONA_NAME,
  persona_contact: params.personaContact ?? DEFAULT_PERSONA_CONTACT,
  persona_linkedin: params.personaLinkedIn ?? "",
  intro_company: params.introCompany ?? DEFAULT_INTRO_COMPANY,
  candidate_name: params.candidateName ?? DEFAULT_CANDIDATE_NAME,
  candidate_phone: params.candidatePhone ?? DEFAULT_CANDIDATE_PHONE,
  candidate_email: params.candidateEmail ?? DEFAULT_CANDIDATE_EMAIL,
  candidate_linkedin: params.candidateLinkedIn ?? DEFAULT_CANDIDATE_LINKEDIN,
  company_name: params.companyName ?? DEFAULT_COMPANY_NAME,
  company_user_name: params.companyUserName ?? DEFAULT_COMPANY_USER_NAME,
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

const ensureDistinctTargets = (targets: AgentTargets) => {
  const normalized = Object.entries(targets).map(([role, target]) => {
    const value = normalizeWhatsAppTarget(target);
    if (!value) {
      throw new Error(`Invalid WhatsApp target for ${role}: ${target}`);
    }
    return { role, value };
  });
  const seen = new Map<string, string>();
  for (const entry of normalized) {
    const prior = seen.get(entry.value);
    if (prior) {
      throw new Error(
        `Target collision: ${entry.role} and ${prior} both resolve to ${entry.value}. ` +
          "Ensure each role uses a distinct WhatsApp number.",
      );
    }
    seen.set(entry.value, entry.role);
  }
};

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
  const ensureKnown = (role: Exclude<ScenarioRole, "persona">, rawId: string) => {
    const normalized = normalizeAgent(rawId);
    if (!normalized || !knownAgents.includes(normalized)) {
      throw new Error(
        `Unknown ${role} agent id "${rawId}". Use "${formatCliCommand("moltbot agents list")}".`,
      );
    }
  };
  ensureKnown("scout", agentIds.scout);
  ensureKnown("talent", agentIds.talent);
  ensureKnown("company", agentIds.company);
};

const coerceTimeoutSeconds = (value?: number): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const cfg = loadConfig();
  return cfg.agents?.defaults?.timeoutSeconds ?? 600;
};

const buildTagHint = (tag?: string) => {
  if (!tag) return "";
  return `\n\nA run tag will be added automatically. Do not include your own tag.`;
};

const buildTagPrefix = (tag?: string, role?: Exclude<ScenarioRole, "persona">) => {
  if (!tag) return "";
  const roleLabel = role ? ` ${role}` : "";
  return `[${tag}${roleLabel}] `;
};

const applyMessagePrefix = (message: string, prefix: string) => {
  if (!prefix) return message;
  return `${prefix}${message}`.trim();
};

async function draftPersonaMessage(params: {
  message: string;
  agentId: string;
  sessionKey: string;
  channel: string;
  timeoutSeconds: number;
}): Promise<string | null> {
  const response = await callGateway<GatewayAgentResponse>({
    method: "agent",
    params: {
      message: params.message,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      deliver: false,
      channel: params.channel,
      timeout: params.timeoutSeconds,
      idempotencyKey: randomIdempotencyKey(),
    },
    expectFinal: true,
    timeoutMs: Math.max(10_000, (params.timeoutSeconds + 30) * 1000),
  });
  const payloads = response?.result?.payloads ?? [];
  const text = payloads.find((payload) => payload.text)?.text?.trim();
  return text || null;
}

async function sendWhatsAppMessage(params: {
  to: string;
  message: string;
  channel: string;
  accountId?: string;
}) {
  // #region agent log
  fetch("http://127.0.0.1:7243/ingest/806880d9-48fa-4355-8d2b-a5e6a37fcd28", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "debug-session",
      runId: "whatsapp-test",
      hypothesisId: "H1",
      location: "runner.ts:sendWhatsAppMessage:entry",
      message: "sendWhatsAppMessage start",
      data: {
        channel: params.channel,
        accountId: params.accountId ?? null,
        target: maskTarget(params.to),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log
  const result = await callGateway<{ runId?: string; messageId?: string; toJid?: string }>({
    method: "send",
    params: {
      to: params.to,
      message: params.message,
      channel: params.channel,
      accountId: params.accountId,
      idempotencyKey: randomIdempotencyKey(),
    },
    expectFinal: true,
    timeoutMs: 10_000,
  });
  // #region agent log
  fetch("http://127.0.0.1:7243/ingest/806880d9-48fa-4355-8d2b-a5e6a37fcd28", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "debug-session",
      runId: "whatsapp-test",
      hypothesisId: "H1",
      location: "runner.ts:sendWhatsAppMessage:exit",
      message: "sendWhatsAppMessage done",
      data: {
        target: maskTarget(params.to),
        messageId: result?.messageId ?? null,
        toJid: result?.toJid ?? null,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log
}

const splitMessage = (value: string, maxChars: number): string[] => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    if (!sentence) continue;
    if (!buffer) {
      buffer = sentence;
      continue;
    }
    if (buffer.length + sentence.length + 1 <= maxChars) {
      buffer = `${buffer} ${sentence}`;
    } else {
      chunks.push(buffer);
      buffer = sentence;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks.length > 0 ? chunks : [trimmed];
};

async function sendPersonaMessage(params: {
  message: string;
  prefix?: string;
  splitMessages: boolean;
  splitMaxChars: number;
  splitDelayMs: number;
  target: string;
  channel: string;
  accountId?: string;
}) {
  const prefixedMessage = applyMessagePrefix(params.message, params.prefix ?? "");
  if (!params.splitMessages) {
    await sendWhatsAppMessage({
      to: params.target,
      message: prefixedMessage,
      channel: params.channel,
      accountId: params.accountId,
    });
    return;
  }
  const chunks = splitMessage(prefixedMessage, params.splitMaxChars);
  for (const chunk of chunks) {
    await sendWhatsAppMessage({
      to: params.target,
      message: chunk,
      channel: params.channel,
      accountId: params.accountId,
    });
    if (params.splitDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, params.splitDelayMs));
    }
  }
}

async function fetchSessionPreview(params: {
  sessionKey: string;
  limit: number;
  maxChars: number;
}): Promise<SessionsPreviewEntry | null> {
  // #region agent log
  fetch("http://127.0.0.1:7243/ingest/806880d9-48fa-4355-8d2b-a5e6a37fcd28", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "debug-session",
      runId: "whatsapp-test",
      hypothesisId: "H2",
      location: "runner.ts:fetchSessionPreview:entry",
      message: "sessions.preview start",
      data: { limit: params.limit, maxChars: params.maxChars, keyLen: params.sessionKey.length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log
  const result = await callGateway<SessionsPreviewResult>({
    method: "sessions.preview",
    params: {
      keys: [params.sessionKey],
      limit: params.limit,
      maxChars: params.maxChars,
    },
    expectFinal: true,
    timeoutMs: 10_000,
  });
  const preview = result.previews.find((entry) => entry.key === params.sessionKey);
  // #region agent log
  fetch("http://127.0.0.1:7243/ingest/806880d9-48fa-4355-8d2b-a5e6a37fcd28", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "debug-session",
      runId: "whatsapp-test",
      hypothesisId: "H2",
      location: "runner.ts:fetchSessionPreview:exit",
      message: "sessions.preview done",
      data: {
        status: preview?.status ?? "missing",
        items: preview?.items?.length ?? 0,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log
  return preview ?? null;
}

function extractLatestAssistantText(items: SessionsPreviewItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || item.role !== "assistant") continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (text) return text;
  }
  return null;
}

async function waitForAgentReply(params: {
  sessionKey: string;
  baseline: string | null;
  timeoutMs: number;
  pollIntervalMs: number;
  ignore?: (text: string) => boolean;
}): Promise<string> {
  const startedAt = Date.now();
  let baseline = params.baseline;
  // #region agent log
  fetch("http://127.0.0.1:7243/ingest/806880d9-48fa-4355-8d2b-a5e6a37fcd28", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "debug-session",
      runId: "whatsapp-test",
      hypothesisId: "H3",
      location: "runner.ts:waitForAgentReply:start",
      message: "waitForAgentReply start",
      data: {
        timeoutMs: params.timeoutMs,
        pollIntervalMs: params.pollIntervalMs,
        baselineLen: params.baseline?.length ?? 0,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log
  while (Date.now() - startedAt < params.timeoutMs) {
    const preview = await fetchSessionPreview({
      sessionKey: params.sessionKey,
      limit: 10,
      maxChars: 800,
    });
    if (preview?.items) {
      const reply = extractLatestAssistantText(preview.items);
      if (reply && reply !== baseline) {
        if (params.ignore?.(reply)) {
          baseline = reply;
        } else {
          return reply;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, params.pollIntervalMs));
  }
  // #region agent log
  fetch("http://127.0.0.1:7243/ingest/806880d9-48fa-4355-8d2b-a5e6a37fcd28", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "debug-session",
      runId: "whatsapp-test",
      hypothesisId: "H3",
      location: "runner.ts:waitForAgentReply:timeout",
      message: "waitForAgentReply timeout",
      data: { elapsedMs: Date.now() - startedAt },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log
  throw new Error(`Timed out waiting for agent reply (session ${params.sessionKey}).`);
}

const isIgnorableInbound = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.toLowerCase() === "/reset") return true;
  if (trimmed === "NO_REPLY") return true;
  if (/new session started/i.test(trimmed)) return true;
  return false;
};

const buildIgnore = (lastSent?: string | null) => (text: string) => {
  if (isIgnorableInbound(text)) return true;
  if (!lastSent) return false;
  return text.trim() === lastSent.trim();
};

async function resetTargetSession(params: {
  role: Exclude<ScenarioRole, "persona">;
  target: string;
  agentId: string;
  personaTarget: string;
  resetMessage: string;
  channel: string;
  accountId?: string;
  timeoutMs: number;
  pollIntervalMs: number;
  cfg: ReturnType<typeof loadConfig>;
  runtime: RuntimeEnv;
}): Promise<string | null> {
  const sessionKey =
    resolveSessionKeyForRequest({
      cfg: params.cfg,
      to: params.personaTarget,
      agentId: params.agentId,
    }).sessionKey ?? "";
  if (!sessionKey) {
    throw new Error(`Unable to resolve session key for ${params.role} reset.`);
  }
  const previewBefore = await fetchSessionPreview({
    sessionKey,
    limit: 10,
    maxChars: 800,
  });
  const baseline = previewBefore?.items ? extractLatestAssistantText(previewBefore.items) : null;

  await sendWhatsAppMessage({
    to: params.target,
    message: params.resetMessage,
    channel: params.channel,
    accountId: params.accountId,
  });

  params.runtime.log(`↺ ${params.role} reset sent`);
  return null;
}

async function resetSessionKey(sessionKey: string) {
  await callGateway({
    method: "sessions.reset",
    params: { key: sessionKey },
    expectFinal: true,
    timeoutMs: 10_000,
  });
}

export async function runWhatsAppTestScenario(options: RunScenarioOptions) {
  const scenario = resolveScenario(options.scenarioId);
  const channel = options.channel?.trim() || DEFAULT_CHAT_CHANNEL;
  const deliver = options.deliver !== false;
  const responseTimeoutSeconds = coerceTimeoutSeconds(options.responseTimeoutSeconds);
  const followupTimeoutSeconds =
    (typeof options.followupTimeoutSeconds === "number" && options.followupTimeoutSeconds > 0
      ? options.followupTimeoutSeconds
      : Math.min(responseTimeoutSeconds, 120)) || 60;
  const followupMaxTurns =
    typeof options.followupMaxTurns === "number" ? options.followupMaxTurns : 2;
  const pollIntervalMs = options.pollIntervalMs ?? 800;
  const lastMessages: Partial<Record<ScenarioRole, string>> = {};
  const latestInbound: Partial<Record<Exclude<ScenarioRole, "persona">, string>> = {};
  const results: StepResult[] = [];
  const tagHint = buildTagHint(options.tag);
  const resetMessage = options.resetMessage?.trim() || "/reset";
  const splitMessages = Boolean(options.splitMessages);
  const splitMaxChars = options.splitMaxChars ?? 140;
  const splitDelayMs = options.splitDelayMs ?? 800;

  assertAgentIds(options.agentIds);
  ensureAllowedTargets({
    targets: options.targets,
    allowTargets: options.allowTargets,
    allowAnyTarget: options.allowAnyTarget,
  });
  ensureDistinctTargets(options.targets);

  const cfg = loadConfig();

  options.runtime.log(
    `Targets: persona=${maskTarget(options.targets.persona)} scout=${maskTarget(
      options.targets.scout,
    )} talent=${maskTarget(options.targets.talent)} company=${maskTarget(options.targets.company)}`,
  );

  if (deliver && options.resetBefore) {
    const resetRoles = Array.from(new Set(scenario.steps.map((step) => step.to)));
    for (const role of resetRoles) {
      const agentSessionKey =
        resolveSessionKeyForRequest({
          cfg,
          to: options.targets.persona,
          agentId: normalizeAgent(options.agentIds[role]),
        }).sessionKey ?? "";
      if (agentSessionKey) {
        await resetSessionKey(agentSessionKey);
      }
      const resetReply = await resetTargetSession({
        role,
        target: options.targets[role],
        agentId: normalizeAgent(options.agentIds[role]),
        personaTarget: options.targets.persona,
        resetMessage,
        channel,
        accountId: options.accountIds?.persona ?? options.accountId,
        timeoutMs: responseTimeoutSeconds * 1000,
        pollIntervalMs,
        cfg,
        runtime: options.runtime,
      });
      if (resetReply) {
        latestInbound[role] = resetReply;
      }
    }
  }

  for (const step of scenario.steps) {
    const target = options.targets[step.to];
    const agentId = normalizeAgent(options.agentIds[step.to]);
    const templateVars = buildTemplateVars({
      personaName: options.personaName,
      personaContact: options.personaContact,
      personaLinkedIn: options.personaLinkedIn,
      introCompany: options.introCompany,
      candidateName: options.candidateName,
      candidatePhone: options.candidatePhone,
      candidateEmail: options.candidateEmail,
      candidateLinkedIn: options.candidateLinkedIn,
      companyName: options.companyName,
      companyUserName: options.companyUserName,
      tag: options.tag,
      lastMessages,
    });
    const templatedPrompt = `${renderTemplate(step.prompt, templateVars)}${tagHint}`.trim();
    const fallbackReply = step.fallbackReply
      ? renderTemplate(step.fallbackReply, templateVars).trim()
      : templatedPrompt;
    const roleHint =
      step.to === "company"
        ? `If asked which company you are with, say ${templateVars.intro_company} and accept ${templateVars.candidate_name}'s intro.`
        : step.to === "talent"
          ? `If asked for your name, include ${templateVars.candidate_name} and then request a warm intro to ${templateVars.intro_company}.`
          : `Always include the candidate phone and LinkedIn in your first reply. If asked for LinkedIn, use ${templateVars.candidate_linkedin}.`;

    // #region agent log
    fetch("http://127.0.0.1:7243/ingest/806880d9-48fa-4355-8d2b-a5e6a37fcd28", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "debug-session",
        runId: "whatsapp-test",
        hypothesisId: "H4",
        location: "runner.ts:runWhatsAppTestScenario:step",
        message: "scenario step",
        data: {
          stepId: step.id,
          to: step.to,
          agentId,
          target: maskTarget(target),
          deliver,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log

    const agentSessionKey =
      resolveSessionKeyForRequest({
        cfg,
        to: options.targets.persona,
        agentId,
      }).sessionKey ?? "";
    if (!agentSessionKey) {
      throw new Error(`Unable to resolve session key for ${step.to}.`);
    }

    const personaAgentId =
      (step.to === "scout" ? options.scoutPersonaAgentId : undefined) ??
      (step.to === "talent" ? options.talentPersonaAgentId : undefined) ??
      (step.to === "company" ? options.companyPersonaAgentId : undefined) ??
      options.personaAgentId;
    const personaAgentIdTrimmed = personaAgentId?.trim();
    const personaSessionKey = personaAgentId
      ? (resolveSessionKeyForRequest({
          cfg,
          to: target,
          agentId: personaAgentIdTrimmed ?? "",
        }).sessionKey ?? "")
      : "";
    if (personaAgentIdTrimmed && !personaSessionKey) {
      throw new Error(
        `Unable to resolve session key for persona agent "${personaAgentIdTrimmed}".`,
      );
    }
    const previewBefore = await fetchSessionPreview({
      sessionKey: agentSessionKey,
      limit: 10,
      maxChars: 800,
    });
    const baseline = previewBefore?.items ? extractLatestAssistantText(previewBefore.items) : null;

    const usePersonaAgent = Boolean(personaAgentIdTrimmed) && deliver;
    let personaMessage = templatedPrompt;
    let replyText = "(dry-run)";

    if (usePersonaAgent) {
      if (options.resetBefore) {
        await resetSessionKey(personaSessionKey);
      }
      const personaAgentIdSafe = personaAgentIdTrimmed ?? "";
      const inbound =
        latestInbound[step.to] ??
        (await waitForAgentReply({
          sessionKey: agentSessionKey,
          baseline,
          timeoutMs: responseTimeoutSeconds * 1000,
          pollIntervalMs,
          ignore: isIgnorableInbound,
        }));
      latestInbound[step.to] = undefined;

      options.runtime.log(
        `← ${step.to} → persona: ${inbound.replace(/\s+/g, " ").slice(0, 120)}...`,
      );

      const drafted = await draftPersonaMessage({
        message: [
          `Reply to the incoming WhatsApp message as ${templateVars.persona_name}.`,
          "Be natural and concise. Answer any direct question in the inbound message.",
          "Do not invent contact details. Only share contact details if explicitly provided.",
          "If asked for a specific field (name, company, LinkedIn), include it first, then add one short sentence that advances the flow.",
          roleHint,
          `Use these exact details when asked:`,
          `- Candidate: ${templateVars.candidate_name}`,
          `- Phone: ${templateVars.candidate_phone}`,
          `- Email: ${templateVars.candidate_email}`,
          `- LinkedIn: ${templateVars.candidate_linkedin}`,
          `- Company (for company flow): ${templateVars.company_name}`,
          `- Company contact name: ${templateVars.company_user_name}`,
          `Persona goal: ${templatedPrompt}`,
          `Incoming message from ${step.to}: ${inbound}`,
          templateVars.persona_contact
            ? `Contact details (share only if asked or relevant): ${templateVars.persona_contact}`
            : "",
          templateVars.persona_linkedin
            ? `LinkedIn (share only if asked): ${templateVars.persona_linkedin}`
            : "",
          lastMessages[step.to] ? `Previous message from ${step.to}: ${lastMessages[step.to]}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        agentId: personaAgentIdSafe,
        sessionKey: personaSessionKey,
        channel,
        timeoutSeconds: responseTimeoutSeconds,
      });
      if (drafted) {
        personaMessage = drafted;
      } else {
        options.runtime.log(`⚠ persona agent returned no text; using fallback reply`);
        personaMessage = fallbackReply;
      }
      replyText = inbound;
    }

    const messagePrefix = buildTagPrefix(options.tag, step.to);
    const outboundMessage = applyMessagePrefix(personaMessage, messagePrefix);
    options.runtime.log(
      `→ persona → ${step.to}: ${outboundMessage.replace(/\s+/g, " ").slice(0, 120)}...`,
    );

    if (deliver) {
      await sendPersonaMessage({
        message: personaMessage,
        prefix: messagePrefix,
        splitMessages,
        splitMaxChars,
        splitDelayMs,
        target,
        channel,
        accountId: options.accountIds?.persona ?? options.accountId,
      });
      replyText = await waitForAgentReply({
        sessionKey: agentSessionKey,
        baseline: usePersonaAgent ? replyText : baseline,
        timeoutMs: responseTimeoutSeconds * 1000,
        pollIntervalMs,
        ignore: buildIgnore(outboundMessage),
      });
    }

    lastMessages.persona = personaMessage;
    lastMessages[step.to] = replyText;
    results.push({
      stepId: step.id,
      to: step.to,
      prompt: personaMessage,
      replyText,
      delivered: deliver,
    });

    options.runtime.log(`✓ ${step.to} reply (${replyText.length} chars)`);

    if (deliver && usePersonaAgent && followupMaxTurns > 0) {
      let followupBaseline = replyText;
      let lastSentMessage = outboundMessage;
      for (let turn = 0; turn < followupMaxTurns; turn += 1) {
        let nextInbound: string;
        try {
          nextInbound = await waitForAgentReply({
            sessionKey: agentSessionKey,
            baseline: followupBaseline,
            timeoutMs: followupTimeoutSeconds * 1000,
            pollIntervalMs,
            ignore: buildIgnore(lastSentMessage),
          });
        } catch {
          break;
        }
        options.runtime.log(
          `← ${step.to} → persona: ${nextInbound.replace(/\s+/g, " ").slice(0, 120)}...`,
        );
        const drafted = await draftPersonaMessage({
          message: [
            `Reply to the incoming WhatsApp message as ${templateVars.persona_name}.`,
            "Be natural and concise. Answer any direct question in the inbound message.",
            "Do not invent contact details. Only share contact details if explicitly provided.",
            "If asked for a specific field (name, company, LinkedIn), include it first, then add one short sentence that advances the flow.",
            roleHint,
            `Use these exact details when asked:`,
            `- Candidate: ${templateVars.candidate_name}`,
            `- Phone: ${templateVars.candidate_phone}`,
            `- Email: ${templateVars.candidate_email}`,
            `- LinkedIn: ${templateVars.candidate_linkedin}`,
            `- Company (for company flow): ${templateVars.company_name}`,
            `- Company contact name: ${templateVars.company_user_name}`,
            `Persona goal: ${templatedPrompt}`,
            `Incoming message from ${step.to}: ${nextInbound}`,
            templateVars.persona_contact
              ? `Contact details (share only if asked or relevant): ${templateVars.persona_contact}`
              : "",
            templateVars.persona_linkedin
              ? `LinkedIn (share only if asked): ${templateVars.persona_linkedin}`
              : "",
            `Target company for intro: ${templateVars.intro_company}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          agentId: personaAgentIdTrimmed ?? "",
          sessionKey: personaSessionKey,
          channel,
          timeoutSeconds: responseTimeoutSeconds,
        });
        const followupMessage = drafted || fallbackReply;
        const followupOutbound = applyMessagePrefix(followupMessage, messagePrefix);
        await sendPersonaMessage({
          message: followupMessage,
          prefix: messagePrefix,
          splitMessages,
          splitMaxChars,
          splitDelayMs,
          target,
          channel,
          accountId: options.accountIds?.persona ?? options.accountId,
        });
        options.runtime.log(
          `→ persona → ${step.to}: ${followupOutbound.replace(/\s+/g, " ").slice(0, 120)}...`,
        );
        followupBaseline = nextInbound;
        lastSentMessage = followupOutbound;
      }
    }

    if (options.waitMs && options.waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.waitMs));
    }
  }

  return {
    scenario,
    results,
  };
}
