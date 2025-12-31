export function isLocalDevHost() {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

export function isStagingMode() {
  // Check environment variable set during build
  if (import.meta.env.VITE_DEFAULT_ENV === "staging") {
    return true;
  }
  // For mobile testing on the real domain:
  // https://pasalacabra.com/?env=staging
  const env = new URLSearchParams(location.search).get("env");
  if (env === "staging") {
    return true;
  }
  // Check if we're in the staging deployment path
  if (location.pathname.includes("/staging/")) {
    return true;
  }
  // Local development
  return isLocalDevHost();
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

