import { inspectRuntimeHost } from '../runtime/runtime-manager.js';

export const EXECUTION_POLICY = Object.freeze({
  staticAnalysisAllowed: true,
  sourceExecutionAllowedByDefault: false,
  networkAllowedByDefault: false,
  hostFilesystemAccess: false,
  botCredentialForwarding: false,
  dependencyInstallInOriginal: false,
  vaultMutationByWorkers: false,
  activationRequires: Object.freeze(['license-reviewed', 'attribution-confirmed', 'integrity-verified', 'adapter-reviewed', 'adapter-tested', 'adapter-protocol-tested', 'sandbox-approved', 'sandbox-runtime-available', 'owner-authorized', 'output-contract-verified', 'security-findings-clear'])
});

export function canActivateProvider(provider, { root = process.cwd() } = {}) {
  const required = EXECUTION_POLICY.activationRequires;
  const checks = {
    licenseReviewed: Boolean(provider?.governance?.licenseReviewed),
    attributionConfirmed: Boolean(provider?.governance?.attributionConfirmed),
    integrityVerified: provider?.integrity === 'verified',
    adapterReviewed: Boolean(provider?.validation?.adapterReviewed),
    adapterTested: Boolean(provider?.validation?.adapterTested),
    adapterProtocolTested: Boolean(provider?.validation?.protocolTested),
    sandboxApproved: Boolean(provider?.sandbox?.approved),
    sandboxRuntimeAvailable: inspectRuntimeHost({ root }).sandbox.available === true,
    ownerAuthorized: Boolean(provider?.executionAuthorized),
    outputContractVerified: Boolean(provider?.validation?.outputContractVerified),
    securityClear: !(Number(provider?.security?.critical || 0) > 0 || Number(provider?.security?.high || 0) > 0)
  };
  return { allowed: required.every(key => ({
    'license-reviewed': checks.licenseReviewed,
    'attribution-confirmed': checks.attributionConfirmed,
    'integrity-verified': checks.integrityVerified,
    'adapter-reviewed': checks.adapterReviewed,
    'adapter-tested': checks.adapterTested,
    'adapter-protocol-tested': checks.adapterProtocolTested,
    'sandbox-approved': checks.sandboxApproved,
    'sandbox-runtime-available': checks.sandboxRuntimeAvailable,
    'owner-authorized': checks.ownerAuthorized,
    'output-contract-verified': checks.outputContractVerified,
    'security-findings-clear': checks.securityClear
  })[key]), checks, missing: required.filter(key => !({
    'license-reviewed': checks.licenseReviewed,
    'attribution-confirmed': checks.attributionConfirmed,
    'integrity-verified': checks.integrityVerified,
    'adapter-reviewed': checks.adapterReviewed,
    'adapter-tested': checks.adapterTested,
    'adapter-protocol-tested': checks.adapterProtocolTested,
    'sandbox-approved': checks.sandboxApproved,
    'sandbox-runtime-available': checks.sandboxRuntimeAvailable,
    'owner-authorized': checks.ownerAuthorized,
    'output-contract-verified': checks.outputContractVerified,
    'security-findings-clear': checks.securityClear
  })[key]) };
}
