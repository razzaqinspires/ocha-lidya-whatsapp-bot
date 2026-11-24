/** Consent-first policy for any future Ocha-initiated social action. */
export function evaluateSocialIntroduction({
  scope = 'group',
  groupEnabled = false,
  groupAdminApproved = false,
  memberOptedIn = false,
  ignoredSinceLastContact = false,
  lastIntroductionAt = null,
  now = Date.now(),
  cooldownMs = 30 * 24 * 60 * 60_000
} = {}) {
  if (scope !== 'group' && scope !== 'private') return { allowed: false, reason: 'unsupported_scope' };
  if (!memberOptedIn) return { allowed: false, reason: 'member_consent_required' };
  if (scope === 'group' && (!groupEnabled || !groupAdminApproved)) {
    return { allowed: false, reason: 'group_admin_consent_required' };
  }
  if (ignoredSinceLastContact) return { allowed: false, reason: 'respect_silence' };
  const last = Date.parse(lastIntroductionAt || '');
  if (Number.isFinite(last) && now - last < cooldownMs) return { allowed: false, reason: 'introduction_cooldown' };
  return { allowed: true, reason: 'explicit_opt_in', action: 'single_neutral_introduction' };
}

export function evaluateSocialFollowUp({
  memberOptedIn = false,
  ignored = false,
  followUpsSent = 0,
  explicitFollowUpRequested = false
} = {}) {
  if (!memberOptedIn) return { allowed: false, reason: 'member_consent_required' };
  if (ignored) return { allowed: false, reason: 'respect_silence' };
  if (!explicitFollowUpRequested) return { allowed: false, reason: 'no_follow_up_request' };
  if (followUpsSent >= 1) return { allowed: false, reason: 'follow_up_limit_reached' };
  return { allowed: true, reason: 'explicit_follow_up', tone: 'neutral' };
}
