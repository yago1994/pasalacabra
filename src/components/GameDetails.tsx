import { useState } from "react";
import type { DifficultyMode } from "../game/engine";
import type { Topic } from "../questions/types";
import { isStagingMode } from "../env/getSpeechTokenUrl";

export type SetupPlayer = { name: string; setId: string };

export interface GameDetailsProps {
  setupPlayerCount: number;
  setSetupPlayerCount: (count: number) => void;
  difficultyMode: DifficultyMode;
  setDifficultyMode: (mode: DifficultyMode) => void;
  setupPlayers: SetupPlayer[];
  setSetupPlayers: (players: SetupPlayer[] | ((prev: SetupPlayer[]) => SetupPlayer[])) => void;
  selectedTopics: Set<Topic>;
  setSelectedTopics: (topics: Set<Topic> | ((prev: Set<Topic>) => Set<Topic>)) => void;
  topicSelectionError: string;
  setTopicSelectionError: (error: string) => void;
  testMode: boolean;
  setTestMode: (mode: boolean) => void;
  sttPreflightChecking: boolean;
  sttError: string | null;
  cameraError: string;
  onStart: () => void;
  onBack: () => void;
}

const allTopics: { value: Topic; label: string }[] = [
  { value: "astronomia", label: "🌃 Astronomía" },
  { value: "biologia", label: "🌱 Biología" },
  { value: "musica", label: "🎵 Música" },
  { value: "deporte", label: "🏆 Deporte" },
  { value: "ciencia", label: "🔬 Ciencia" },
  { value: "cine", label: "🎥 Cine" },
  { value: "historia", label: "🗺️ Historia" },
  { value: "geografia", label: "🌍 Geografía" },
  { value: "arte", label: "🎨 Arte" },
  { value: "folklore", label: "✨ Folklore" },
  { value: "culturageneral", label: "📚 Cultura" },
];

