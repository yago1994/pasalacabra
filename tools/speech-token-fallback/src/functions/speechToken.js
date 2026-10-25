// Fallback speech-token endpoint, hosted on Azure instead of Cloudflare.
//
// Same contract as the Cloudflare worker: GET → { token, region }, only for our
// origins. Spanish ISPs block Cloudflare IPs during LaLiga matches; the app
// tries the worker first and falls back here (VITE_SPEECH_TOKEN_FALLBACK_URL).
const { app } = require("@azure/functions");

const SPEECH_KEY = process.env.SPEECH_KEY;
const SPEECH_REGION = process.env.SPEECH_REGION;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://pasalacabra.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Optional: lets localhost use this endpoint when it sends X-Dev-Key.
const DEV_GATE_KEY = process.env.DEV_GATE_KEY;

const isLocalOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

app.http("speechToken", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "speech/token",
  handler: async (request) => {
    const origin = request.headers.get("origin") || "";
    const local = isLocalOrigin(origin) && Boolean(DEV_GATE_KEY);
    if (!ALLOWED_ORIGINS.includes(origin) && !local) return { status: 403 };

    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Dev-Key",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return { status: 204, headers: cors };
    if (local && request.headers.get("x-dev-key") !== DEV_GATE_KEY) return { status: 403, headers: cors };

    const res = await fetch(`https://${SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": SPEECH_KEY, "Content-Length": "0" },
    });
    if (!res.ok) {
      return { status: 502, headers: cors, jsonBody: { error: `issueToken failed: ${res.status}` } };
    }
    return {
      status: 200,
      headers: { ...cors, "Cache-Control": "no-store" },
      jsonBody: { token: await res.text(), region: SPEECH_REGION },
    };
  },
});
