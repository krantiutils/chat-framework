export { TelegramAdapter } from "./adapter.js";

export {
  mapTelegramUser,
  mapTelegramChatType,
  mapTelegramConversation,
  pickLargestPhoto,
  mapTelegramMessageContent,
  mapTelegramMessage,
  mapTelegramReactions,
} from "./mapper.js";

export type {
  TelegramAdapterConfig,
  TelegramUser,
  TelegramChat,
  TelegramPhotoSize,
  TelegramAudio,
  TelegramVoice,
  TelegramVideo,
  TelegramDocument,
  TelegramSticker,
  TelegramLocation,
  TelegramContact,
  TelegramMessageEntity,
  TelegramMessage,
  TelegramMessageReactionUpdated,
  TelegramReactionType,
  TelegramCallbackQuery,
  TelegramChatMember,
} from "./types.js";