export default function GameDetails({
  setupPlayerCount,
  setSetupPlayerCount,
  difficultyMode,
  setDifficultyMode,
  setupPlayers,
  setSetupPlayers,
  selectedTopics,
  setSelectedTopics,
  topicSelectionError,
  setTopicSelectionError,
  testMode,
  setTestMode,
  sttPreflightChecking,
  sttError,
  cameraError,
  onStart,
  onBack,
}: GameDetailsProps) {
  const [showHowToPlay, setShowHowToPlay] = useState<boolean>(false);
  const [showAbout, setShowAbout] = useState<boolean>(false);

  return (
    <div className="center">
      <div className="setupCard">
        <div style={{ position: "relative", marginBottom: "20px" }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              background: "transparent",
              border: "none",
              color: "var(--text)",
              cursor: "pointer",
              padding: "8px",
              fontSize: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            aria-label="Volver"
          >
            ←
          </button>
          <div className="setupTitle" style={{ textAlign: "center" }}>Jugadores</div>
        </div>

        <label className="setupLabel">
          Número de jugadores
          <select
            className="setupSelect"
            value={setupPlayerCount}
            onChange={(e) => setSetupPlayerCount(Number(e.target.value))}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="setupLabel" style={{ marginTop: 24 }}>
          Dificultad
          <select
            className="setupSelect"
            value={difficultyMode}
            onChange={(e) => setDifficultyMode(e.target.value as DifficultyMode)}
          >
            <option value="dificil">
              Difícil: {isStagingMode() ? "2s" : "3 mins"}
            </option>
            <option value="medio">
              Media: {isStagingMode() ? "15s" : "4 mins"}
            </option>
            <option value="facil">
              Fácil: {isStagingMode() ? "30s" : "5 mins"}
            </option>
          </select>
        </label>

        <div className="setupPlayers">
          {Array.from({ length: setupPlayerCount }, (_, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <span style={{ minWidth: 80, fontSize: "0.95rem" }}>
                Jugador {i + 1}
              </span>
              <input
                className="setupInput"
                style={{ flex: 1, margin: 0 }}
                value={setupPlayers[i]?.name ?? ""}
                placeholder="Nombre"
                onChange={(e) => {
                  const v = e.target.value;
                  setSetupPlayers((prev) => {
                    const copy = [...prev];
                    const cur = copy[i] ?? { name: "", setId: "set_04" };
                    copy[i] = { ...cur, name: v };
                    return copy;
                  });
                }}
              />
            </div>
          ))}
        </div>

        {/* Test Mode Toggle - Visible in staging */}
        {isStagingMode() && (
          <label
            className="testModeToggle"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 24,
              padding: "10px 14px",
              background: testMode
                ? "rgba(255,200,0,0.2)"
                : "rgba(255,255,255,0.1)",
              borderRadius: 8,
              cursor: "pointer",
              border: testMode
                ? "1px solid rgba(255,200,0,0.5)"
                : "1px solid transparent",
            }}
          >
            <input
              type="checkbox"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
              style={{ width: 18, height: 18, cursor: "pointer" }}
            />
            <span>🧪 Modo Test (usa Set 4 predefinido)</span>
          </label>
        )}

        {!testMode && (
          <>
            <div className="setupTitle" style={{ marginTop: 24 }}>
              Temas
            </div>

            <div className="topicTabs">
              {allTopics.map(({ value, label }) => {
                const isSelected = selectedTopics.has(value);
                return (
                  <button
                    key={value}
                    type="button"
                    className={`topicTab ${!isSelected ? "topicTabUnselected" : ""}`}
                    onClick={() => {
                      setSelectedTopics((prev) => {
                        const next = new Set(prev);
                        if (next.has(value)) {
                          next.delete(value);
                        } else {
                          next.add(value);
                        }
                        return next;
                      });
                      // Clear error when user selects a topic
                      if (topicSelectionError) {
                        setTopicSelectionError("");
                      }
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {topicSelectionError && (
              <div
                className="answerReveal"
                style={{ marginTop: 12, color: "#ffffff" }}
              >
                ⚠️ {topicSelectionError}
              </div>
            )}
          </>
        )}

        <div className="setupActions">
          <button className="btnPrimary" type="button" onClick={onStart}>
            Continuar
          </button>
        </div>

        {sttPreflightChecking ? (
          <div className="answerReveal" style={{ marginTop: 8 }}>
            Preparando reconocimiento de voz…
          </div>
        ) : sttError ? (
          <div className="answerReveal" style={{ marginTop: 8 }}>
            ⚠️ {sttError}
          </div>
        ) : (
          <div className="answerReveal" style={{ marginTop: 8 }}>
            Listo
          </div>
        )}

        {/* How to Play Drawer */}
        <div className="howToPlaySection" style={{ marginTop: 24 }}>
          <button
            type="button"
            className="howToPlayToggle"
            onClick={() => setShowHowToPlay(!showHowToPlay)}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 8,
              padding: "10px 16px",
              color: "#fff",
              cursor: "pointer",
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "1rem",
            }}
          >
            <span>📖 Cómo Jugar</span>
            <span
              style={{
                transform: showHowToPlay ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            >
              ▼
            </span>
          </button>

          {showHowToPlay && (
            <div
              className="howToPlayContent"
              style={{
                marginTop: 12,
                padding: 16,
                background: "rgba(0,0,0,0.3)",
                borderRadius: 8,
                textAlign: "left",
                lineHeight: 1.6,
              }}
            >
              <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem" }}>
                🎯 Objetivo
              </h3>
              <p style={{ margin: "0 0 16px 0", opacity: 0.9 }}>
                Conoces este juego 😉. Responde correctamente a las preguntas
                de cada letra del abecedario lo más rápido que puedas. El
                jugador con más aciertos gana. Prueba a conectar el teléfono a
                la tele y pruébalo en familia.
              </p>

              <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem" }}>
                🎮 Cómo se juega
              </h3>
              <ul style={{ margin: "0 0 16px 0", paddingLeft: 20, opacity: 0.9 }}>
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

              <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem" }}>
                ⏱️ El tiempo
              </h3>
              <p style={{ margin: "0 0 16px 0", opacity: 0.9 }}>
                Cada jugador 3 minutos en total. El tiempo solo corre durante tu
                turno. Si eres el último jugador, puedes seguir hasta que se te
                agote el tiempo.
              </p>

              <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem" }}>
                🏆 Puntuación
              </h3>
              <ul style={{ margin: 0, paddingLeft: 20, opacity: 0.9 }}>
                <li>✓ Acierto = +1 punto</li>
                <li>✗ Fallo = penalización en desempate</li>
                <li>Pasalacabra = sin penalización</li>
              </ul>
            </div>
          )}
        </div>

        {/* About Drawer */}
        <div className="howToPlaySection" style={{ marginTop: 24 }}>
          <button
            type="button"
            className="howToPlayToggle"
            onClick={() => setShowAbout(!showAbout)}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 8,
              padding: "10px 16px",
              color: "#fff",
              cursor: "pointer",
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "1rem",
            }}
          >
            <span>❓ ¿Y esto de dónde ha salido?</span>
            <span
              style={{
                transform: showAbout ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            >
              ▼
            </span>
          </button>

          {showAbout && (
            <div
              className="howToPlayContent"
              style={{
                marginTop: 12,
                padding: 16,
                background: "rgba(0,0,0,0.3)",
                borderRadius: 8,
                textAlign: "left",
                lineHeight: 1.6,
              }}
            >
              <p style={{ margin: "0 0 16px 0", opacity: 0.9 }}>
                Pues mira, por una parte a mi abuela le encantaba este programa
                y no se perdía una, así que esto va por ella.
              </p>
              <p style={{ margin: "0 0 16px 0", opacity: 0.9 }}>
                Y por otra, demasiadas cenas de Navidad hablando de política
                que podían ser mucho más entretenidas.
              </p>
              <p style={{ margin: 0, opacity: 0.9 }}>
                ¡Que os divirtáis! Cualquier cosa, sugerencias, ideas, o si
                queréis contribuir al proyecto, mandad un email a
                info(arroba)pasalacabra.com
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
