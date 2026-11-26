/** Public fake-reply adapter. Historical WhatsApp quote emulation is private-runtime only. */
import { loadFakeReplyAdapter } from '../private-runtime/adapter-state.js';

const freply = await loadFakeReplyAdapter();
export const createFakeReply = freply.createFakeReply;
export const createFakeContextInfo = freply.createFakeContextInfo;
export const getAvailableTypes = freply.getAvailableTypes;
export default freply;
