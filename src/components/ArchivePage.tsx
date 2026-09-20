import { useMemo } from "react";
import { dateForDailyGameNo, formatDateShortES, formatWeekdayShortES } from "../lib/dailyIssue";
import { firstAttempts } from "../stats/aggregate";
import type { GameResult } from "../stats/types";
import {
  ghostPillStyle,
  iconButtonStyle,
  panelStyle,
  primaryPillStyle,
  quietPillStyle,
  sectionTitleStyle,
  statsTheme,
} from "./statsTheme";

export const SUBSCRIPTION_PRICE_LABEL = "3,99 €/mes";

type Props = {
  todayGameNo: number;
  results: GameResult[];
  signedIn: boolean;
  accountsEnabled: boolean;
  isSubscriber: boolean;
  /** Games whose question set exists in the build. Today's always does. */
  playableGames: number[];
  /** How many games back the list goes. */
  windowSize?: number;
  onBack: () => void;
  onPlayGame: (gameNo: number) => void;
  onSubscribe: () => void;
  onSignIn: () => void;
  /** Shown under the paywall card, e.g. while Stripe is not wired yet. */
  notice?: string | null;
};

export default function ArchivePage({
  todayGameNo,
  results,
  signedIn,
  accountsEnabled,
  isSubscriber,
  playableGames,
  windowSize = 30,
  onBack,
  onPlayGame,
  onSubscribe,
  onSignIn,
  notice,
}: Props) {
  const playedByGameNo = useMemo(() => {
    const map = new Map<number, GameResult>();
    for (const result of firstAttempts(results)) {
      if (!map.has(result.gameNo)) map.set(result.gameNo, result);
    }
    return map;
  }, [results]);

  const playable = useMemo(() => new Set(playableGames), [playableGames]);

  const rows = useMemo(() => {
    const oldest = Math.max(1, todayGameNo - windowSize + 1);
    const list: number[] = [];
    for (let gameNo = todayGameNo; gameNo >= oldest; gameNo--) list.push(gameNo);
    return list;
  }, [todayGameNo, windowSize]);

  return (
    <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 20, paddingBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" aria-label="Volver" onClick={onBack} style={iconButtonStyle}>
          ←
        </button>
        <h1 style={sectionTitleStyle}>Archivo</h1>
      </div>

      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: statsTheme.muted }}>
        Juega los días que te perdiste o repite uno que ya hayas jugado.
      </p>

      {!isSubscriber ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 18,
            borderRadius: 22,
            background: statsTheme.fill,
            border: `1px solid ${statsTheme.hairline}`,
          }}
        >
          <div style={{ fontFamily: statsTheme.serif, fontSize: 20, fontWeight: 700 }}>
            El archivo es para suscriptores
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: statsTheme.muted }}>
            El juego de hoy es gratis siempre. Con la suscripción puedes jugar cualquier juego anterior.
          </div>
          {accountsEnabled ? (
            <button
              type="button"
              onClick={signedIn ? onSubscribe : onSignIn}
              style={{ ...primaryPillStyle, width: "100%" }}
            >
              {signedIn ? `Suscribirme por ${SUBSCRIPTION_PRICE_LABEL}` : "Inicia sesión para suscribirte"}
            </button>
          ) : (
            <div style={{ fontSize: 13, color: statsTheme.muted }}>
              Las cuentas no están configuradas en esta versión.
            </div>
          )}
          {notice ? (
            <div style={{ fontSize: 13, lineHeight: 1.45, color: statsTheme.muted }} role="status">
              {notice}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((gameNo) => {
          const date = dateForDailyGameNo(gameNo);
          const result = playedByGameNo.get(gameNo);
          const isToday = gameNo === todayGameNo;
          const locked = !isToday && !isSubscriber;
          const available = playable.has(gameNo);

          const ctaLabel = result ? "Repetir" : "Jugar";
          let note: string;

          if (result) {
            note = `${result.correctCount}/25 aciertos`;
          } else if (isToday) {
            note = "Sin jugar";
          } else {
            note = "Sin jugar";
          }
          if (!locked && !available) note = `${note} · aún no disponible`;

          return (
            <div
              key={gameNo}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 16px",
                borderRadius: 22,
                background: isToday ? "rgba(255, 255, 255, 0.22)" : statsTheme.fill,
                border: isToday ? "1px solid rgba(255, 255, 255, 0.55)" : `1px solid ${statsTheme.hairline}`,
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 16,
                  background: "rgba(255, 255, 255, 0.18)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontFamily: statsTheme.serif, fontSize: 18, fontWeight: 700, lineHeight: 1 }}>
                  {date.getDate()}
                </span>
                <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: statsTheme.muted }}>
                  {formatWeekdayShortES(date)}
                </span>
              </div>

              <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}>
                  {isToday ? "Juego de hoy" : `Juego n.º ${gameNo}`}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.35, color: statsTheme.muted }}>
                  {formatDateShortES(date)} · {note}
                </div>
              </div>

              {/* Locked rows carry a lock, not a second call to action: the card
                  at the top of the list is the one place to subscribe. */}
              {locked ? (
                <button
                  type="button"
                  aria-label={`Desbloquear el juego n.º ${gameNo}`}
                  onClick={signedIn ? onSubscribe : onSignIn}
                  style={{
                    ...iconButtonStyle,
                    border: `1px solid ${statsTheme.hairline}`,
                    fontSize: 16,
                  }}
                >
                  <span aria-hidden>🔒</span>
                </button>
              ) : available ? (
                <button
                  type="button"
                  onClick={() => onPlayGame(gameNo)}
                  style={{
                    ...(isToday ? primaryPillStyle : quietPillStyle),
                    minHeight: 44,
                    padding: "0 18px",
                    fontSize: 14,
                    whiteSpace: "nowrap",
                  }}
                >
                  {ctaLabel}
                </button>
              ) : (
                <span style={{ fontSize: 12, color: statsTheme.muted, whiteSpace: "nowrap" }}>Pronto</span>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" onClick={onBack} style={{ ...ghostPillStyle, width: "100%" }}>
        Volver
      </button>
    </div>
  );
}
