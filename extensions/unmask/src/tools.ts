import { Type } from "@sinclair/typebox";

import type { MoltbotPluginApi, MoltbotPluginToolContext } from "../../../src/plugins/types.js";

type UnmaskPluginConfig = {
  apiBaseUrl?: string;
  apiToken?: string;
  timeoutMs?: number;
  endpoints?: {
    shouldRespond?: string;
    createReferral?: string;
    onboardTalent?: string;
    requestIntro?: string;
    acceptIntro?: string;
    declineIntro?: string;
  };
};

type UnmaskApiResponse = {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
};

const DEFAULT_ENDPOINTS = {
  shouldRespond: "/v1/agents/should-respond",
  createReferral: "/v1/scout/referrals",
  onboardTalent: "/v1/talent/onboard",
  requestIntro: "/v1/talent/intro-request",
  acceptIntro: "/v1/company/intro-accept",
  declineIntro: "/v1/company/intro-decline",
} as const;

function resolvePluginConfig(api: MoltbotPluginApi): UnmaskPluginConfig {
  const raw = api.pluginConfig ?? {};
  if (!raw || typeof raw !== "object") return {};
  return raw as UnmaskPluginConfig;
}

function resolveApiBaseUrl(config: UnmaskPluginConfig): string | null {
  const fromConfig = typeof config.apiBaseUrl === "string" ? config.apiBaseUrl.trim() : "";
  const fromEnv = typeof process.env.UNMASK_API_BASE_URL === "string"
    ? process.env.UNMASK_API_BASE_URL.trim()
    : "";
  const baseUrl = fromConfig || fromEnv;
  return baseUrl ? baseUrl : null;
}

function resolveApiToken(config: UnmaskPluginConfig): string | null {
  const fromConfig = typeof config.apiToken === "string" ? config.apiToken.trim() : "";
  const fromEnv = typeof process.env.UNMASK_API_TOKEN === "string"
    ? process.env.UNMASK_API_TOKEN.trim()
    : "";
  const token = fromConfig || fromEnv;
  return token ? token : null;
}

function resolveEndpoint(config: UnmaskPluginConfig, key: keyof typeof DEFAULT_ENDPOINTS): string {
  const override = config.endpoints?.[key];
  if (typeof override === "string" && override.trim()) return override.trim();
  return DEFAULT_ENDPOINTS[key];
}

