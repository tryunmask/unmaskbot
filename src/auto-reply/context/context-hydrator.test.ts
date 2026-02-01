import { describe, expect, it } from "vitest";

import type { MoltbotConfig } from "../../config/config.js";
import type { FinalizedMsgContext } from "../templating.js";
import { applyUnmaskContext } from "./context-hydrator.js";

describe("applyUnmaskContext", () => {
  it("injects fake context when enabled", async () => {
    const cfg = {
      plugins: {
        entries: {
          unmask: {
            enabled: true,
            config: {
              context: { enabled: true, fakeData: true },
            },
          },
        },
      },
      agents: {
        list: [{ id: "talent" }],
      },
    } satisfies MoltbotConfig;

    const ctx = {
      SessionKey: "agent:talent:dm:+15555550123",
      From: "+15555550123",
      Body: "hi",
      CommandAuthorized: false,
    } as FinalizedMsgContext;

    await applyUnmaskContext({ ctx, cfg });

    expect(ctx.UnmaskContext?.source).toBe("fake");
    expect(ctx.UnmaskContext?.actorType).toBe("talent");
    expect(ctx.GroupSystemPrompt).toContain("Unmask context");
    expect(ctx.GroupSystemPrompt).toContain("Talent:");
  });
});
