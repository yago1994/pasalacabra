/**
 * Mirror console output to a dev server, for devices without an attached
 * inspector (see devLog() in vite.config.ts):
 *  - dev builds with ?devlog or ?fakestt: to this dev server (/__devlog);
 *  - dev or staging builds with ?devlog=https://<name>.ngrok-free.dev: to a dev
 *    server exposed through ngrok, so a real phone on the staging site can be
 *    debugged live. Only ngrok hosts are accepted.
 */
import { isStagingMode } from "./env/getSpeechTokenUrl";

const params = new URLSearchParams(location.search);
const remote = params.get("devlog") ?? "";
const NGROK = /^https:\/\/[a-z0-9-]+\.(ngrok-free\.dev|ngrok-free\.app|ngrok\.app|ngrok\.io)\/?$/i;

const endpoint =
  NGROK.test(remote) && (import.meta.env.DEV || isStagingMode())
    ? `${remote.replace(/\/$/, "")}/__devlog`
    : import.meta.env.DEV && (params.has("devlog") || params.has("fakestt"))
      ? "/__devlog"
      : null;

if (endpoint) {
  const isRemote = endpoint.startsWith("http");
  const session = Math.random().toString(36).slice(2, 6);
  const queue: string[] = [`=== ${session} ${location.href} ${navigator.userAgent}`];
  const send = () => {
    if (!queue.length) return;
    const body = queue.splice(0).join("\n");
    void fetch(endpoint, {
      method: "POST",
      body,
      keepalive: true,
      // ngrok shows browsers an interstitial page unless asked not to.
      headers: isRemote ? { "Content-Type": "text/plain", "ngrok-skip-browser-warning": "1" } : undefined,
    }).catch(() => {});
  };
  const fmt = (a: unknown) => {
    if (typeof a === "string") return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };
  for (const level of ["log", "warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      const t = new Date().toISOString().slice(11, 23);
      queue.push(`${session} ${t} ${level === "log" ? "" : level.toUpperCase() + " "}${args.map(fmt).join(" ")}`);
    };
  }
  window.addEventListener("error", (e) => console.error("uncaught", e.message, `${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => console.error("unhandled rejection", String(e.reason)));
  document.addEventListener("visibilitychange", () => console.log("[page]", document.visibilityState));
  window.addEventListener("pagehide", () => {
    console.log("[page] pagehide");
    send();
  });
  setInterval(send, 500);
}
