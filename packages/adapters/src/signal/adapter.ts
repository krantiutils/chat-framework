/**
 * Signal adapter — Tier D integration via signal-cli JSON-RPC.
 *
 * Implements the unified MessagingClient interface for Signal Messenger.
 * Under the hood, it manages a signal-cli subprocess in JSON-RPC mode,
 * translating between the framework's message types and Signal's protocol.
 *
 * Prerequisites:
 * - signal-cli must be installed and accessible on PATH (or specify signalCliBin)
 * - Phone number must already be registered with signal-cli (`signal-cli -a NUM register/verify`)
 *
 * Capabilities (per PRD):
 * - Text messages, media (images, audio, video, files), reactions, groups
 * - Voice notes, location, contacts
 * - Typing indicators, read receipts
 * - No inline keyboards (not supported by Signal)
 * - No payments (not supported by Signal)
 */
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
  mapSignalConversation,
  mapSignalEnvelopeToMessage,
  mapSignalReaction,
  mapSignalUser,
} from "./mapper.js";
import { SignalCliProcess } from "./process.js";
import type { SignalAdapterConfig, SignalEnvelope, SignalSendResult } from "./types.js";

/** Default base path for signal-cli attachments (matches signal-cli default data dir). */
const DEFAULT_ATTACHMENT_BASE = "file://" + join(
  process.env.HOME ?? "/tmp",
  ".local/share/signal-cli/attachments",
);

/**
 * Signal adapter implementing the unified MessagingClient.
 *
 * @example
 * ```typescript
 * const signal = new SignalAdapter({ phoneNumber: "+1234567890" });
 * signal.on("message", (msg) => console.log(msg));
 * await signal.connect();
 * ```
 */
export class SignalAdapter implements MessagingClient {
  private readonly cli: SignalCliProcess;
  private readonly phoneNumber: string;
  private readonly attachmentBaseUrl: string;
  private connected = false;
  private tempDir: string | null = null;

  private readonly listeners = new Map<
    MessagingEventName,
    Set<(...args: unknown[]) => void>
  >();

