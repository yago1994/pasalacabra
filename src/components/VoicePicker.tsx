import { useRef, useState } from "react";
import { getVoice, listSpanishVoices, playTts, setVoice, type VoiceInfo } from "../speech/azureTts";

const SAMPLE = "Empieza por A. Instrumento de viento compuesto por un fuelle, un teclado y botones.";

/**
 * Staging only: hear every Azure voice that speaks Spain Spanish on the same
 * question and pick the one the game uses (?audio=single, and later the
 * pre-generated question audio).
 */
export default function VoicePicker() {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState(getVoice());
  const [playing, setPlaying] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const stopRef = useRef<null | (() => void)>(null);

  const load = () => {
    setOpen(true);
    if (voices) return;
    listSpanishVoices().then(setVoices, (e) => setError(String(e)));
  };

  const play = (name: string) => {
    stopRef.current?.();
    // Created inside the tap so iOS lets it play.
    if (!ctxRef.current || ctxRef.current.state === "closed") ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    void ctx.resume();
    setPlaying(name);
    stopRef.current = playTts(ctx, SAMPLE, 0.9, () => setPlaying((p) => (p === name ? null : p)), name);
  };

  const choose = (name: string) => {
    setVoice(name);
    setChosen(name);
  };

  const box: React.CSSProperties = {
    marginTop: 12,
    width: "100%",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px dashed rgba(255,255,255,0.6)",
    color: "white",
    fontSize: 13,
    textAlign: "left",
  };
  const small: React.CSSProperties = {
    padding: "3px 9px",
    borderRadius: 9999,
    border: "1px solid rgba(255,255,255,0.6)",
    background: "transparent",
    color: "white",
    fontSize: 12,
    cursor: "pointer",
  };

  if (!open) {
    return (
      <div style={{ ...box, textAlign: "center" }}>
        <button type="button" style={small} onClick={load}>
          🔊 Staging · elegir voz ({chosen.replace(/^es-ES-|Neural$/g, "")})
        </button>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, marginBottom: 6, textAlign: "center" }}>
        🔊 Voz de las preguntas · ahora: {chosen}
      </div>
      {error ? <div>No se pudo cargar la lista: {error}</div> : null}
      {!voices && !error ? <div style={{ textAlign: "center" }}>Cargando voces…</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
        {voices?.map((v) => (
          <div
            key={v.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 4px",
              borderRadius: 8,
              background: v.name === chosen ? "rgba(255,255,255,0.18)" : "transparent",
            }}
          >
            <button type="button" style={small} onClick={() => play(v.name)}>
              {playing === v.name ? "…" : "▶"}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {v.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>· {v.gender} · {v.kind}</span>
              </div>
              <div style={{ opacity: 0.6, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</div>
            </div>
            <button type="button" style={small} onClick={() => choose(v.name)}>
              {v.name === chosen ? "✓" : "Usar"}
            </button>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", marginTop: 6 }}>
        <button type="button" style={small} onClick={() => setOpen(false)}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
