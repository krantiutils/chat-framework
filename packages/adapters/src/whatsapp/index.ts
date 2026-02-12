export { WhatsAppAdapter } from "./adapter.js";

export {
  mapWhatsAppUser,
  mapWhatsAppConversation,
  mapWhatsAppMessageContent,
  mapWhatsAppMessage,
  mapWhatsAppReaction,
  buildReactionTargetStub,
  unwrapMessageContent,
  jidToPhone,
  isGroupJid,
} from "./mapper.js";

export type { WhatsAppAdapterConfig } from "./types.js";
