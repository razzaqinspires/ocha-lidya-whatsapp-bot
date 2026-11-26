/** Public compatibility adapter. The full serializer is installed by the private runtime package. */
import { loadSerializerAdapter } from '../private-runtime/adapter-state.js';

const serializer = await loadSerializerAdapter();
export const toJid = serializer.toJid;
export const serialize = serializer.serialize;
export const serializeCall = serializer.serializeCall;
export const extendSocket = serializer.extendSocket;
export const unwrapMessage = serializer.unwrapMessage;
export const downloadMedia = serializer.downloadMedia;
export const storeMessage = serializer.storeMessage;
export const getStoredMessage = serializer.getStoredMessage;
export const registerJidPair = serializer.registerJidPair;
export const syncBotJidPairs = serializer.syncBotJidPairs;
export const getBotIdentifiers = serializer.getBotIdentifiers;
export const trackSentMessageId = serializer.trackSentMessageId;
export const setOutgoingMessageObserver = serializer.setOutgoingMessageObserver;
export const isBotSentMessage = serializer.isBotSentMessage;
export const freply = serializer.freply;
export const createFakeReply = serializer.createFakeReply;
export default serializer;
