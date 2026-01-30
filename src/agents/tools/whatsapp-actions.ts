import type { AgentToolResult } from "@mariozechner/pi-agent-core";

import type { MoltbotConfig } from "../../config/config.js";
import { createGroupWhatsApp, sendReactionWhatsApp } from "../../web/outbound.js";
import {
  createActionGate,
  jsonResult,
  readReactionParams,
  readStringArrayParam,
  readStringParam,
} from "./common.js";

export async function handleWhatsAppAction(
  params: Record<string, unknown>,
  cfg: MoltbotConfig,
): Promise<AgentToolResult<unknown>> {
  const action = readStringParam(params, "action", { required: true });
  const isActionEnabled = createActionGate(cfg.channels?.whatsapp?.actions);

  if (action === "react") {
    if (!isActionEnabled("reactions")) {
      throw new Error("WhatsApp reactions are disabled.");
    }
    const chatJid = readStringParam(params, "chatJid", { required: true });
    const messageId = readStringParam(params, "messageId", { required: true });
    const { emoji, remove, isEmpty } = readReactionParams(params, {
      removeErrorMessage: "Emoji is required to remove a WhatsApp reaction.",
    });
    const participant = readStringParam(params, "participant");
    const accountId = readStringParam(params, "accountId");
    const fromMeRaw = params.fromMe;
    const fromMe = typeof fromMeRaw === "boolean" ? fromMeRaw : undefined;
    const resolvedEmoji = remove ? "" : emoji;
    await sendReactionWhatsApp(chatJid, messageId, resolvedEmoji, {
      verbose: false,
      fromMe,
      participant: participant ?? undefined,
      accountId: accountId ?? undefined,
    });
    if (!remove && !isEmpty) {
      return jsonResult({ ok: true, added: emoji });
    }
    return jsonResult({ ok: true, removed: true });
  }

  if (action === "group-create") {
    if (!isActionEnabled("groupCreate")) {
      throw new Error("WhatsApp group creation is disabled.");
    }
    const subject = readStringParam(params, "subject", {
      required: true,
      label: "Group subject",
    });
    const participants =
      readStringArrayParam(params, "participants") ??
      readStringArrayParam(params, "participant", { required: true, label: "Participants" });
    const accountId = readStringParam(params, "accountId");
    const result = await createGroupWhatsApp(subject, participants, {
      verbose: false,
      accountId: accountId ?? undefined,
    });
    return jsonResult({ ok: true, ...result });
  }

  throw new Error(`Unsupported WhatsApp action: ${action}`);
}
