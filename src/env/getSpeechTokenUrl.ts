export function isLocalDevHost() {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

export function isStagingMode() {
  // For mobile testing on the real domain:
  // https://pasalacabra.com/?env=staging
  const env = new URLSearchParams(location.search).get("env");
  return env === "staging" || isLocalDevHost();
}

export function getSpeechTokenUrl() {
  if (isStagingMode()) {
    const stagingUrl = import.meta.env.VITE_SPEECH_STAGING_TOKEN_URL as string | undefined;
    if (!stagingUrl) {
      throw new Error("Missing VITE_SPEECH_STAGING_TOKEN_URL");
    }
    return stagingUrl;
  }
  const prodUrl = import.meta.env.VITE_SPEECH_TOKEN_URL as string | undefined;
  if (!prodUrl) {
    throw new Error("Missing VITE_SPEECH_TOKEN_URL");
  }
  return prodUrl;
}

