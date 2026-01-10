import { useMemo, useState } from "react";

/**
 * Pasalacabra home screen
 *
 * Tweak these two constants to control daily numbering.
 * If you want "No." to be smaller earlier, set LAUNCH_DATE_ISO to a later date
 * or reduce BASE_GAME_NO.
 */
const LAUNCH_DATE_ISO = "2026-01-01"; // YYYY-MM-DD (local)
const BASE_GAME_NO = 1;

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetweenLocal(a: Date, b: Date) {
  const ms = startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function formatDateLongES(d: Date) {
  return new Intl.DateTimeFormat("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export interface HomePageProps {
  onPlayGroup: () => void;
  onPlay?: () => void;
  onHowToPlay?: () => void;
  onAbout?: () => void;
}

export default function HomePage({ onPlayGroup, onPlay, onHowToPlay, onAbout }: HomePageProps) {
  const today = useMemo(() => new Date(), []);
  const [showHowToPlay, setShowHowToPlay] = useState<boolean>(false);
  const [showAbout, setShowAbout] = useState<boolean>(false);

  const gameNo = useMemo(() => {
    const launch = new Date(`${LAUNCH_DATE_ISO}T00:00:00`);
    const delta = daysBetweenLocal(launch, today);
    // If someone opens before launch date, clamp to BASE_GAME_NO.
    return BASE_GAME_NO + Math.max(0, delta);
  }, [today]);

  return (
    <div className="center">
      <div style={{ 
        width: "min(92vw, 420px)", 
        padding: "clamp(16px, 4vw, 24px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        color: "var(--text)"
      }}>
        {/* Header / Icon */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ marginBottom: "clamp(16px, 4vw, 24px)", marginTop: "clamp(8px, 2vw, 8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ 
              height: "clamp(48px, 12vw, 64px)", 
              width: "clamp(48px, 12vw, 64px)", 
              borderRadius: "16px", 
              background: "rgba(255, 255, 255, 0.15)", 
              border: "1px solid rgba(255, 255, 255, 0.2)", 
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <span style={{ fontSize: "clamp(36px, 9vw, 48px)", transform: "scaleX(-1)" }} aria-label="Icono Pasalacabra">
                🐐
              </span>
            </div>
          </div>

          <h1 style={{ 
            fontSize: "clamp(36px, 10vw, 48px)", 
            fontWeight: 900, 
            letterSpacing: "-0.02em",
            fontFamily: "ui-serif, Georgia, Times, serif",
            margin: 0,
            color: "var(--text)"
          }}>
            Pasalacabra
          </h1>

          <p style={{ marginTop: "clamp(12px, 3vw, 16px)", fontSize: "clamp(16px, 4vw, 20px)", color: "rgba(255, 255, 255, 0.9)" }}>
            Conoces este juego 😉. Intenta terminar la rueda diaria antes de que se acabe el tiempo.
          </p>
        </div>

        {/* Primary actions */}
        <div style={{ marginTop: "clamp(32px, 8vw, 40px)", width: "100%", display: "flex", flexDirection: "column", gap: "clamp(10px, 2.5vw, 12px)" }}>
          <button
            className="btnPrimary"
            style={{ 
              width: "100%", 
              borderRadius: "9999px", 
              padding: "clamp(14px, 3.5vw, 16px)",
              fontSize: "clamp(16px, 4vw, 18px)",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              transition: "transform 0.1s",
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.99)"}
            onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
            onClick={onPlay}
          >
            Juego de hoy
          </button>

          <div style={{ marginTop: "clamp(10px, 2.5vw, 12px)", marginBottom: "clamp(10px, 2.5vw, 12px)", textAlign: "center", fontSize: "clamp(12px, 3vw, 14px)", color: "rgba(255, 255, 255, 0.75)" }}>
            O personaliza tu propio juego para jugar en familia o amigos o solo.
          </div>

          <button
            style={{ 
              width: "100%", 
              borderRadius: "9999px", 
              background: "transparent",
              border: "2px solid rgba(255, 255, 255, 0.8)",
              color: "var(--text)",
              padding: "clamp(14px, 3.5vw, 16px)",
              fontSize: "clamp(16px, 4vw, 18px)",
              fontWeight: 600,
              cursor: "pointer",
              transition: "transform 0.1s",
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.99)"}
            onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
            onClick={onPlayGroup}
          >
            Crea tu proprio juego
          </button>
        </div>

        {/* Secondary actions */}
        <div style={{ marginTop: "clamp(24px, 6vw, 32px)", width: "100%", display: "flex", flexDirection: "column", gap: "clamp(10px, 2.5vw, 12px)" }}>
          <div>
            <button
              style={{ 
                width: "100%", 
                borderRadius: "9999px", 
                background: "transparent",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                color: "var(--text)",
                padding: "clamp(10px, 2.5vw, 12px)",
                fontSize: "clamp(14px, 3.5vw, 16px)",
                fontWeight: 600,
                cursor: "pointer",
                transition: "transform 0.1s",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
              onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.99)"}
              onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
              onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
              onClick={() => {
                setShowHowToPlay(!showHowToPlay);
                if (onHowToPlay) onHowToPlay();
              }}
            >
              <span>📖  Cómo Jugar</span>
              <span
                style={{
                  transform: showHowToPlay ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                  fontSize: "clamp(10px, 2.5vw, 12px)",
                }}
              >
                ▼
              </span>
            </button>

            {showHowToPlay && (
              <div
                style={{
                  marginTop: "clamp(10px, 2.5vw, 12px)",
                  padding: "clamp(12px, 3vw, 16px)",
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: "clamp(12px, 3vw, 16px)",
                  textAlign: "left",
                  lineHeight: 1.6,
                }}
              >
                <h3 style={{ margin: "0 0 clamp(10px, 2.5vw, 12px) 0", fontSize: "clamp(1rem, 2.5vw, 1.1rem)" }}>
                  🎯 Objetivo
                </h3>
                <p style={{ margin: "0 0 clamp(12px, 3vw, 16px) 0", opacity: 0.9, fontSize: "clamp(14px, 3.5vw, 16px)" }}>
                  Conoces este juego 😉. Responde correctamente a las preguntas
                  de cada letra del abecedario lo más rápido que puedas. El
                  jugador con más aciertos gana. Prueba a conectar el teléfono a
                  la tele y pruébalo en familia.
                </p>

                <h3 style={{ margin: "0 0 clamp(10px, 2.5vw, 12px) 0", fontSize: "clamp(1rem, 2.5vw, 1.1rem)" }}>
                  🎮 Cómo se juega
                </h3>
                <ul style={{ margin: "0 0 clamp(12px, 3vw, 16px) 0", paddingLeft: "clamp(16px, 4vw, 20px)", opacity: 0.9, fontSize: "clamp(14px, 3.5vw, 16px)" }}>
                  <li>El narrador lee una pregunta en voz alta</li>
                  <li>Responde hablando cuando escuches el pitido</li>
                  <li>Si aciertas, pasas a la siguiente letra</li>
                  <li>Si fallas, termina tu turno</li>
                  <li>
                    Di <strong>"Pasalacabra"</strong> para saltar la pregunta
                  </li>
                  <li>
                    Si te equivocas, puedes usar el botón de "Oye! La respuesta
                    era correcta" para corregir tu respuesta
                  </li>
                </ul>

                <h3 style={{ margin: "0 0 clamp(10px, 2.5vw, 12px) 0", fontSize: "clamp(1rem, 2.5vw, 1.1rem)" }}>
                  ⏱️ El tiempo
                </h3>
                <p style={{ margin: "0 0 clamp(12px, 3vw, 16px) 0", opacity: 0.9, fontSize: "clamp(14px, 3.5vw, 16px)" }}>
                  Cada jugador 3 minutos en total. El tiempo solo corre durante tu
                  turno. Si eres el último jugador, puedes seguir hasta que se te
                  agote el tiempo.
                </p>

                <h3 style={{ margin: "0 0 clamp(10px, 2.5vw, 12px) 0", fontSize: "clamp(1rem, 2.5vw, 1.1rem)" }}>
                  🏆 Puntuación
                </h3>
                <ul style={{ margin: 0, paddingLeft: "clamp(16px, 4vw, 20px)", opacity: 0.9, fontSize: "clamp(14px, 3.5vw, 16px)" }}>
                  <li>✓ Acierto = +1 punto</li>
                  <li>✗ Fallo = penalización en desempate</li>
                  <li>Pasalacabra = sin penalización</li>
                </ul>
              </div>
            )}
          </div>

          <div>
            <button
              style={{ 
                width: "100%", 
                borderRadius: "9999px", 
                background: "transparent",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                color: "var(--text)",
                padding: "clamp(10px, 2.5vw, 12px)",
                fontSize: "clamp(14px, 3.5vw, 16px)",
                fontWeight: 600,
                cursor: "pointer",
                transition: "transform 0.1s",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
              onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.99)"}
              onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
              onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
              onClick={() => {
                setShowAbout(!showAbout);
                if (onAbout) onAbout();
              }}
            >
              <span>❓ ¿Y esto de dónde ha salido?</span>
              <span
                style={{
                  transform: showAbout ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                  fontSize: "clamp(10px, 2.5vw, 12px)",
                }}
              >
                ▼
              </span>
            </button>

            {showAbout && (
              <div
                style={{
                  marginTop: "clamp(10px, 2.5vw, 12px)",
                  padding: "clamp(12px, 3vw, 16px)",
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: "clamp(12px, 3vw, 16px)",
                  textAlign: "left",
                  lineHeight: 1.6,
                }}
              >
                <p style={{ margin: "0 0 clamp(12px, 3vw, 16px) 0", opacity: 0.9, fontSize: "clamp(14px, 3.5vw, 16px)" }}>
                  Pues mira, por una parte a mi abuela le encantaba este programa
                  y no se perdía una, así que esto va por ella.
                </p>
                <p style={{ margin: "0 0 clamp(12px, 3vw, 16px) 0", opacity: 0.9, fontSize: "clamp(14px, 3.5vw, 16px)" }}>
                  Y por otra, demasiadas cenas de Navidad hablando de política
                  que podían ser mucho más entretenidas.
                </p>
                <p style={{ margin: 0, opacity: 0.9, fontSize: "clamp(14px, 3.5vw, 16px)" }}>
                  ¡Que os divirtáis! Cualquier cosa, sugerencias, ideas, o si
                  queréis contribuir al proyecto, mandad un email a
                  info(arroba)pasalacabra.com
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: "clamp(32px, 8vw, 40px)", textAlign: "center" }}>
          <div style={{ fontSize: "clamp(16px, 4vw, 20px)", fontWeight: 600 }}>{formatDateLongES(today)}</div>
          <div style={{ marginTop: "clamp(3px, 1vw, 4px)", fontSize: "clamp(14px, 3.5vw, 18px)", color: "rgba(255, 255, 255, 0.8)" }}>No. {gameNo}</div>
        </div>
      </div>
    </div>
  );
}
