/**
 * WhatsApp adapter — Tier B integration via Baileys.
 *
 * Implements the unified MessagingClient interface for WhatsApp using
 * the @whiskeysockets/baileys library, which speaks the WhatsApp Web
 * multi-device protocol directly (no browser needed).
 *
 * Prerequisites:
 * - Caller must provide an AuthenticationState (e.g. from useMultiFileAuthState)
 * - First connection requires QR code scanning or pairing code
 * - Session must be persisted between restarts via the saveCreds callback
 *
 * Capabilities (per PRD section 2.2, 4.3):
 * - Text, images, video, audio, voice notes, files, location, contacts, stickers
 * - Reactions, replies, forwarding, message deletion
 * - Typing indicators ("composing"), read receipts
 * - Group and DM conversations
 * - No inline keyboards (WhatsApp has limited list/button support)
 * - No payments
 *
 * Risks:
 * - Account ban if detected as bot
 * - Occasional protocol breaks when WhatsApp updates
 * - Human simulation: Light touch — realistic typing delays, read receipt timing
 */
import makeWASocket, {
  DisconnectReason,
  isJidGroup,
  type AnyMessageContent,
  type BaileysEventMap,
  type ConnectionState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";

import type {
  Conversation,
  Message,
  MessageContent,
  MessagingClient,
  MessagingClientEvents,
  MessagingEventName,
} from "@chat-framework/core";

import {
  buildReactionTargetStub,
  mapWhatsAppConversation,
  mapWhatsAppMessage,
  mapWhatsAppReaction,
  mapWhatsAppUser,
} from "./mapper.js";
import type { WhatsAppAdapterConfig } from "./types.js";

/**
 * WhatsApp adapter implementing the unified MessagingClient.
 *
 * @example
 * ```typescript
 * import { useMultiFileAuthState } from "@whiskeysockets/baileys";
 *
 * const { state, saveCreds } = await useMultiFileAuthState("./auth");
 * const wa = new WhatsAppAdapter({ auth: state, saveCreds, printQrInTerminal: true });
 * wa.on("message", (msg) => console.log(msg));
 * await wa.connect();
 * ```
 */
export class WhatsAppAdapter implements MessagingClient {
  private socket: WASocket | null = null;
  private connected = false;
  private selfJid = "";
  private readonly config: WhatsAppAdapterConfig;

  private readonly listeners = new Map<
    MessagingEventName,
    Set<(...args: unknown[]) => void>
  >();

  /** Active typing pause timers — cleared on disconnect. */
  private readonly typingTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(config: WhatsAppAdapterConfig) {
    this.config = config;
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error("WhatsAppAdapter is already connected");
    }

    const sock = makeWASocket({
      auth: this.config.auth,
      printQRInTerminal: this.config.printQrInTerminal ?? false,
      markOnlineOnConnect: this.config.markOnlineOnConnect ?? false,
      browser: this.config.browser
        ? [...this.config.browser]
        : ["Ubuntu", "Chrome", "22.04"],
      getMessage: this.config.getMessage ?? (async () => undefined),
    });

    this.socket = sock;
    this.bindEvents(sock);

    // Wait for connection to open
    await this.waitForConnection(
      sock,
      this.config.connectTimeoutMs ?? 60_000,
    );
  }

  async disconnect(): Promise<void> {
    if (!this.connected && !this.socket) return;

    // Clear any pending typing-pause timers
    for (const timer of this.typingTimers) {
      clearTimeout(timer);
    }
    this.typingTimers.clear();

    const sock = this.socket;
    this.socket = null;
    this.connected = false;
    this.selfJid = "";

    if (sock) {
      sock.ev.removeAllListeners("connection.update");
      sock.ev.removeAllListeners("messages.upsert");
      sock.ev.removeAllListeners("messages.reaction");
      sock.ev.removeAllListeners("message-receipt.update");
      sock.ev.removeAllListeners("presence.update");
      sock.ev.removeAllListeners("creds.update");
      sock.end(undefined);
    }
  }

  isConnected(): boolean {
    return this.connected && this.socket !== null;
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  async sendText(conversation: Conversation, text: string): Promise<Message> {
    return this.sendMsg(conversation, { text });
  }

  async sendImage(
    conversation: Conversation,
    image: Buffer | string,
    caption?: string,
  ): Promise<Message> {
    const content: AnyMessageContent = typeof image === "string"
      ? { image: { url: image }, caption }
      : { image, caption };
    return this.sendMsg(conversation, content);
  }

  async sendAudio(
    conversation: Conversation,
    audio: Buffer | string,
  ): Promise<Message> {
    const content: AnyMessageContent = typeof audio === "string"
      ? { audio: { url: audio }, ptt: false }
      : { audio, ptt: false };
    return this.sendMsg(conversation, content);
  }

  async sendVoice(
    conversation: Conversation,
    voice: Buffer | string,
  ): Promise<Message> {
    const content: AnyMessageContent = typeof voice === "string"
      ? { audio: { url: voice }, ptt: true }
      : { audio: voice, ptt: true };
    return this.sendMsg(conversation, content);
  }

  async sendFile(
    conversation: Conversation,
    file: Buffer | string,
    filename: string,
  ): Promise<Message> {
    const content: AnyMessageContent = typeof file === "string"
      ? { document: { url: file }, mimetype: "application/octet-stream", fileName: filename }
      : { document: file, mimetype: "application/octet-stream", fileName: filename };
    return this.sendMsg(conversation, content);
  }

  async sendLocation(
    conversation: Conversation,
    lat: number,
    lng: number,
  ): Promise<Message> {
    return this.sendMsg(conversation, {
      location: { degreesLatitude: lat, degreesLongitude: lng },
    });
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

    await this.socket!.sendMessage(message.conversation.id, {
      react: {
        text: emoji,
        key: {
          remoteJid: message.conversation.id,
          fromMe: message.sender.id === this.selfJid,
          id: message.id,
          participant: isJidGroup(message.conversation.id)
            ? message.sender.id
            : undefined,
        },
      },
    });
  }

  async reply(message: Message, content: MessageContent): Promise<Message> {
    this.assertConnected();

    const quotedKey = {
      remoteJid: message.conversation.id,
      fromMe: message.sender.id === this.selfJid,
      id: message.id,
      participant: isJidGroup(message.conversation.id)
        ? message.sender.id
        : undefined,
    };

    // Build a minimal WAMessage to serve as the quoted message
    const quoted: WAMessage = {
      key: quotedKey,
      messageTimestamp: Math.floor(message.timestamp.getTime() / 1000),
      message: { conversation: "" },
    };

    const baileysContent = this.unifiedContentToBaileys(content);
    const result = await this.socket!.sendMessage(
      message.conversation.id,
      baileysContent,
      { quoted },
    );

    return this.buildSentMessage(message.conversation, content, result);
  }

  async forward(message: Message, to: Conversation): Promise<Message> {
    this.assertConnected();

    // Baileys supports native forwarding via the `forward` content type,
    // but it requires the original WAMessage object. Since we only have
    // our unified Message, re-send the content to the target conversation.
    if (message.content.type === "text") {
      return this.sendText(to, message.content.text);
    }

    // For non-text, send as text representation
    const text = `[Forwarded] ${message.content.type}`;
    return this.sendText(to, text);
  }

  async delete(message: Message): Promise<void> {
    this.assertConnected();

    await this.socket!.sendMessage(message.conversation.id, {
      delete: {
        remoteJid: message.conversation.id,
        fromMe: message.sender.id === this.selfJid,
        id: message.id,
        participant: isJidGroup(message.conversation.id)
          ? message.sender.id
          : undefined,
      },
    });
  }

  // ── Presence ────────────────────────────────────────────────────────────────

  async setTyping(conversation: Conversation, duration?: number): Promise<void> {
    this.assertConnected();

    await this.socket!.sendPresenceUpdate("composing", conversation.id);

    if (duration && duration > 0) {
      const timer = setTimeout(() => {
        this.typingTimers.delete(timer);
        this.socket?.sendPresenceUpdate("paused", conversation.id)
          .catch(() => {});
      }, duration);
      this.typingTimers.add(timer);
    }
  }

  async markRead(message: Message): Promise<void> {
    this.assertConnected();

    await this.socket!.readMessages([
      {
        remoteJid: message.conversation.id,
        id: message.id,
        participant: isJidGroup(message.conversation.id)
          ? message.sender.id
          : undefined,
      },
    ]);
  }

  // ── Conversations ───────────────────────────────────────────────────────────

  async getConversations(): Promise<Conversation[]> {
    this.assertConnected();

    // Baileys provides group metadata via groupFetchAllParticipating
    const groups = await this.socket!.groupFetchAllParticipating();
    const conversations: Conversation[] = [];

    for (const [jid, meta] of Object.entries(groups)) {
      conversations.push({
        id: jid,
        platform: "whatsapp",
        participants: meta.participants.map((p) =>
          mapWhatsAppUser(p.id, p.notify),
        ),
        type: "group",
        metadata: {
          subject: meta.subject,
          owner: meta.owner,
          creation: meta.creation,
          desc: meta.desc,
        },
      });
    }

    return conversations;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getMessages(conversation: Conversation, limit?: number, before?: Date): Promise<Message[]> {
    // Baileys does not support fetching message history after connection.
    // Messages are only available via real-time events or history sync
    // during initial connection (which we don't expose here).
    return [];
  }

  // ── Internal: Event Binding ────────────────────────────────────────────────

  private bindEvents(sock: WASocket): void {
    // Connection state changes
    sock.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(update);
    });

    // Credential updates (for session persistence)
    if (this.config.saveCreds) {
      const saveCreds = this.config.saveCreds;
      sock.ev.on("creds.update", () => {
        saveCreds().catch((err) => {
          this.emit(
            "error",
            err instanceof Error
              ? err
              : new Error(`Failed to save credentials: ${String(err)}`),
          );
        });
      });
    }

    // Incoming messages
    sock.ev.on("messages.upsert", (data) => {
      this.handleMessagesUpsert(data);
    });

    // Reactions
    sock.ev.on("messages.reaction", (reactions) => {
      this.handleReactions(reactions);
    });

    // Read receipts
    sock.ev.on("message-receipt.update", (updates) => {
      this.handleReceiptUpdates(updates);
    });

    // Presence updates (typing indicators, online/offline)
    sock.ev.on("presence.update", (update) => {
      this.handlePresenceUpdate(update);
    });
  }

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    const { connection, lastDisconnect, qr } = update;

    // QR code for authentication
    if (qr && this.config.onQr) {
      this.config.onQr(qr);
    }

    if (connection === "open") {
      this.connected = true;
      this.selfJid = this.socket?.user?.id ?? "";
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })
        ?.output?.statusCode;

      this.connected = false;

      // If logged out, don't attempt reconnect — surface the error
      if (statusCode === DisconnectReason.loggedOut) {
        this.emit("error", new Error("WhatsApp session logged out"));
      } else if (statusCode !== undefined) {
        this.emit(
          "error",
          new Error(`WhatsApp connection closed (status: ${statusCode})`),
        );
      }
    }
  }

  private handleMessagesUpsert(
    data: BaileysEventMap["messages.upsert"],
  ): void {
    // Only process new incoming messages (type "notify"), not history sync
    if (data.type !== "notify") return;

    for (const waMsg of data.messages) {
      // Skip status broadcast messages
      if (waMsg.key.remoteJid === "status@broadcast") continue;

      const message = mapWhatsAppMessage(waMsg, this.selfJid);
      if (message) {
        this.emit("message", message);
      }
    }
  }

  private handleReactions(
    reactions: BaileysEventMap["messages.reaction"],
  ): void {
    for (const { key, reaction: reactionProto } of reactions) {
      // reactionProto.key identifies the reaction sender:
      // - fromMe=true → we sent the reaction, use selfJid
      // - participant (groups) or remoteJid (DMs) → the reactor
      const senderJid = reactionProto.key?.fromMe
        ? this.selfJid
        : (reactionProto.key?.participant ?? reactionProto.key?.remoteJid ?? "");

      const reaction = mapWhatsAppReaction(reactionProto, senderJid);
      if (!reaction) continue;

      const targetMsg = buildReactionTargetStub(key, this.selfJid);
      this.emit("reaction", reaction, targetMsg);
    }
  }

  private handleReceiptUpdates(
    updates: BaileysEventMap["message-receipt.update"],
  ): void {
    for (const { key, receipt } of updates) {
      // Only emit for "read" receipts
      const readTimestamp = receipt.readTimestamp;
      if (!readTimestamp) continue;

      const readerJid = receipt.userJid ?? key.participant ?? key.remoteJid ?? "";
      const user = mapWhatsAppUser(readerJid);
      const stubMsg: Message = {
        id: key.id ?? "",
        conversation: mapWhatsAppConversation(
          key.remoteJid ?? "",
          this.selfJid,
        ),
        sender: mapWhatsAppUser(this.selfJid),
        timestamp: new Date(0),
        content: { type: "text", text: "" },
      };

      this.emit("read", user, stubMsg);
    }
  }

  private handlePresenceUpdate(
    update: BaileysEventMap["presence.update"],
  ): void {
    for (const [participantJid, data] of Object.entries(update.presences)) {
      const user = mapWhatsAppUser(participantJid);
      const conversation = mapWhatsAppConversation(update.id, this.selfJid);

      if (data.lastKnownPresence === "composing" || data.lastKnownPresence === "recording") {
        this.emit("typing", user, conversation);
      }

      if (data.lastKnownPresence === "available") {
        this.emit("presence", user, "online");
      } else if (data.lastKnownPresence === "unavailable") {
        this.emit("presence", user, "offline");
      }
    }
  }

  // ── Internal: Helpers ──────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this.connected || !this.socket) {
      throw new Error("WhatsAppAdapter is not connected");
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
   * Wait for the Baileys socket to reach "open" state.
   * Resolves when connected, rejects on timeout or fatal disconnect.
   */
  private waitForConnection(
    sock: WASocket,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`WhatsApp connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onUpdate = (update: Partial<ConnectionState>) => {
        if (update.connection === "open") {
          cleanup();
          resolve();
        }
        if (update.connection === "close") {
          const statusCode = (
            update.lastDisconnect?.error as { output?: { statusCode?: number } }
          )?.output?.statusCode;

          if (statusCode === DisconnectReason.loggedOut) {
            cleanup();
            reject(new Error("WhatsApp session logged out during connect"));
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        sock.ev.off("connection.update", onUpdate);
      };

      sock.ev.on("connection.update", onUpdate);
    });
  }

  /**
   * Send a Baileys message and translate the result to a unified Message.
   */
  private async sendMsg(
    conversation: Conversation,
    content: AnyMessageContent,
  ): Promise<Message> {
    this.assertConnected();

    const result = await this.socket!.sendMessage(conversation.id, content);
    const mapped = result ? mapWhatsAppMessage(result, this.selfJid) : undefined;
    if (mapped) return mapped;

    // Fallback: build a minimal Message from what we know
    return {
      id: result?.key?.id ?? String(Date.now()),
      conversation,
      sender: mapWhatsAppUser(this.selfJid),
      timestamp: new Date(),
      content: { type: "text", text: "" },
    };
  }

  /**
   * Convert a unified MessageContent to a Baileys AnyMessageContent.
   */
  private unifiedContentToBaileys(content: MessageContent): AnyMessageContent {
    switch (content.type) {
      case "text":
        return { text: content.text };
      case "image":
        return { image: { url: content.url }, caption: content.caption };
      case "video":
        return { video: { url: content.url }, caption: content.caption };
      case "audio":
        return { audio: { url: content.url }, ptt: false };
      case "voice":
        return { audio: { url: content.url }, ptt: true };
      case "file":
        return {
          document: { url: content.url },
          mimetype: "application/octet-stream",
          fileName: content.filename,
        };
      case "location":
        return {
          location: {
            degreesLatitude: content.lat,
            degreesLongitude: content.lng,
          },
        };
      case "contact":
        return {
          contacts: {
            displayName: content.name,
            contacts: [{ displayName: content.name, vcard: buildVcard(content.name, content.phone) }],
          },
        };
      case "sticker":
        return { sticker: { url: content.url } };
      case "link":
        return { text: content.url };
    }
  }

  /**
   * Build a Message from send result when mapWhatsAppMessage doesn't
   * produce one (e.g. because result.message is null for some send types).
   */
  private buildSentMessage(
    conversation: Conversation,
    content: MessageContent,
    result: WAMessage | undefined,
  ): Message {
    return {
      id: result?.key?.id ?? String(Date.now()),
      conversation,
      sender: mapWhatsAppUser(this.selfJid),
      timestamp: new Date(),
      content,
    };
  }
}

/** Build a minimal vCard string for contact messages. */
function buildVcard(name: string, phone: string): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${name}`,
    `TEL;type=CELL;type=VOICE;waid=${phone.replace(/\+/g, "")}:${phone}`,
    "END:VCARD",
  ].join("\n");
}
