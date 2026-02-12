export { WhatsAppSessionManager, classifyDisconnect } from "./session.js";
export type { SessionState } from "./session.js";

export { FileAuthStateStore } from "./auth-state.js";

export type {
  AuthStateStore,
  WhatsAppSessionConfig,
  QRCodeEvent,
  AuthenticatedEvent,
  ConnectedEvent,
  DisconnectedEvent,
  ReconnectingEvent,
  SessionExpiredEvent,
  SessionEventMap,
  SessionEventName,
  DisconnectClassification,
  DisconnectCategory,
  AuthenticationCreds,
  AuthenticationState,
  ConnectionState,
  SignalKeyStore,
  WASocket,
} from "./types.js";
