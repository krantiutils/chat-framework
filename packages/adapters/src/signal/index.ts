export { SignalAdapter } from "./adapter.js";
export { SignalCliProcess } from "./process.js";
export type { EnvelopeCallback, ErrorCallback } from "./process.js";

export {
  mapSignalUser,
  mapSignalConversation,
  mapSignalAttachmentToContent,
  mapSignalMessageContent,
  mapSignalQuoteToReplyRef,
  mapSignalReaction,
  mapSignalEnvelopeToMessage,
} from "./mapper.js";

export type {
  SignalAdapterConfig,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  SignalEnvelope,
  SignalDataMessage,
  SignalSyncMessage,
  SignalReceiptMessage,
  SignalTypingMessage,
  SignalGroupInfo,
  SignalAttachment,
  SignalReaction,
  SignalQuote,
  SignalSendResult,
} from "./types.js";
