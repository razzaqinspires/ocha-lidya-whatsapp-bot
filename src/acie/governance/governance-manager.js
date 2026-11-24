/**
 * Records the contribution's rights-review state without inferring permission.
 * A provided license/attribution is evidence supplied by the uploader, not legal approval.
 */
export function evaluateContributionGovernance({
  contributorName = null,
  license = null,
  attribution = null,
  licenseReviewed = false,
  attributionConfirmed = false,
  ownerAuthorized = false
} = {}) {
  const licenseProvided = Boolean(String(license || '').trim());
  const attributionProvided = Boolean(String(attribution || '').trim());
  const contributorIdentified = Boolean(String(contributorName || '').trim());
  const pending = [];

  if (!contributorIdentified) pending.push('contributor-identity');
  if (!licenseProvided) pending.push('license-information');
  if (!attributionProvided) pending.push('attribution-information');
  if (licenseProvided && !licenseReviewed) pending.push('license-human-review');
  if (attributionProvided && !attributionConfirmed) pending.push('attribution-confirmation');
  if (!ownerAuthorized) pending.push('owner-authorization');

  return {
    contributorIdentityStatus: contributorIdentified ? 'provided-pending-verification' : 'pending-information',
    licenseProvided,
    licenseReviewed: Boolean(licenseReviewed),
    attributionProvided,
    attributionConfirmed: Boolean(attributionConfirmed),
    ownerAuthorized: Boolean(ownerAuthorized),
    status: pending.some(item => item.endsWith('-information') || item === 'contributor-identity')
      ? 'pending-information'
      : 'pending-human-review',
    pending,
    activationAllowed: false,
    sourceExecutionAllowed: false,
    policy: 'Provided license and attribution are not treated as independent proof of rights or permission.'
  };
}
