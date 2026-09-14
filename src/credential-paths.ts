/** Shared conservative classification of local credential resources. */
export function isCredentialPath(relative: string): boolean {
  const segments = relative.replaceAll('\\', '/').toLowerCase().split('/');
  const name = segments.at(-1) ?? '';
  // Run names must not make discovery ingest its own growing event history.
  // Explicit credential filenames in state remain protected as before.
  const sensitiveSegments = segments.includes('.autocode') ? [name] : segments;
  return (
    /^\.env(?:\.|$)/.test(name) ||
    sensitiveSegments.some((segment) =>
      /(?:secret|credential)/.test(segment),
    ) ||
    /^(?:\.?npmrc|[._]?netrc|\.pypirc|\.git-credentials|auth\.(?:json|ya?ml)|id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?)$/.test(
      name,
    ) ||
    /\.(?:pem|key|p12|pfx)$/.test(name) ||
    segments.some(isCredentialDirectoryName)
  );
}

export function isIniCredentialPath(name: string): boolean {
  return /^(?:\.env(?:\.|$)|\.?npmrc$|\.pypirc$|config$|credentials$)/i.test(
    name,
  );
}

export function isCredentialDirectoryName(name: string): boolean {
  return [
    '.aws',
    '.ssh',
    '.azure',
    '.kube',
    '.docker',
    '.credentials',
    '.secrets',
  ].includes(name.toLowerCase());
}
