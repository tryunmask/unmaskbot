import type { MoltbotConfig } from "../../config/config.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { logVerbose } from "../../globals.js";
import type { FinalizedMsgContext } from "../templating.js";
import type {
  UnmaskCompanyProfile,
  UnmaskContextActorType,
  UnmaskContextBundle,
  UnmaskIntroSummary,
  UnmaskTalentProfile,
} from "./types.js";

type UnmaskContextConfig = {
  enabled?: boolean;
  fakeData?: boolean;
  cacheTtlMs?: number;
  summaryMaxChars?: number;
  timeoutMs?: number;
  apiBaseUrl?: string;
  apiToken?: string;
  endpoints?: {
    contextLookup?: string;
  };
};

type ContextLookupResponse = {
  talent?: UnmaskTalentProfile | null;
  company?: UnmaskCompanyProfile | null;
  intro?: (UnmaskIntroSummary & { _id?: string }) | null;
};

type CachedContext = {
  expiresAt: number;
  bundle: UnmaskContextBundle;
};

const DEFAULT_ENDPOINT = "/v1/context/lookup";
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_SUMMARY_MAX_CHARS = 1200;

const contextCache = new Map<string, CachedContext>();

function resolveContextConfig(cfg: MoltbotConfig): UnmaskContextConfig {
  const entry = cfg.plugins?.entries?.unmask;
  const pluginConfig = entry?.config && typeof entry.config === "object" ? entry.config : {};
  const contextConfig =
    "context" in pluginConfig && pluginConfig.context && typeof pluginConfig.context === "object"
      ? (pluginConfig.context as UnmaskContextConfig)
      : {};
  const endpoints =
    "endpoints" in pluginConfig &&
    pluginConfig.endpoints &&
    typeof pluginConfig.endpoints === "object"
      ? (pluginConfig.endpoints as UnmaskContextConfig["endpoints"])
      : undefined;
  const contextEndpoints =
    "endpoints" in contextConfig &&
    contextConfig.endpoints &&
    typeof contextConfig.endpoints === "object"
      ? contextConfig.endpoints
      : undefined;
  return {
    ...contextConfig,
    apiBaseUrl:
      typeof (pluginConfig as UnmaskContextConfig).apiBaseUrl === "string"
        ? (pluginConfig as UnmaskContextConfig).apiBaseUrl
        : contextConfig.apiBaseUrl,
    apiToken:
      typeof (pluginConfig as UnmaskContextConfig).apiToken === "string"
        ? (pluginConfig as UnmaskContextConfig).apiToken
        : contextConfig.apiToken,
    endpoints: {
      ...endpoints,
      ...contextEndpoints,
    },
  };
}

function resolveApiBaseUrl(config: UnmaskContextConfig): string | null {
  const fromConfig = typeof config.apiBaseUrl === "string" ? config.apiBaseUrl.trim() : "";
  const fromEnv =
    typeof process.env.UNMASK_API_BASE_URL === "string"
      ? process.env.UNMASK_API_BASE_URL.trim()
      : "";
  const baseUrl = fromConfig || fromEnv;
  return baseUrl || null;
}

function resolveApiToken(config: UnmaskContextConfig): string | null {
  const fromConfig = typeof config.apiToken === "string" ? config.apiToken.trim() : "";
  const fromEnv =
    typeof process.env.UNMASK_API_TOKEN === "string" ? process.env.UNMASK_API_TOKEN.trim() : "";
  const token = fromConfig || fromEnv;
  return token || null;
}

function resolveEndpoint(config: UnmaskContextConfig): string {
  const override = config.endpoints?.contextLookup;
  if (typeof override === "string" && override.trim()) return override.trim();
  return DEFAULT_ENDPOINT;
}

