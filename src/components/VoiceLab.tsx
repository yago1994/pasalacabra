import { useEffect, useRef, useState } from "react";
import {
  LONG_PAUSE_MS,
  SHORT_PAUSE_MS,
  getVoice,
  listSpanishVoices,
  playTts,
  setVoice,
  type VoiceInfo,
} from "../speech/azureTts";

/**
 * Staging only (?voicelab): tune how questions are read before generating the
 * audio files, with the same Azure voices and SSML the generator will use.
 * Edit the samples (punctuation, "/" short pause, "//" long pause), pick the
 * speed and voice, listen, and send the result through the log relay
 * (?devlog=…) so the generator can follow the same rules.
 */
const SAMPLES = [
  "Empieza por A: Deporte base del programa olímpico moderno, llamado 'rey de los Juegos'.",
  "Empieza por B: Director de 'Plácido' y 'El verdugo'.",
  "Empieza por C: Antigua capital del Imperio romano de Oriente, hoy Estambul.",
  "Contiene la E: Institución colonial que otorgaba indígenas a un español para su servicio y tributo.",
  "No. La respuesta correcta es: Guillermo del Toro",
  "Tieeeeeeeempoo!",
];

export default function VoiceLab() {
  const [texts, setTexts] = useState<string[]>(SAMPLES);
  const [rate, setRate] = useState(0.9);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voiceError, setVoiceError] = useState("");
  const [voiceName, setVoiceName] = useState(getVoice());
  const [playing, setPlaying] = useState<number | null>(null);
  const [sent, setSent] = useState("");
  const ctxRef = useRef<AudioContext | null>(null);
  const stopRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    listSpanishVoices().then(
      (all) => setVoices(all.filter((v) => v.locale === "es-ES")),
      (e) => setVoiceError(String(e))
    );
  }, []);

  const relayOn = Boolean(new URLSearchParams(location.search).get("devlog"));

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(null);
  };

  const play = (i: number) => {
    stop();
    // Created inside the tap so iOS lets it play.
    if (!ctxRef.current || ctxRef.current.state === "closed") ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    void ctx.resume();
    setPlaying(i);
    stopRef.current = playTts(
      ctx,
      texts[i],
      rate,
      (why) => {
        if (why === "error") console.log("[voicelab] synthesis failed for sample", i);
        setPlaying((p) => (p === i ? null : p));
      },
      voiceName,
      true
    );
  };

  const pickVoice = (name: string) => {
    setVoiceName(name);
    setVoice(name); // also what ?audio=single games use
  };

  const send = () => {
    const payload = {
      voice: voiceName,
      rate,
      shortPauseMs: SHORT_PAUSE_MS,
      longPauseMs: LONG_PAUSE_MS,
      samples: texts.map((edited, i) => ({ original: SAMPLES[i], edited })),
    };
    console.log("[voicelab]", JSON.stringify(payload));
    setSent(new Date().toLocaleTimeString());
  };

  const btn: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 9999,
    border: "1px solid rgba(255,255,255,0.7)",
    background: "transparent",
    color: "white",
    fontSize: 14,
    cursor: "pointer",
  };

  return (
    <div style={{ minHeight: "100vh", padding: "24px 16px 48px", color: "white", maxWidth: 640, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 4px" }}>🧪 Laboratorio de voz</h2>
      <p style={{ margin: "0 0 16px", opacity: 0.85, fontSize: 14, lineHeight: 1.4 }}>
        Edita la puntuación de cada frase y escúchala. Usa <strong>/</strong> para una pausa corta ({SHORT_PAUSE_MS} ms) y{" "}
        <strong>//</strong> para una larga ({LONG_PAUSE_MS} ms). Cuando suene bien, pulsa <em>Enviar a Claude</em>.
      </p>

      <div style={{ display: "grid", gap: 10, marginBottom: 16, fontSize: 14 }}>
        <label>
          Voz:{" "}
          <select value={voiceName} onChange={(e) => pickVoice(e.target.value)} style={{ fontSize: 14, maxWidth: "70%" }}>
            {voices.length === 0 ? <option value={voiceName}>{voiceName}</option> : null}
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label} · {v.gender} · {v.kind}
              </option>
            ))}
          </select>
          {voiceError ? <div style={{ fontSize: 12 }}>No se pudo cargar la lista de voces: {voiceError}</div> : null}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Velocidad:
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <strong style={{ width: 44, textAlign: "right" }}>{rate.toFixed(2)}×</strong>
        </label>
      </div>

      {texts.map((t, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <textarea
            value={t}
            onChange={(e) => setTexts((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", fontSize: 16, padding: 8, borderRadius: 10, border: "none" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" style={btn} onClick={() => (playing === i ? stop() : play(i))}>
              {playing === i ? "■ Parar" : "▶ Escuchar"}
            </button>
            {t !== SAMPLES[i] ? (
              <button
                type="button"
                style={btn}
                onClick={() => setTexts((all) => all.map((x, j) => (j === i ? SAMPLES[i] : x)))}
              >
                ↺ Original
              </button>
            ) : null}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" style={{ ...btn, background: "white", color: "#1d3a8a", fontWeight: 700 }} onClick={send}>
          📤 Enviar a Claude
        </button>
        {sent ? <span style={{ fontSize: 13 }}>Enviado a las {sent}</span> : null}
        {!relayOn ? (
          <span style={{ fontSize: 13, opacity: 0.85 }}>
            ⚠️ Abre esta página con <code>?devlog=…</code> para que llegue.
          </span>
        ) : null}
      </div>
    </div>
  );
}
