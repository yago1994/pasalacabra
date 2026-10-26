/**
 * Dev only: with ?devlog or ?fakestt, mirror console output to the dev server
 * (see devLog() in vite.config.ts), for devices without an attached inspector.
 */
const params = new URLSearchParams(location.search);
if (import.meta.env.DEV && (params.has("devlog") || params.has("fakestt"))) {
  const queue: string[] = [];
  const send = () => {
    if (!queue.length) return;
    const body = queue.splice(0).join("\n");
    void fetch("/__devlog", { method: "POST", body, keepalive: true }).catch(() => {});
  };
  const fmt = (a: unknown) => {
    if (typeof a === "string") return a;
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
      queue.push(`${t} ${level === "log" ? "" : level.toUpperCase() + " "}${args.map(fmt).join(" ")}`);
    };
  }
  window.addEventListener("error", (e) => console.error("uncaught", e.message, `${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => console.error("unhandled rejection", String(e.reason)));
  setInterval(send, 500);
}