function buildUrl(baseUrl: string, path: string): string {
  try {
    if (/^https?:\/\//i.test(path)) return path;
    return new URL(path, baseUrl).toString();
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }
}

function resolveActorType(ctx: FinalizedMsgContext, cfg: MoltbotConfig): UnmaskContextActorType {
  const targetSessionKey =
    ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey?.trim() : undefined;
  const sessionKey = targetSessionKey || ctx.SessionKey;
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  if (agentId === "talent") return "talent";
  if (agentId === "company") return "company";
  if (agentId === "scout") return "scout";
  return "unknown";
}

function resolveActorPhone(ctx: FinalizedMsgContext): string | undefined {
  const candidates = [ctx.SenderE164, ctx.From, ctx.SenderId]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return candidates[0];
}

async function parseJson<T>(res: Response): Promise<T | undefined> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function fetchContextBundle(params: {
  config: UnmaskContextConfig;
  actorType: UnmaskContextActorType;
  actorPhone?: string;
}): Promise<UnmaskContextBundle | null> {
  if (params.actorType === "scout" || params.actorType === "unknown") return null;
  const baseUrl = resolveApiBaseUrl(params.config);
  if (!baseUrl) return null;
  const url = buildUrl(baseUrl, resolveEndpoint(params.config));
  const token = resolveApiToken(params.config);
  const timeoutMs =
    typeof params.config.timeoutMs === "number" ? params.config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload =
      params.actorType === "talent"
        ? { talentPhone: params.actorPhone }
        : { companyPhone: params.actorPhone };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await parseJson<ContextLookupResponse>(res);
    if (!res.ok) return null;
    if (!data) return null;
    const introId = data.intro?._id ?? data.intro?.id;
    const intro =
      data.intro && introId
        ? {
            id: String(introId),
            talentPhone: data.intro.talentPhone,
            companyName: data.intro.companyName,
            reason: data.intro.reason,
            notes: data.intro.notes,
            status: data.intro.status,
            companyPhone: data.intro.companyPhone,
          }
        : undefined;
    return {
      actorType: params.actorType,
      actorPhone: params.actorPhone,
      talent: data.talent ?? undefined,
      company: data.company ?? undefined,
      intro,
      source: "convex",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logVerbose(`context-hydrator: fetch failed (${message})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatProfileSummary(params: {
  label: string;
  details: Array<string | undefined>;
}): string | null {
  const values = params.details.filter(Boolean) as string[];
  if (values.length === 0) return null;
  return `${params.label}: ${values.join(" | ")}`;
}

function formatContextSummary(bundle: UnmaskContextBundle, maxChars: number): string {
  const lines: string[] = [];
  const sourceLabel = bundle.source === "convex" ? "convex" : "fake";
  lines.push(`Unmask context (${sourceLabel}).`);
  if (bundle.actorType !== "unknown") {
    lines.push(`Actor: ${bundle.actorType}${bundle.actorPhone ? ` (${bundle.actorPhone})` : ""}`);
  }
  const talentLine = bundle.talent
    ? formatProfileSummary({
        label: "Talent",
        details: [
          bundle.talent.fullName,
          bundle.talent.role,
          bundle.talent.location,
          bundle.talent.linkedin,
        ],
      })
    : null;
  if (talentLine) lines.push(talentLine);
  const companyLine = bundle.company
    ? formatProfileSummary({
        label: "Company",
        details: [
          bundle.company.name,
          bundle.company.domain,
          bundle.company.website,
          bundle.company.summary,
        ],
      })
    : null;
  if (companyLine) lines.push(companyLine);
  const scoutLine = bundle.scout
    ? formatProfileSummary({ label: "Scout", details: [bundle.scout.name] })
    : null;
  if (scoutLine) lines.push(scoutLine);
  if (bundle.intro) {
    const introParts = [
      bundle.intro.companyName,
      bundle.intro.reason ? `Reason: ${bundle.intro.reason}` : undefined,
      bundle.intro.status ? `Status: ${bundle.intro.status}` : undefined,
    ].filter(Boolean);
    if (introParts.length > 0) {
      lines.push(`Intro: ${introParts.join(" | ")}`);
    }
  }
  const summary = lines.join("\n");
  if (summary.length <= maxChars) return summary;
  return summary.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}

function writeContextToMsg(ctx: FinalizedMsgContext, bundle: UnmaskContextBundle, summary: string) {
  ctx.UnmaskContext = bundle;
  const combined = [ctx.GroupSystemPrompt?.trim(), summary].filter(Boolean).join("\n\n");
  ctx.GroupSystemPrompt = combined;
}

export async function applyUnmaskContext(params: {
  ctx: FinalizedMsgContext;
  cfg: MoltbotConfig;
}): Promise<void> {
  const { ctx, cfg } = params;
  const config = resolveContextConfig(cfg);
  if (!config.enabled) return;

  const actorType = resolveActorType(ctx, cfg);
  if (actorType === "unknown") return;
  const actorPhone = resolveActorPhone(ctx);
  const cacheTtlMs =
    typeof config.cacheTtlMs === "number" ? config.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
  const cacheKey = `${actorType}:${actorPhone ?? "unknown"}`;
  const now = Date.now();
  const cached = contextCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    const summary = formatContextSummary(
      cached.bundle,
      typeof config.summaryMaxChars === "number"
        ? config.summaryMaxChars
        : DEFAULT_SUMMARY_MAX_CHARS,
    );
    cached.bundle.summary = summary;
    writeContextToMsg(ctx, cached.bundle, summary);
    return;
  }

  const bundle =
    actorPhone && actorPhone.trim()
      ? await fetchContextBundle({ config, actorType, actorPhone })
      : null;
  if (!bundle) {
    logVerbose(
      `context-hydrator: no context found for ${actorType}:${actorPhone ?? "unknown"} (convex lookup returned nothing)`,
    );
    return;
  }

  const summary = formatContextSummary(
    bundle,
    typeof config.summaryMaxChars === "number" ? config.summaryMaxChars : DEFAULT_SUMMARY_MAX_CHARS,
  );
  bundle.summary = summary;
  if (cacheTtlMs > 0) {
    contextCache.set(cacheKey, { expiresAt: now + cacheTtlMs, bundle });
  }
  writeContextToMsg(ctx, bundle, summary);
}
