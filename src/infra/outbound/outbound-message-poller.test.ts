import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./message-action-runner.js", () => ({
  runMessageAction: vi.fn(),
}));

describe("outbound-message-poller", () => {
  const originalFetch = globalThis.fetch;
  const normalizeRequestUrl = (input: RequestInfo | URL): string => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    if ("url" in input && typeof input.url === "string") return input.url;
    return "";
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("UNMASK_API_BASE_URL", "https://example.test");
    vi.stubEnv("UNMASK_API_TOKEN", "token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  });

  it("claims, sends, and marks outbound messages", async () => {
    const { runMessageAction } = await import("./message-action-runner.js");
    const { startOutboundMessagePoller } = await import("./outbound-message-poller.js");

    let claimCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = normalizeRequestUrl(input);
      if (url.includes("/v1/outbound/claim")) {
        claimCount += 1;
        if (claimCount > 1) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "outbound_1",
                toPhone: "+15555550123",
                message: "Hello there",
                agentId: "talent",
                channel: "whatsapp",
                accountId: "talent",
                attempts: 1,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/outbound/mark")) {
        return new Response(JSON.stringify({ status: "sent" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const poller = startOutboundMessagePoller({
      backoff: { initialMs: 1_000, maxMs: 1_000, factor: 1, jitter: 0 },
    });

    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
      if (fetchMock.mock.calls.length >= 2) break;
    }

    expect(runMessageAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "send",
        params: expect.objectContaining({
          channel: "whatsapp",
          target: "+15555550123",
          message: "Hello there",
          accountId: "talent",
        }),
      }),
    );
    expect(
      fetchMock.mock.calls.some(([url]) => normalizeRequestUrl(url).includes("/v1/outbound/mark")),
    ).toBe(true);

    poller.stop();
    await vi.advanceTimersByTimeAsync(1_000);
  });
});
