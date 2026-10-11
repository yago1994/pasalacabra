// TEMPORARY design preview of every MicStatus state. Not part of the app.
import ReactDOM from "react-dom/client";
import MicStatus from "./components/MicStatus";
import type { BrowserEnv, MicFailure, MicFailureReason } from "./platform/micDiagnostics";
import "./index.css";
import "./App.css";

const CODES: Record<MicFailureReason, string> = {
  waiting: "Timeout", denied: "NotAllowedError", "denied-system": "NotAllowedError",
  "no-mic": "NotFoundError", busy: "NotReadableError", unsupported: "TypeError",
  network: "SpeechServiceError", unknown: "Error",
};

const cases: Array<[string, MicFailureReason, BrowserEnv]> = [
  ["Prompt ignored / hidden (10 s)", "waiting", { os: "mac", browser: "chrome", inApp: false }],
  ["Blocked — Chrome on Mac/PC", "denied", { os: "mac", browser: "chrome", inApp: false }],
  ["Blocked — Chrome on iPhone", "denied", { os: "ios", browser: "chrome", inApp: false }],
  ["Blocked — Safari on iPhone", "denied", { os: "ios", browser: "safari", inApp: false }],
  ["Blocked — Android (opens existing guide)", "denied", { os: "android", browser: "chrome", inApp: false }],
  ["Blocked — Firefox", "denied", { os: "windows", browser: "firefox", inApp: false }],
  ["macOS blocks Chrome itself", "denied-system", { os: "mac", browser: "chrome", inApp: false }],
  ["No microphone", "no-mic", { os: "windows", browser: "chrome", inApp: false }],
  ["Mic busy (Zoom, Teams…)", "busy", { os: "mac", browser: "chrome", inApp: false }],
  ["Instagram / TikTok in-app browser", "unsupported", { os: "ios", browser: "safari", inApp: true }],
  ["Speech service unreachable", "network", { os: "mac", browser: "chrome", inApp: false }],
  ["Anything else", "unknown", { os: "mac", browser: "chrome", inApp: false }],
];

function Preview() {
  return (
    <div style={{ minHeight: "100vh", background: "#4f8dff", padding: "24px 16px", fontFamily: "system-ui" }}>
      <div style={{ display: "grid", gap: 28, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", maxWidth: 1100, margin: "0 auto" }}>
        {cases.map(([label, reason, env]) => {
          const failure: MicFailure = { reason, stage: "mic", errorName: CODES[reason], errorMessage: "" };
          return (
            <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, opacity: 0.85, marginBottom: 8 }}>{label}</div>
              <button className="btnPrimary" disabled style={{ width: "100%", maxWidth: 420 }}>Empezar</button>
              <MicStatus failure={failure} env={env} onRetry={() => {}} onShowAndroidHelp={() => {}} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);
