/**
 * Telegram adapter — Tier A integration via Telegraf.
 *
 * Implements the unified MessagingClient interface for Telegram.
 * Uses Telegraf (Telegram Bot Framework) under the hood, which wraps
 * the official Telegram Bot API.
 *
 * Prerequisites:
 * - A bot token from @BotFather
 *
 * Capabilities (per PRD):
 * - Text messages, images, video, audio, voice notes, files
 * - Stickers, location, contacts
 * - Reactions, replies, forwarding, message deletion
 * - Typing indicators, read receipts (limited — Telegram doesn't expose read receipts for bots)
 * - Inline keyboards (via platform metadata, not part of unified interface)
 *
 * Rate limits:
 * - 30 msg/sec to same group chat
 * - 1 msg/sec to same user in DMs
 * - 20 msg/min to same group (for sending messages, not receiving)
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { Telegraf, Input, Context } from "telegraf";
import type { InputFile } from "telegraf/types";

import type {
  Conversation,
  Message,
  MessageContent,
  MessagingClient,
  MessagingClientEvents,
  MessagingEventName,
  Reaction,
  User,
} from "@chat-framework/core";

import {
  mapTelegramConversation,
  mapTelegramMessage,
  mapTelegramReactions,
  mapTelegramUser,
} from "./mapper.js";
import type {
  TelegramAdapterConfig,
  TelegramChat,
  TelegramMessage as TgMessage,
  TelegramMessageReactionUpdated,
  TelegramUser as TgUser,
} from "./types.js";

/**
 * Telegram adapter implementing the unified MessagingClient.
 *
 * @example
 * ```typescript
 * const telegram = new TelegramAdapter({ token: "123456:ABC-DEF" });
 * telegram.on("message", (msg) => console.log(msg));
 * await telegram.connect();
 * ```
 */
export class TelegramAdapter implements MessagingClient {
  private readonly bot: Telegraf;
  private readonly config: TelegramAdapterConfig;
  private connected = false;
  private botUser: User | null = null;

  private readonly listeners = new Map<
    MessagingEventName,
    Set<(...args: unknown[]) => void>
  >();

  constructor(config: TelegramAdapterConfig) {
    this.config = config;

    const opts: Partial<Telegraf.Options<Context>> = {};
    if (config.apiRoot) {
      opts.telegram = { apiRoot: config.apiRoot };
    }

    this.bot = new Telegraf(config.token, opts);
    this.setupHandlers();
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error("TelegramAdapter is already connected");
    }

    // Fetch bot info to know our own identity
    const me = await this.bot.telegram.getMe();
    this.botUser = mapTelegramUser(me as unknown as TgUser);