  constructor(config: SignalAdapterConfig) {
    this.phoneNumber = config.phoneNumber;
    this.attachmentBaseUrl = config.dataDir
      ? `file://${config.dataDir}/attachments`
      : DEFAULT_ATTACHMENT_BASE;
    this.cli = new SignalCliProcess(config);
    this.cli.onEnvelope((env) => this.handleEnvelope(env));
    this.cli.onError((err) => this.emit("error", err));
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error("SignalAdapter is already connected");
    }
    this.tempDir = await mkdtemp(join(tmpdir(), "signal-adapter-"));
    this.cli.start();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.cli.stop();
    this.connected = false;
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
      this.tempDir = null;
    }
  }

  isConnected(): boolean {
    return this.connected && this.cli.running;
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  async sendText(conversation: Conversation, text: string): Promise<Message> {
    this.assertConnected();

    const params = this.buildSendParams(conversation);
    params.message = text;

    const result = (await this.cli.request("send", params)) as SignalSendResult;
    return this.buildSentMessage(conversation, { type: "text", text }, result);
  }

  async sendImage(
    conversation: Conversation,
    image: Buffer | string,
    caption?: string,
  ): Promise<Message> {
    this.assertConnected();

    const filePath = await this.resolveAttachment(image);
    const params = this.buildSendParams(conversation);
    if (caption) params.message = caption;
    params.attachments = [filePath];

    const result = (await this.cli.request("send", params)) as SignalSendResult;
    const content: MessageContent = {
      type: "image",
      url: filePath,
      caption,
    };
    return this.buildSentMessage(conversation, content, result);
  }

  async sendAudio(
    conversation: Conversation,
    audio: Buffer | string,
  ): Promise<Message> {
    this.assertConnected();

    const filePath = await this.resolveAttachment(audio);
    const params = this.buildSendParams(conversation);
    params.attachments = [filePath];

    const result = (await this.cli.request("send", params)) as SignalSendResult;
    const content: MessageContent = {
      type: "audio",
      url: filePath,
      duration: 0,
    };
    return this.buildSentMessage(conversation, content, result);
  }

  async sendVoice(
    conversation: Conversation,
    voice: Buffer | string,
  ): Promise<Message> {
    this.assertConnected();

    const filePath = await this.resolveAttachment(voice);
    const params = this.buildSendParams(conversation);
    params.attachments = [filePath];

    const result = (await this.cli.request("send", params)) as SignalSendResult;
    const content: MessageContent = {
      type: "voice",
      url: filePath,
      duration: 0,
    };
    return this.buildSentMessage(conversation, content, result);
  }

  async sendFile(
    conversation: Conversation,
    file: Buffer | string,
    filename: string,
  ): Promise<Message> {
    this.assertConnected();

    const filePath = await this.resolveAttachment(file, filename);
    const params = this.buildSendParams(conversation);
    params.attachments = [filePath];

    const result = (await this.cli.request("send", params)) as SignalSendResult;
    const content: MessageContent = {
      type: "file",
      url: filePath,
      filename,
      size: typeof file === "string" ? 0 : file.length,
    };
    return this.buildSentMessage(conversation, content, result);
  }

  async sendLocation(
    conversation: Conversation,
    lat: number,
    lng: number,
  ): Promise<Message> {
    this.assertConnected();

    // Signal doesn't have a native location message type.
    // Send as a Google Maps link, which is the common workaround.
    const url = `https://maps.google.com/?q=${lat},${lng}`;
    const text = `Location: ${lat}, ${lng}\n${url}`;

    const params = this.buildSendParams(conversation);
    params.message = text;

    const result = (await this.cli.request("send", params)) as SignalSendResult;
    return this.buildSentMessage(
      conversation,
      { type: "location", lat, lng },
      result,
    );
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

    const params: Record<string, unknown> = {
      recipient: [message.conversation.id],
      emoji,
      targetAuthor: message.sender.id,
      targetTimestamp: message.timestamp.getTime(),
    };

    if (message.conversation.type === "group") {
      params.groupId = message.conversation.id;
      delete params.recipient;
    }

    await this.cli.request("sendReaction", params);
  }

  async reply(message: Message, content: MessageContent): Promise<Message> {
    this.assertConnected();

    const params = this.buildSendParams(message.conversation);
    params.quoteTimestamp = message.timestamp.getTime();
    params.quoteAuthor = message.sender.id;

    if (content.type === "text") {
      params.message = content.text;
    } else {
      // For non-text replies, send the text portion if available
      params.message = "caption" in content ? (content.caption ?? "") : "";
    }

    const result = (await this.cli.request("send", params)) as SignalSendResult;
    return this.buildSentMessage(message.conversation, content, result);
  }

  async forward(message: Message, to: Conversation): Promise<Message> {
    this.assertConnected();

    // Signal doesn't have native forwarding.
    // Re-send the content to the target conversation.
    if (message.content.type === "text") {
      return this.sendText(to, message.content.text);
    }

    // For other content types, send as text representation
    const params = this.buildSendParams(to);
    params.message = `[Forwarded] ${message.content.type}`;
    const result = (await this.cli.request("send", params)) as SignalSendResult;
    return this.buildSentMessage(to, message.content, result);
  }

  async delete(message: Message): Promise<void> {
    this.assertConnected();

    const params: Record<string, unknown> = {
      targetTimestamp: message.timestamp.getTime(),
    };

    if (message.conversation.type === "group") {
      params.groupId = message.conversation.id;
    } else {
      params.recipient = [message.conversation.id];
    }

    await this.cli.request("remoteDelete", params);
  }

  // ── Presence ────────────────────────────────────────────────────────────────

  async setTyping(conversation: Conversation, _duration?: number): Promise<void> {
    this.assertConnected();

    const params: Record<string, unknown> = {};
    if (conversation.type === "group") {
      params.groupId = conversation.id;
    } else {
      params.recipient = conversation.id;
    }

    await this.cli.request("sendTyping", params);
  }

  async markRead(message: Message): Promise<void> {
    this.assertConnected();

    await this.cli.request("sendReceipt", {
      recipient: message.sender.id,
      targetTimestamp: [message.timestamp.getTime()],
      type: "read",
    });
  }

  // ── Conversations ───────────────────────────────────────────────────────────

  async getConversations(): Promise<Conversation[]> {
    this.assertConnected();

    const result = (await this.cli.request("listGroups")) as unknown[];
    const groups: Conversation[] = [];

    if (Array.isArray(result)) {
      for (const g of result) {
        const group = g as Record<string, unknown>;
        groups.push({
          id: (group.id as string) ?? (group.groupId as string) ?? "",
          platform: "signal",
          participants: [],
          type: "group",
          metadata: { name: group.name },
        });
      }
    }

    return groups;
  }

  async getMessages(
    _conversation: Conversation,
    _limit?: number,
    _before?: Date,
  ): Promise<Message[]> {
    // signal-cli does not support fetching message history.
    // Messages are only available via real-time receive.
    return [];
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("SignalAdapter is not connected");
    }
  }

  /**
   * Resolve an attachment to a file path. signal-cli expects file paths,
   * not raw data. If a Buffer is passed, write it to a temp file first.
   */
  private async resolveAttachment(
    data: Buffer | string,
    filename?: string,
  ): Promise<string> {
    if (typeof data === "string") return data;

    if (!this.tempDir) {
      throw new Error("No temp directory available (adapter not connected)");
    }
    const name = filename ?? randomUUID();
    const path = join(this.tempDir, name);
    await writeFile(path, data);
    return path;
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

  private handleEnvelope(envelope: SignalEnvelope): void {
    // Typing indicators
    if (envelope.typingMessage) {
      const source = envelope.sourceNumber ?? envelope.source ?? "";
      if (source && envelope.typingMessage.action === "STARTED") {
        const user = mapSignalUser(source, envelope.sourceName);
        const conversation = mapSignalConversation(envelope, this.phoneNumber);
        this.emit("typing", user, conversation);
      }
      return;
    }

    // Read receipts
    if (envelope.receiptMessage?.type === "READ") {
      const source = envelope.sourceNumber ?? envelope.source ?? "";
      if (source) {
        const user = mapSignalUser(source, envelope.sourceName);
        // Emit read event for each timestamp
        for (const ts of envelope.receiptMessage.timestamps ?? []) {
          const stubMsg: Message = {
            id: String(ts),
            conversation: {
              id: source,
              platform: "signal",
              participants: [],
              type: "dm",
              metadata: {},
            },
            sender: mapSignalUser(this.phoneNumber),
            timestamp: new Date(ts),
            content: { type: "text", text: "" },
          };
          this.emit("read", user, stubMsg);
        }
      }
      return;
    }

    // Sync messages (sent from another linked device)
    if (envelope.syncMessage?.sentMessage) {
      const sent = envelope.syncMessage.sentMessage;
      const dest = sent.destinationNumber ?? sent.destination ?? "";
      const syntheticEnvelope: SignalEnvelope = {
        sourceNumber: this.phoneNumber,
        timestamp: sent.timestamp,
        dataMessage: {
          timestamp: sent.timestamp,
          message: sent.message,
          groupInfo: sent.groupInfo,
          attachments: sent.attachments,
        },
      };
      const message = mapSignalEnvelopeToMessage(
        syntheticEnvelope,
        this.phoneNumber,
        this.attachmentBaseUrl,
      );
      if (message) {
        // Override conversation id to the destination for DMs
        const conv = sent.groupInfo?.groupId
          ? message.conversation
          : { ...message.conversation, id: dest };
        this.emit("message", { ...message, conversation: conv });
      }
      return;
    }

    // Reactions
    const reaction = mapSignalReaction(envelope);
    if (reaction && envelope.dataMessage?.reaction) {
      const targetTimestamp =
        envelope.dataMessage.reaction.targetSentTimestamp ?? 0;
      const targetAuthor =
        envelope.dataMessage.reaction.targetAuthorNumber ??
        envelope.dataMessage.reaction.targetAuthor ??
        "";
      const stubMsg: Message = {
        id: String(targetTimestamp),
        conversation: mapSignalConversation(envelope, this.phoneNumber),
        sender: mapSignalUser(targetAuthor),
        timestamp: new Date(targetTimestamp),
        content: { type: "text", text: "" },
      };
      this.emit("reaction", reaction, stubMsg);
      return;
    }

    // Regular messages
    const message = mapSignalEnvelopeToMessage(
      envelope,
      this.phoneNumber,
      this.attachmentBaseUrl,
    );
    if (message) {
      this.emit("message", message);
    }
  }

  private buildSendParams(conversation: Conversation): Record<string, unknown> {
    if (conversation.type === "group") {
      return { groupId: conversation.id };
    }
    return { recipient: [conversation.id] };
  }

  private buildSentMessage(
    conversation: Conversation,
    content: MessageContent,
    result: SignalSendResult,
  ): Message {
    const timestamp = result.timestamp ?? Date.now();
    return {
      id: String(timestamp),
      conversation,
      sender: mapSignalUser(this.phoneNumber),
      timestamp: new Date(timestamp),
      content,
    };
  }
}