function buildUrl(baseUrl: string, path: string): string {
  try {
    if (/^https?:\/\//i.test(path)) return path;
    return new URL(path, baseUrl).toString();
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }
}

async function parseJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callUnmaskApi(
  api: MoltbotPluginApi,
  endpointKey: keyof typeof DEFAULT_ENDPOINTS,
  payload: Record<string, unknown>,
): Promise<UnmaskApiResponse> {
  const config = resolvePluginConfig(api);
  const baseUrl = resolveApiBaseUrl(config);
  if (!baseUrl) {
    return { ok: false, status: 0, error: "UNMASK apiBaseUrl is not configured." };
  }
  const url = buildUrl(baseUrl, resolveEndpoint(config, endpointKey));
  const token = resolveApiToken(config);
  const timeoutMs = typeof config.timeoutMs === "number" ? config.timeoutMs : 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await parseJsonOrText(res);
    if (!res.ok) {
      const detail =
        typeof data === "string"
          ? data
          : data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : undefined;
      return {
        ok: false,
        status: res.status,
        data,
        error: detail || `Request failed (${res.status})`,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function buildResultText(label: string, response: UnmaskApiResponse): string {
  if (response.ok) {
    if (response.data && typeof response.data === "object") {
      const data = response.data as Record<string, unknown>;
      if (data.id) return `${label}: ok (id: ${String(data.id)})`;
      if (data.status) return `${label}: ${String(data.status)}`;
    }
    return `${label}: ok`;
  }
  return `${label}: ${response.error ?? "request failed"}`;
}

function fallbackShouldRespond(params: {
  silent?: boolean;
  doNotRespond?: boolean;
  flags?: { silent?: boolean; doNotRespond?: boolean; canProceed?: boolean };
}) {
  const silent = Boolean(params.silent ?? params.flags?.silent);
  const doNotRespond = Boolean(params.doNotRespond ?? params.flags?.doNotRespond);
  if (silent || doNotRespond) {
    return {
      shouldRespond: false,
      reason: "silent/doNotRespond flag set",
      source: "fallback",
    };
  }
  return { shouldRespond: true, reason: "default allow", source: "fallback" };
}

export function createUnmaskTools(api: MoltbotPluginApi, _ctx: MoltbotPluginToolContext) {
  return [
    {
      name: "unmask_should_respond",
      description:
        "Validate whether the agent should respond for this event. Returns shouldRespond + reason.",
      parameters: Type.Object({
        eventType: Type.Unsafe<
          "user_text" | "user_quick_reply" | "system_template" | "system_action" | "flow_complete"
        >({
          type: "string",
          enum: [
            "user_text",
            "user_quick_reply",
            "system_template",
            "system_action",
            "flow_complete",
          ],
        }),
        message: Type.Optional(Type.String()),
        phase: Type.Optional(Type.String()),
        lastOutboundType: Type.Optional(Type.String()),
        lastAction: Type.Optional(Type.String()),
        silent: Type.Optional(Type.Boolean()),
        doNotRespond: Type.Optional(Type.Boolean()),
        flags: Type.Optional(
          Type.Object({
            silent: Type.Optional(Type.Boolean()),
            doNotRespond: Type.Optional(Type.Boolean()),
            canProceed: Type.Optional(Type.Boolean()),
          }),
        ),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const payload = {
          eventType: params.eventType,
          message: params.message,
          phase: params.phase,
          lastOutboundType: params.lastOutboundType,
          lastAction: params.lastAction,
          silent: params.silent,
          doNotRespond: params.doNotRespond,
          flags: params.flags,
        };
        const response = await callUnmaskApi(api, "shouldRespond", payload);
        if (!response.ok && response.status === 0) {
          const fallback = fallbackShouldRespond({
            silent: params.silent as boolean | undefined,
            doNotRespond: params.doNotRespond as boolean | undefined,
            flags: params.flags as { silent?: boolean; doNotRespond?: boolean } | undefined,
          });
          const text = `shouldRespond: ${fallback.shouldRespond}\nreason: ${fallback.reason}\nsource: ${fallback.source}`;
          return { content: [{ type: "text", text }], details: fallback };
        }
        const text = buildResultText("shouldRespond", response);
        return { content: [{ type: "text", text }], details: response.data ?? response };
      },
    },
    {
      name: "unmask_referral_create",
      description: "Create a scout referral using a candidate phone number.",
      parameters: Type.Object({
        phone: Type.String(),
        name: Type.Optional(Type.String()),
        notes: Type.Optional(Type.String()),
        scoutPhone: Type.Optional(Type.String()),
        source: Type.Optional(Type.String()),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const response = await callUnmaskApi(api, "createReferral", {
          phone: params.phone,
          name: params.name,
          notes: params.notes,
          scoutPhone: params.scoutPhone,
          source: params.source,
        });
        return {
          content: [{ type: "text", text: buildResultText("referral", response) }],
          details: response.data ?? response,
        };
      },
    },
    {
      name: "unmask_talent_onboard",
      description: "Create or update a talent profile during onboarding.",
      parameters: Type.Object({
        phone: Type.String(),
        fullName: Type.Optional(Type.String()),
        role: Type.Optional(Type.String()),
        location: Type.Optional(Type.String()),
        notes: Type.Optional(Type.String()),
        scoutPhone: Type.Optional(Type.String()),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const response = await callUnmaskApi(api, "onboardTalent", {
          phone: params.phone,
          fullName: params.fullName,
          role: params.role,
          location: params.location,
          notes: params.notes,
          scoutPhone: params.scoutPhone,
        });
        return {
          content: [{ type: "text", text: buildResultText("talent", response) }],
          details: response.data ?? response,
        };
      },
    },
    {
      name: "unmask_intro_request",
      description: "Request an intro between a talent and a company.",
      parameters: Type.Object({
        talentPhone: Type.String(),
        companyId: Type.Optional(Type.String()),
        companyName: Type.Optional(Type.String()),
        reason: Type.String(),
        notes: Type.Optional(Type.String()),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const response = await callUnmaskApi(api, "requestIntro", {
          talentPhone: params.talentPhone,
          companyId: params.companyId,
          companyName: params.companyName,
          reason: params.reason,
          notes: params.notes,
        });
        return {
          content: [{ type: "text", text: buildResultText("intro request", response) }],
          details: response.data ?? response,
        };
      },
    },
    {
      name: "unmask_company_accept_intro",
      description: "Accept an intro request on behalf of a company.",
      parameters: Type.Object({
        introId: Type.String(),
        companyPhone: Type.Optional(Type.String()),
        notes: Type.Optional(Type.String()),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const response = await callUnmaskApi(api, "acceptIntro", {
          introId: params.introId,
          companyPhone: params.companyPhone,
          notes: params.notes,
        });
        return {
          content: [{ type: "text", text: buildResultText("intro accept", response) }],
          details: response.data ?? response,
        };
      },
    },
    {
      name: "unmask_company_decline_intro",
      description: "Decline an intro request on behalf of a company.",
      parameters: Type.Object({
        introId: Type.String(),
        reason: Type.String(),
        companyPhone: Type.Optional(Type.String()),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const response = await callUnmaskApi(api, "declineIntro", {
          introId: params.introId,
          reason: params.reason,
          companyPhone: params.companyPhone,
        });
        return {
          content: [{ type: "text", text: buildResultText("intro decline", response) }],
          details: response.data ?? response,
        };
      },
    },
  ];
}
