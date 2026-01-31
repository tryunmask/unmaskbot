import type { MoltbotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { sleepWithAbort, computeBackoff, type BackoffPolicy } from "../backoff.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { runMessageAction } from "./message-action-runner.js";
import { addChannelAllowFromStoreEntry } from "../../pairing/pairing-store.js";

type UnmaskPollerConfig = {
  apiBaseUrl?: string;
  apiToken?: string;
};

type OutboundMessage = {
  id: string;
  toPhone: string;
  message: string;
  agentId?: string;
  channel?: string;
  accountId?: string;
  addToAllowlist?: boolean;
  attempts?: number;
};

type ClaimResponse = {
  items?: OutboundMessage[];
};

type ApiResponse<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

const DEFAULT_BACKOFF: BackoffPolicy = {
  initialMs: 5_000,
  maxMs: 60_000,
  factor: 2,
  jitter: 0.2,
};

const DEFAULT_POLL_LIMIT = 5;
const POLL_NO_CONFIG_DELAY_MS = 60_000;

const log = createSubsystemLogger("gateway/outbound-poller");

function resolveUnmaskPollerConfig(cfg: MoltbotConfig): UnmaskPollerConfig {
  const entry = cfg.plugins?.entries?.unmask;
  const pluginConfig = entry?.config && typeof entry.config === "object" ? entry.config : {};
  const fromConfig = pluginConfig as UnmaskPollerConfig;
  const apiBaseUrl =
    typeof fromConfig.apiBaseUrl === "string" && fromConfig.apiBaseUrl.trim()
      ? fromConfig.apiBaseUrl.trim()
      : typeof process.env.UNMASK_API_BASE_URL === "string"
        ? process.env.UNMASK_API_BASE_URL.trim()
        : undefined;
  const apiToken =
    typeof fromConfig.apiToken === "string" && fromConfig.apiToken.trim()
      ? fromConfig.apiToken.trim()
      : typeof process.env.UNMASK_API_TOKEN === "string"
        ? process.env.UNMASK_API_TOKEN.trim()
        : undefined;
  return { apiBaseUrl, apiToken };
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

async function callUnmaskApi<T>(
  cfg: UnmaskPollerConfig,
  path: string,
  payload: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<ApiResponse<T>> {
  if (!cfg.apiBaseUrl) {
    return { ok: false, status: 0, error: "apiBaseUrl missing" };
  }
  const url = new URL(path, cfg.apiBaseUrl).toString();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: abortSignal,
    });
    const data = await parseJson<T>(res);
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: `Request failed (${res.status})` };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  }
}

async function claimOutboundMessages(
  cfg: UnmaskPollerConfig,
  limit: number,
  abortSignal?: AbortSignal,
) {
  return callUnmaskApi<ClaimResponse>(cfg, "/v1/outbound/claim", { limit }, abortSignal);
}

async function markOutboundMessage(
  cfg: UnmaskPollerConfig,
  params: { id: string; status: "sent" | "failed"; error?: string },
  abortSignal?: AbortSignal,
) {
  return callUnmaskApi(
    cfg,
    "/v1/outbound/mark",
    { id: params.id, status: params.status, error: params.error },
    abortSignal,
  );
}

export type OutboundMessagePoller = {
  stop: () => void;
  updateConfig: (cfg: MoltbotConfig) => void;
};

export function startOutboundMessagePoller(opts?: {
  cfg?: MoltbotConfig;
  backoff?: BackoffPolicy;
  pollLimit?: number;
}): OutboundMessagePoller {
  const state = {
    cfg: opts?.cfg ?? loadConfig(),
    abortController: new AbortController(),
    backoff: opts?.backoff ?? DEFAULT_BACKOFF,
    pollLimit: Math.max(1, Math.min(50, Math.floor(opts?.pollLimit ?? DEFAULT_POLL_LIMIT))),
    attempt: 0,
    stopped: false,
  };

  const sleepBackoff = async () => {
    state.attempt += 1;
    const delay = computeBackoff(state.backoff, state.attempt);
    await sleepWithAbort(delay, state.abortController.signal);
  };

  const runLoop = async () => {
    try {
      while (!state.abortController.signal.aborted) {
        const pollerConfig = resolveUnmaskPollerConfig(state.cfg);
        if (!pollerConfig.apiBaseUrl || !pollerConfig.apiToken) {
          if (state.attempt === 0) {
            log.info("outbound poller disabled (missing UNMASK apiBaseUrl/apiToken)");
          }
          state.attempt = Math.max(state.attempt, 1);
          await sleepWithAbort(POLL_NO_CONFIG_DELAY_MS, state.abortController.signal);
          continue;
        }

        const claim = await claimOutboundMessages(
          pollerConfig,
          state.pollLimit,
          state.abortController.signal,
        );
        if (!claim.ok) {
          log.warn(`outbound claim failed: ${claim.error ?? "unknown error"}`);
          await sleepBackoff();
          continue;
        }

        const items = Array.isArray(claim.data?.items) ? (claim.data?.items ?? []) : [];
        if (items.length === 0) {
          await sleepBackoff();
          continue;
        }

        state.attempt = 0;

        for (const item of items) {
          try {
            const channel = item.channel?.trim() || "whatsapp";
            if (item.addToAllowlist && channel === "whatsapp") {
              try {
                await addChannelAllowFromStoreEntry({
                  channel: "whatsapp",
                  entry: item.toPhone,
                });
              } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                log.warn(`outbound allowlist update failed: ${reason}`);
              }
            }
            await runMessageAction({
              cfg: state.cfg,
              action: "send",
              params: {
                channel,
                target: item.toPhone,
                message: item.message,
                ...(item.accountId ? { accountId: item.accountId } : {}),
              },
              agentId: item.agentId ?? undefined,
            });
            await markOutboundMessage(
              pollerConfig,
              { id: item.id, status: "sent" },
              state.abortController.signal,
            );
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            log.warn(`outbound send failed: ${reason}`);
            await markOutboundMessage(
              pollerConfig,
              { id: item.id, status: "failed", error: reason },
              state.abortController.signal,
            );
          }
        }
      }
    } catch (err) {
      if (!state.abortController.signal.aborted) {
        const reason = err instanceof Error ? err.message : String(err);
        log.warn(`outbound poller stopped unexpectedly: ${reason}`);
      }
    }
  };

  void runLoop();

  return {
    stop: () => {
      if (state.stopped) return;
      state.stopped = true;
      state.abortController.abort();
    },
    updateConfig: (cfg) => {
      state.cfg = cfg;
    },
  };
}
