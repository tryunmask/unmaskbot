import type { DiscordConfig } from "./types.discord.js";
import type { GoogleChatConfig } from "./types.googlechat.js";
import type { IMessageConfig } from "./types.imessage.js";
import type { MSTeamsConfig } from "./types.msteams.js";
import type { SignalConfig } from "./types.signal.js";
import type { SlackConfig } from "./types.slack.js";
import type { TelegramConfig } from "./types.telegram.js";
import type { WhatsAppConfig } from "./types.whatsapp.js";
import type { GroupPolicy } from "./types.base.js";

export type ChannelHeartbeatVisibilityConfig = {
  /** Show HEARTBEAT_OK acknowledgments in chat (default: false). */
  showOk?: boolean;
  /** Show heartbeat alerts with actual content (default: true). */
  showAlerts?: boolean;
  /** Emit indicator events for UI status display (default: true). */
  useIndicator?: boolean;
};

export type ChannelDefaultsConfig = {
  groupPolicy?: GroupPolicy;
  /**
   * Shared allowlist entries applied across channels.
   *
   * IMPORTANT: Prefer provider-prefixed entries to avoid accidental cross-channel matches.
   * Examples: "whatsapp:+14155552671", "slack:U0123ABC", "telegram:123456789", "discord:123..."
   *
   * Use channel-specific allowlists (e.g. channels.whatsapp.allowFrom) for unprefixed IDs.
   */
  allowFrom?: Array<string | number>;
  /** Default heartbeat visibility for all channels. */
  heartbeat?: ChannelHeartbeatVisibilityConfig;
};

export type ChannelsConfig = {
  defaults?: ChannelDefaultsConfig;
  whatsapp?: WhatsAppConfig;
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
  googlechat?: GoogleChatConfig;
  slack?: SlackConfig;
  signal?: SignalConfig;
  imessage?: IMessageConfig;
  msteams?: MSTeamsConfig;
  [key: string]: unknown;
};