    if (this.config.useWebhook && this.config.webhookDomain) {
      const launchConfig: Telegraf.LaunchOptions = {
        webhook: {
          domain: this.config.webhookDomain,
          port: this.config.webhookPort,
          secretToken: this.config.webhookSecretToken,
        },
      };
      await this.bot.launch(launchConfig);
    } else {
      const launchConfig: Telegraf.LaunchOptions = {};
      if (this.config.allowedUpdates) {
        launchConfig.allowedUpdates = [...this.config.allowedUpdates] as Telegraf.LaunchOptions["allowedUpdates"];
      }
      await this.bot.launch(launchConfig);
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.bot.stop("TelegramAdapter.disconnect");
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  async sendText(conversation: Conversation, text: string): Promise<Message> {
    this.assertConnected();
    const chatId = Number(conversation.id);
    const sent = await this.bot.telegram.sendMessage(chatId, text);
    return this.buildSentMessage(sent as unknown as TgMessage);
  }

  async sendImage(
    conversation: Conversation,
    image: Buffer | string,
    caption?: string,
  ): Promise<Message> {
    this.assertConnected();
    const chatId = Number(conversation.id);
    const source = await this.resolveInputFile(image);
    const sent = await this.bot.telegram.sendPhoto(chatId, source, {
      caption,
    });
    return this.buildSentMessage(sent as unknown as TgMessage);
  }

  async sendAudio(
    conversation: Conversation,
    audio: Buffer | string,
  ): Promise<Message> {
    this.assertConnected();
    const chatId = Number(conversation.id);
    const source = await this.resolveInputFile(audio);
    const sent = await this.bot.telegram.sendAudio(chatId, source);
    return this.buildSentMessage(sent as unknown as TgMessage);
  }

  async sendVoice(
    conversation: Conversation,
    voice: Buffer | string,
  ): Promise<Message> {
    this.assertConnected();
    const chatId = Number(conversation.id);
    const source = await this.resolveInputFile(voice);
    const sent = await this.bot.telegram.sendVoice(chatId, source);
    return this.buildSentMessage(sent as unknown as TgMessage);
  }

  async sendFile(
    conversation: Conversation,
    file: Buffer | string,
    filename: string,
  ): Promise<Message> {
    this.assertConnected();
    const chatId = Number(conversation.id);
    const source = await this.resolveInputFile(file, filename);
    const sent = await this.bot.telegram.sendDocument(chatId, source);
    return this.buildSentMessage(sent as unknown as TgMessage);
  }

  async sendLocation(
    conversation: Conversation,
    lat: number,
    lng: number,
  ): Promise<Message> {
    this.assertConnected();
    const chatId = Number(conversation.id);
    const sent = await this.bot.telegram.sendLocation(chatId, lat, lng);
    return this.buildSentMessage(sent as unknown as TgMessage);
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
    const chatId = Number(message.conversation.id);
    const msgId = Number(message.id);
    await this.bot.telegram.setMessageReaction(
      chatId,
      msgId,
      [{ type: "emoji", emoji: emoji as never }],
    );
  }

  async reply(message: Message, content: MessageContent): Promise<Message> {
    this.assertConnected();
    const chatId = Number(message.conversation.id);
    const replyParams = { reply_parameters: { message_id: Number(message.id) } };

    const sent = await this.sendContent(chatId, content, replyParams);
    return this.buildSentMessage(sent as unknown as TgMessage);
  }

  async forward(message: Message, to: Conversation): Promise<Message> {
    this.assertConnected();
    const fromChatId = Number(message.conversation.id);
    const toChatId = Number(to.id);
    const sent = await this.bot.telegram.forwardMessage(
      toChatId,
      fromChatId,
      Number(message.id),
    );
    return this.buildSentMessage(sent as unknown as TgMessage);
  }

  async delete(message: Message): Promise<void> {
    this.assertConnected();
    const chatId = Number(message.conversation.id);
    await this.bot.telegram.deleteMessage(chatId, Number(message.id));
  }

  // ── Presence ────────────────────────────────────────────────────────────────

  async setTyping(conversation: Conversation, _duration?: number): Promise<void> {
    this.assertConnected();
    const chatId = Number(conversation.id);
    await this.bot.telegram.sendChatAction(chatId, "typing");
  }

  async markRead(_message: Message): Promise<void> {
    // Telegram Bot API does not support marking messages as read.
    // Bots automatically mark messages as read when they process updates.
    // This is a no-op for Telegram.
  }

  // ── Conversations ───────────────────────────────────────────────────────────

  async getConversations(): Promise<Conversation[]> {
    this.assertConnected();
    // Telegram Bot API does not provide a "list all chats" endpoint.
    // Bots only know about chats they've received messages from.
    // Return empty — consumers should track conversations from incoming events.
    return [];
  }

  async getMessages(
    conversation: Conversation,
    _limit?: number,
    _before?: Date,
  ): Promise<Message[]> {
    this.assertConnected();
    // Telegram Bot API does not support fetching message history.
    // Messages are only available via real-time updates.
    void conversation;
    return [];
  }

  // ── Internal: Handler setup ─────────────────────────────────────────────────

  private setupHandlers(): void {
    // Incoming messages (text, photo, audio, video, document, voice, etc.)
    this.bot.on("message", (ctx) => {
      const tgMsg = ctx.message as unknown as TgMessage;
      const message = mapTelegramMessage(tgMsg);
      if (message) {
        this.emit("message", message);
      }
    });

    // Edited messages — treat as new message events
    this.bot.on("edited_message", (ctx) => {
      const tgMsg = ctx.editedMessage as unknown as TgMessage;
      const message = mapTelegramMessage(tgMsg);
      if (message) {
        this.emit("message", message);
      }
    });

    // Channel posts
    this.bot.on("channel_post", (ctx) => {
      const tgMsg = ctx.channelPost as unknown as TgMessage;
      const message = mapTelegramMessage(tgMsg);
      if (message) {
        this.emit("message", message);
      }
    });

    // Reactions — Telegraf exposes this as "message_reaction"
    this.bot.on("message_reaction" as never, (ctx: Record<string, unknown>) => {
      const update =
        (ctx as Record<string, unknown>).messageReaction ??
        ((ctx as Record<string, Record<string, unknown>>).update)?.message_reaction;
      if (!update) return;

      const tgReaction = update as unknown as TelegramMessageReactionUpdated;
      const reactions = mapTelegramReactions(tgReaction);
      if (reactions.length === 0) return;

      const conversation = mapTelegramConversation(
        tgReaction.chat as unknown as TelegramChat,
      );

      // Build a stub message reference for the reacted-to message
      const stubMsg: Message = {
        id: String(tgReaction.message_id),
        conversation,
        sender: reactions[0].user,
        timestamp: new Date(tgReaction.date * 1000),
        content: { type: "text", text: "" },
      };

      for (const reaction of reactions) {
        this.emit("reaction", reaction, stubMsg);
      }
    });

    // Catch bot-level errors
    this.bot.catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit("error", error);
    });
  }

  // ── Internal: Helpers ─────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("TelegramAdapter is not connected");
    }
  }

  /**
   * Resolve a Buffer or file path string into a Telegraf Input source.
   * - Buffer: wrap in Input.fromBuffer
   * - String starting with http:// or https://: wrap in Input.fromURL
   * - String (file path): read file, wrap in Input.fromBuffer
   */
  private async resolveInputFile(
    data: Buffer | string,
    filename?: string,
  ): Promise<string | InputFile> {
    if (Buffer.isBuffer(data)) {
      return Input.fromBuffer(data, filename);
    }

    if (data.startsWith("http://") || data.startsWith("https://")) {
      return Input.fromURL(data);
    }

    // Local file path — read into buffer
    const fileData = await readFile(data);
    const name = filename ?? basename(data);
    return Input.fromBuffer(fileData, name);
  }

  /**
   * Send content of any type to a chat. Used by reply() to send
   * the correct media type with reply_parameters.
   */
  private async sendContent(
    chatId: number,
    content: MessageContent,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    switch (content.type) {
      case "text":
        return this.bot.telegram.sendMessage(chatId, content.text, extra);

      case "image":
        return this.bot.telegram.sendPhoto(chatId, content.url, {
          ...extra,
          caption: content.caption,
        });

      case "video":
        return this.bot.telegram.sendVideo(chatId, content.url, {
          ...extra,
          caption: content.caption,
        });

      case "audio":
        return this.bot.telegram.sendAudio(chatId, content.url, extra);

      case "voice":
        return this.bot.telegram.sendVoice(chatId, content.url, extra);

      case "file":
        return this.bot.telegram.sendDocument(chatId, content.url, extra);

      case "location":
        return this.bot.telegram.sendLocation(chatId, content.lat, content.lng, extra);

      case "contact":
        return this.bot.telegram.sendContact(chatId, content.phone, content.name, extra);

      case "sticker":
        return this.bot.telegram.sendSticker(chatId, content.id, extra);

      case "link":
        return this.bot.telegram.sendMessage(chatId, content.url, extra);

      default:
        throw new Error(`Unsupported content type: ${(content as { type: string }).type}`);
    }
  }

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
   * Convert a sent Telegram message into the unified Message type.
   * Uses bot identity as the sender.
   */
  private buildSentMessage(sent: TgMessage): Message {
    const mapped = mapTelegramMessage(sent);
    if (mapped) return mapped;

    // Fallback: construct manually if mapper returns undefined
    return {
      id: String(sent.message_id),
      conversation: mapTelegramConversation(sent.chat as unknown as TelegramChat),
      sender: this.botUser ?? { id: "unknown", platform: "telegram" },
      timestamp: new Date(sent.date * 1000),
      content: { type: "text", text: sent.text ?? "" },
    };
  }
}
