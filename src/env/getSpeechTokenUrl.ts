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
  // During build, VITE_SPEECH_TOKEN_URL is set to the correct URL:
  // - For staging builds: set to staging worker URL (vars.VITE_SPEECH_STAGING_TOKEN_URL)
  // - For prod builds: set to prod worker URL (vars.VITE_SPEECH_TOKEN_URL)
  // So we always use VITE_SPEECH_TOKEN_URL as it's already set correctly for the environment
  const tokenUrl = import.meta.env.VITE_SPEECH_TOKEN_URL as string | undefined;
  
  // For local development, use staging worker URL as fallback
  if (!tokenUrl) {
    if (isLocalDevHost()) {
      // Use staging URL for local development (you can change this to prod if preferred)
      return import.meta.env.VITE_SPEECH_TOKEN_URL;
    }
    const env = import.meta.env.VITE_DEFAULT_ENV || "unknown";
    throw new Error(`Missing VITE_SPEECH_TOKEN_URL (env: ${env})`);
  }
  return tokenUrl;
}

