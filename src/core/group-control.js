import { getConfig, updateConfig } from './config.js';

const GROUP_JID_RE = /^[0-9]{5,30}(?:-[0-9]{1,25})?@g\.us$/;

export function isGroupJid(value) {
  return typeof value === 'string' && GROUP_JID_RE.test(value);
}

export function getGroupInteractionState(groupId, config = getConfig()) {
  const features = config?.features || {};
  const overrides = features.groupMuteOverrides && typeof features.groupMuteOverrides === 'object'
    ? features.groupMuteOverrides
    : {};
  const hasOverride = isGroupJid(groupId) && Object.prototype.hasOwnProperty.call(overrides, groupId)
    && typeof overrides[groupId] === 'boolean';
  const muted = hasOverride ? overrides[groupId] : features.groupsMuted === true;
  return {
    groupId: isGroupJid(groupId) ? groupId : '',
    muted,
    active: !muted,
    source: hasOverride ? 'group-override' : 'global-default',
    globalMuted: features.groupsMuted === true
  };
}

export async function setGroupInteractionMuted(groupId, muted, metadata = {}) {
  if (!isGroupJid(groupId)) throw new Error('Group ID tidak valid.');
  if (typeof muted !== 'boolean') throw new Error('Status mute harus boolean.');
  await updateConfig(config => {
    config.features.groupMuteOverrides ||= {};
    config.features.groupMuteOverrides[groupId] = muted;
  }, { actor: metadata.actor || 'system', reason: metadata.reason || `group ${groupId} mute ${muted ? 'on' : 'off'}` });
  return getGroupInteractionState(groupId);
}

export async function rememberJoinedGroup(groupId, metadata = {}) {
  if (!isGroupJid(groupId)) throw new Error('Group ID tidak valid.');
  await updateConfig(config => {
    config.features.groupMuteOverrides ||= {};
    // New groups are deliberately muted until the owner explicitly enables them.
    config.features.groupMuteOverrides[groupId] = true;
    // Keep the legacy field empty: activation target is always the current
    // group context, never inferred from the last invite operation.
    config.features.lastJoinedGroupId = '';
  }, { actor: metadata.actor || 'system', reason: metadata.reason || `remember joined group ${groupId}; default muted` });
  return getGroupInteractionState(groupId);
}

export async function setGlobalGroupMute(muted, metadata = {}) {
  if (typeof muted !== 'boolean') throw new Error('Status mute harus boolean.');
  await updateConfig(config => {
    config.features.groupsMuted = muted;
    // A global all-on/all-off operation is authoritative and clears older exceptions.
    config.features.groupMuteOverrides = {};
  }, { actor: metadata.actor || 'system', reason: metadata.reason || `global group mute ${muted ? 'on' : 'off'}` });
  return { muted, active: !muted };
}

export async function clearGroupMuteOverride(groupId, metadata = {}) {
  if (!isGroupJid(groupId)) return false;
  await updateConfig(config => {
    if (config.features.groupMuteOverrides) delete config.features.groupMuteOverrides[groupId];
    if (config.features.lastJoinedGroupId === groupId) config.features.lastJoinedGroupId = '';
  }, { actor: metadata.actor || 'system', reason: metadata.reason || `clear group mute state ${groupId}` });
  return true;
}

export function getLastJoinedGroupId(config = getConfig()) {
  const value = config?.features?.lastJoinedGroupId;
  return isGroupJid(value) ? value : '';
}

export function listGroupInteractionStates(groupIds, config = getConfig()) {
  return groupIds.map(groupId => ({ groupId, ...getGroupInteractionState(groupId, config) }));
}
