/**
 * Discord adapter — Tier A integration via discord.js Bot API.
 *
 * Implements the unified MessagingClient interface for Discord.
 * Uses discord.js v14 which manages its own WebSocket gateway connection,
 * rate limiting, and caching internally.
 *
 * Prerequisites:
 * - A bot token from the Discord Developer Portal
 * - Privileged intents (MessageContent, GuildMembers, GuildPresences) must
 *   be enabled in the portal if used
 *
 * Capabilities (per PRD):
 * - Text, images, video, audio, files, reactions, replies
 * - Typing indicators, embeds, slash commands (via discord.js directly)
 * - No voice notes (sent as audio files)
 * - No native location (sent as embed with map link)
 * - No read receipts (Discord bots cannot send/receive them)
 * - No payments
 */
import {
  AttachmentBuilder,
  Client,
  ChannelType,
  SnowflakeUtil,
} from "discord.js";
import type {
  Message as DMessage,
  SendableChannels,
} from "discord.js";
import type {
  Conversation,
  Message,
  MessageContent,
  MessagingClient,
  MessagingClientEvents,
  MessagingEventName,
} from "@chat-framework/core";
import type { DiscordAdapterConfig } from "./types.js";
import { DEFAULT_INTENTS, DEFAULT_PARTIALS } from "./types.js";
import {
  mapDiscordUser,
  mapDiscordChannelToConversation,
  mapDiscordMessage,
  mapDiscordReaction,
  mapPartialDiscordMessage,
} from "./mapper.js";

/**
 * Discord adapter implementing the unified MessagingClient.
 *
 * @example
 * ```typescript
 * const discord = new DiscordAdapter({ token: "BOT_TOKEN" });
 * discord.on("message", (msg) => console.log(msg));
 * await discord.connect();
 * ```
 */
export class DiscordAdapter implements MessagingClient {
  private readonly client: Client;
  private readonly config: DiscordAdapterConfig;
  private connected = false;

  private readonly listeners = new Map<
    MessagingEventName,
    Set<(...args: unknown[]) => void>
  >();

  constructor(config: DiscordAdapterConfig) {
    this.config = config;
    this.client = new Client({
      intents: config.intents ?? DEFAULT_INTENTS,
      partials: DEFAULT_PARTIALS,
    });
    this.wireDiscordEvents();
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error("DiscordAdapter is already connected");
    }
    await this.client.login(this.config.token);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.client.destroy();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.client.isReady();
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  async sendText(conversation: Conversation, text: string): Promise<Message> {
    this.assertConnected();
    const channel = await this.resolveChannel(conversation);
    const sent = await channel.send({ content: text });
    return mapDiscordMessage(sent);
  }

  async sendImage(
    conversation: Conversation,
    image: Buffer | string,
    caption?: string,
  ): Promise<Message> {
    this.assertConnected();
    const channel = await this.resolveChannel(conversation);
    const attachment = new AttachmentBuilder(image, { name: "image.png" });
    const sent = await channel.send({
      content: caption ?? undefined,
      files: [attachment],
    });
    return mapDiscordMessage(sent);
  }

  async sendAudio(
    conversation: Conversation,
    audio: Buffer | string,
  ): Promise<Message> {
    this.assertConnected();
    const channel = await this.resolveChannel(conversation);
    const attachment = new AttachmentBuilder(audio, { name: "audio.mp3" });
    const sent = await channel.send({ files: [attachment] });
    return mapDiscordMessage(sent);
  }

  async sendVoice(
    conversation: Conversation,
    voice: Buffer | string,
  ): Promise<Message> {
    // Discord has no native voice note message type.
    // Degrade gracefully by sending as a regular audio file.
    return this.sendAudio(conversation, voice);
  }

  async sendFile(
    conversation: Conversation,
    file: Buffer | string,
    filename: string,
  ): Promise<Message> {
    this.assertConnected();
    const channel = await this.resolveChannel(conversation);
    const attachment = new AttachmentBuilder(file, { name: filename });
    const sent = await channel.send({ files: [attachment] });
    return mapDiscordMessage(sent);
  }

