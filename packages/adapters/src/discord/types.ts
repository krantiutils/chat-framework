/**
 * Discord adapter configuration and constants.
 *
 * The Discord adapter is a Tier A integration using the official Bot API
 * via discord.js. No human simulation is required.
 */
import { GatewayIntentBits, Partials } from "discord.js";
import type { Snowflake } from "discord.js";

/** Configuration for the Discord adapter. */
export interface DiscordAdapterConfig {
  /**
   * Bot token from the Discord Developer Portal.
   * Required. Must have the appropriate intents enabled in the portal
   * for privileged intents (MessageContent, GuildMembers, GuildPresences).
   */
  readonly token: string;

  /**
   * Gateway intents to request.
   * If not provided, {@link DEFAULT_INTENTS} is used.
   */
  readonly intents?: GatewayIntentBits[];

  /**
   * Optional list of guild (server) snowflake IDs to restrict the adapter to.
   * When set, messages from guilds not in this list are ignored.
   * If empty or undefined, the adapter operates across all guilds.
   */
  readonly guildFilter?: readonly Snowflake[];
}

/**
 * Default gateway intents for full-featured bot operation.
 *
 * Note: MessageContent, GuildMembers, and GuildPresences are privileged
 * intents that must be explicitly enabled in the Discord Developer Portal.
 */
export const DEFAULT_INTENTS: GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildMessageTyping,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.DirectMessageReactions,
  GatewayIntentBits.DirectMessageTyping,
  GatewayIntentBits.MessageContent,
];

/**
 * Partials to enable so the client receives events for uncached objects.
 * Without these, events for uncached messages/reactions/channels are silently dropped.
 */
export const DEFAULT_PARTIALS: Partials[] = [
  Partials.Message,
  Partials.Channel,
  Partials.Reaction,
  Partials.User,
  Partials.GuildMember,
];
