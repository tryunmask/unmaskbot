import { describe, expect, it, vi } from "vitest";

import type { MoltbotConfig } from "../../config/config.js";
import { handleWhatsAppAction } from "./whatsapp-actions.js";

const sendReactionWhatsApp = vi.fn(async () => undefined);
const sendPollWhatsApp = vi.fn(async () => ({ messageId: "poll-1", toJid: "jid-1" }));
const createGroupWhatsApp = vi.fn(async () => ({ status: 200, gid: "12345@g.us" }));

vi.mock("../../web/outbound.js", () => ({
  sendReactionWhatsApp: (...args: unknown[]) => sendReactionWhatsApp(...args),
  sendPollWhatsApp: (...args: unknown[]) => sendPollWhatsApp(...args),
  createGroupWhatsApp: (...args: unknown[]) => createGroupWhatsApp(...args),
}));

const enabledConfig = {
  channels: { whatsapp: { actions: { reactions: true, groupCreate: true } } },
} as MoltbotConfig;

describe("handleWhatsAppAction", () => {
  it("adds reactions", async () => {
    await handleWhatsAppAction(
      {
        action: "react",
        chatJid: "123@s.whatsapp.net",
        messageId: "msg1",
        emoji: "✅",
      },
      enabledConfig,
    );
    expect(sendReactionWhatsApp).toHaveBeenCalledWith("123@s.whatsapp.net", "msg1", "✅", {
      verbose: false,
      fromMe: undefined,
      participant: undefined,
      accountId: undefined,
    });
  });

  it("removes reactions on empty emoji", async () => {
    await handleWhatsAppAction(
      {
        action: "react",
        chatJid: "123@s.whatsapp.net",
        messageId: "msg1",
        emoji: "",
      },
      enabledConfig,
    );
    expect(sendReactionWhatsApp).toHaveBeenCalledWith("123@s.whatsapp.net", "msg1", "", {
      verbose: false,
      fromMe: undefined,
      participant: undefined,
      accountId: undefined,
    });
  });

  it("removes reactions when remove flag set", async () => {
    await handleWhatsAppAction(
      {
        action: "react",
        chatJid: "123@s.whatsapp.net",
        messageId: "msg1",
        emoji: "✅",
        remove: true,
      },
      enabledConfig,
    );
    expect(sendReactionWhatsApp).toHaveBeenCalledWith("123@s.whatsapp.net", "msg1", "", {
      verbose: false,
      fromMe: undefined,
      participant: undefined,
      accountId: undefined,
    });
  });

  it("passes account scope and sender flags", async () => {
    await handleWhatsAppAction(
      {
        action: "react",
        chatJid: "123@s.whatsapp.net",
        messageId: "msg1",
        emoji: "🎉",
        accountId: "work",
        fromMe: true,
        participant: "999@s.whatsapp.net",
      },
      enabledConfig,
    );
    expect(sendReactionWhatsApp).toHaveBeenCalledWith("123@s.whatsapp.net", "msg1", "🎉", {
      verbose: false,
      fromMe: true,
      participant: "999@s.whatsapp.net",
      accountId: "work",
    });
  });

  it("respects reaction gating", async () => {
    const cfg = {
      channels: { whatsapp: { actions: { reactions: false } } },
    } as MoltbotConfig;
    await expect(
      handleWhatsAppAction(
        {
          action: "react",
          chatJid: "123@s.whatsapp.net",
          messageId: "msg1",
          emoji: "✅",
        },
        cfg,
      ),
    ).rejects.toThrow(/WhatsApp reactions are disabled/);
  });

  it("creates groups", async () => {
    await handleWhatsAppAction(
      {
        action: "group-create",
        subject: "Study Group",
        participant: ["+1555", "+1666"],
      },
      enabledConfig,
    );
    expect(createGroupWhatsApp).toHaveBeenCalledWith("Study Group", ["+1555", "+1666"], {
      verbose: false,
      accountId: undefined,
    });
  });

  it("respects group create gating", async () => {
    const cfg = {
      channels: { whatsapp: { actions: { groupCreate: false } } },
    } as MoltbotConfig;
    await expect(
      handleWhatsAppAction(
        {
          action: "group-create",
          subject: "Study Group",
          participant: ["+1555"],
        },
        cfg,
      ),
    ).rejects.toThrow(/WhatsApp group creation is disabled/);
  });
});