  async sendLocation(
    conversation: Conversation,
    lat: number,
    lng: number,
  ): Promise<Message> {
    this.assertConnected();
    const channel = await this.resolveChannel(conversation);
    const url = `https://maps.google.com/?q=${lat},${lng}`;
    const sent = await channel.send({
      embeds: [
        {
          title: "Location",
          description: `${lat}, ${lng}`,
          url,
        },
      ],
    });

    // Return with unified location content type, not the raw embed
    return {
      id: sent.id,
      conversation: mapDiscordChannelToConversation(sent.channel),
      sender: mapDiscordUser(sent.author),
      timestamp: sent.createdAt,
      content: { type: "location", lat, lng },
    };
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  on<E extends MessagingEventName>(
    event: E,
    handler: MessagingClientEvents[E],
  ): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (...args: unknown[]) => void);
  }

  off<E extends MessagingEventName>(
    event: E,
    handler: MessagingClientEvents[E],
  ): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  // ── Interactions ────────────────────────────────────────────────────────────

  async react(message: Message, emoji: string): Promise<void> {
    this.assertConnected();
    const channel = await this.resolveChannel(message.conversation);
    const discordMsg = await channel.messages.fetch(message.id);
    await discordMsg.react(emoji);
  }

  async reply(message: Message, content: MessageContent): Promise<Message> {
    this.assertConnected();
    const channel = await this.resolveChannel(message.conversation);
    const discordMsg = await channel.messages.fetch(message.id);

    const payload = this.buildSendPayload(content);
    const sent = await discordMsg.reply(payload);
    return mapDiscordMessage(sent);
  }

  async forward(message: Message, to: Conversation): Promise<Message> {
    this.assertConnected();

    // Discord has no native forwarding. Re-send the content.
    if (message.content.type === "text") {
      return this.sendText(to, message.content.text);
    }

    // For non-text content, send a labeled text representation.
    // A more sophisticated version could re-download and re-attach media,
    // but that adds complexity and potential failure modes.
    const channel = await this.resolveChannel(to);
    const sent = await channel.send({
      content: `[Forwarded] ${message.content.type} message`,
    });
    return mapDiscordMessage(sent);
  }

  async delete(message: Message): Promise<void> {
    this.assertConnected();
    const channel = await this.resolveChannel(message.conversation);
    const discordMsg = await channel.messages.fetch(message.id);
    await discordMsg.delete();
  }

  // ── Presence ────────────────────────────────────────────────────────────────

  async setTyping(conversation: Conversation, _duration?: number): Promise<void> {
    this.assertConnected();
    const channel = await this.resolveChannel(conversation);
    await channel.sendTyping();
    // Discord typing indicators last ~10 seconds.
    // For long durations callers would need to call this repeatedly.
  }

  async markRead(_message: Message): Promise<void> {
    // Discord bots do not support read receipts. No-op.
  }

  // ── Conversations ───────────────────────────────────────────────────────────

  async getConversations(): Promise<Conversation[]> {
    this.assertConnected();
    const conversations: Conversation[] = [];

    // Guild channels
    for (const [, guild] of this.client.guilds.cache) {
      if (
        this.config.guildFilter?.length &&
        !this.config.guildFilter.includes(guild.id)
      ) {
        continue;
      }
      const channels = await guild.channels.fetch();
      for (const [, channel] of channels) {
        if (channel && channel.isTextBased()) {
          conversations.push(mapDiscordChannelToConversation(channel));
        }
      }
    }

    // DM channels from cache
    for (const [, channel] of this.client.channels.cache) {
      if (
        channel.type === ChannelType.DM ||
        channel.type === ChannelType.GroupDM
      ) {
        conversations.push(mapDiscordChannelToConversation(channel));
      }
    }

    return conversations;
  }

  async getMessages(
    conversation: Conversation,
    limit = 50,
    before?: Date,
  ): Promise<Message[]> {
    this.assertConnected();
    const channel = await this.resolveChannel(conversation);

    const options: { limit: number; before?: string } = { limit };
    if (before) {
      // Convert Date to Discord snowflake for cursor-based pagination.
      // Discord snowflake = (timestamp - DISCORD_EPOCH) << 22
      options.before = String(SnowflakeUtil.generate({ timestamp: before.getTime() }));
    }

    const messages = await channel.messages.fetch(options);
    return [...messages.values()].map((msg) => mapDiscordMessage(msg));
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("DiscordAdapter is not connected");
    }
  }

  /**
   * Fetch a text-based channel by conversation ID.
   * Throws if the channel doesn't exist or isn't text-based.
   */
  private async resolveChannel(conversation: Conversation): Promise<SendableChannels> {
    const channel = await this.client.channels.fetch(conversation.id);
    if (!channel || !channel.isSendable()) {
      throw new Error(
        `Channel ${conversation.id} is not a sendable channel or does not exist`,
      );
    }
    return channel;
  }

  /**
   * Convert a unified MessageContent into discord.js send options.
   */
  private buildSendPayload(
    content: MessageContent,
  ): { content?: string; files?: AttachmentBuilder[]; embeds?: object[] } {
    switch (content.type) {
      case "text":
        return { content: content.text };
      case "image": {
        const file = new AttachmentBuilder(content.url, { name: "image.png" });
        return { content: content.caption ?? undefined, files: [file] };
      }
      case "video": {
        const file = new AttachmentBuilder(content.url, { name: "video.mp4" });
        return { content: content.caption ?? undefined, files: [file] };
      }
      case "audio": {
        const file = new AttachmentBuilder(content.url, { name: "audio.mp3" });
        return { files: [file] };
      }
      case "voice": {
        const file = new AttachmentBuilder(content.url, { name: "voice.ogg" });
        return { files: [file] };
      }
      case "file": {
        const file = new AttachmentBuilder(content.url, { name: content.filename });
        return { files: [file] };
      }
      case "location": {
        const url = `https://maps.google.com/?q=${content.lat},${content.lng}`;
        return {
          embeds: [{ title: "Location", description: `${content.lat}, ${content.lng}`, url }],
        };
      }
      case "sticker":
        return { content: `[Sticker: ${content.id}]` };
      case "contact":
        return { content: `[Contact: ${content.name} — ${content.phone}]` };
      case "link":
        return { content: content.url };
      default:
        return { content: "[Unsupported content]" };
    }
  }

  // ── Emit / Event wiring ───────────────────────────────────────────────────

  private emitting = false;

  private emit<E extends MessagingEventName>(
    event: E,
    ...args: Parameters<MessagingClientEvents[E]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;

    const wasEmitting = this.emitting;
    this.emitting = true;
    try {
      for (const handler of set) {
        try {
          handler(...args);
        } catch (err) {
          // Guard against infinite recursion: if we're already emitting
          // (e.g., an error listener threw), don't re-emit error.
          if (!wasEmitting) {
            this.emit("error", err instanceof Error ? err : new Error(String(err)));
          }
        }
      }
    } finally {
      this.emitting = wasEmitting;
    }
  }

  /**
   * Wire discord.js client events to the unified event system.
   * Called once from the constructor.
   */
  private wireDiscordEvents(): void {
    const selfId = () => this.client.user?.id;

    // ── message ───────────────────────────────────────────────────────
    this.client.on("messageCreate", (msg: DMessage) => {
      // Skip bot's own messages
      if (msg.author.id === selfId()) return;

      // Guild filter
      if (
        msg.guild &&
        this.config.guildFilter?.length &&
        !this.config.guildFilter.includes(msg.guild.id)
      ) {
        return;
      }

      this.emit("message", mapDiscordMessage(msg));
    });

    // ── reaction ──────────────────────────────────────────────────────
    this.client.on("messageReactionAdd", async (reaction, user) => {
      try {
        // Fetch partials if needed
        const fullReaction = reaction.partial ? await reaction.fetch() : reaction;
        const fullUser = user.partial ? await user.fetch() : user;

        if (fullUser.id === selfId()) return;

        const unifiedReaction = mapDiscordReaction(fullReaction, fullUser);
        const unifiedMsg = fullReaction.message.partial
          ? mapPartialDiscordMessage(fullReaction.message)
          : mapDiscordMessage(fullReaction.message as DMessage);

        this.emit("reaction", unifiedReaction, unifiedMsg);
      } catch (err) {
        // Partial fetch can fail if the message was deleted
        this.emit(
          "error",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    });

    // ── typing ────────────────────────────────────────────────────────
    this.client.on("typingStart", (typing) => {
      if (typing.user.id === selfId()) return;

      const user = mapDiscordUser(typing.user);
      const conversation = mapDiscordChannelToConversation(typing.channel);
      this.emit("typing", user, conversation);
    });

    // ── presence ──────────────────────────────────────────────────────
    this.client.on("presenceUpdate", (_oldPresence, newPresence) => {
      if (!newPresence?.user) return;

      const user = mapDiscordUser(newPresence.user);
      const status = newPresence.status === "offline" ? "offline" : "online";
      this.emit("presence", user, status);
    });

    // ── errors ────────────────────────────────────────────────────────
    this.client.on("error", (error) => {
      this.emit("error", error);
    });

    this.client.on("warn", (warning) => {
      this.emit("error", new Error(`Discord warning: ${warning}`));
    });
  }
}
