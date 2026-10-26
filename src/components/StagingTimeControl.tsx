import { useState } from "react";
import { getStagingSeconds, setStagingSeconds } from "../env/stagingTime";

const PRESETS = [15, 60, 120, 240];

/** Staging only: pick the turn length for test games (daily and custom). */
export default function StagingTimeControl() {
  const [secs, setSecs] = useState<number | null>(() => getStagingSeconds());
  const [draft, setDraft] = useState<string>(secs ? String(secs) : "");

  const apply = (value: number | null) => {
    setStagingSeconds(value);
    setSecs(value);
    setDraft(value ? String(value) : "");
  };

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 9999,
        border: "1px solid rgba(255,255,255,0.6)",
        background: active ? "rgba(255,255,255,0.9)" : "transparent",
        color: active ? "#1d3a8a" : "white",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        marginTop: 16,
        width: "100%",
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px dashed rgba(255,255,255,0.6)",
        color: "white",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        🧪 Staging · tiempo por jugador: {secs ? `${secs} s` : "por defecto (15 s)"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", alignItems: "center" }}>
        {PRESETS.map((p) => chip(p < 60 ? `${p} s` : `${p / 60} min`, secs === p, () => apply(p)))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(draft);
            apply(n > 0 ? n : null);
          }}
          style={{ display: "flex", gap: 4, alignItems: "center" }}
        >
          <input
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="segundos"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: 84, padding: "4px 6px", borderRadius: 8, border: "none", fontSize: 13 }}
          />
          {chip("OK", false, () => {
            const n = Number(draft);
            apply(n > 0 ? n : null);
          })}
        </form>
        {secs ? chip("↺", false, () => apply(null)) : null}
      </div>
    </div>
  );
}
