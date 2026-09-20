import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SPANISH_LETTERS } from "../data/sets";
import type { GameResult } from "../stats/types";
import { bucketIndexFor, type Stats } from "../stats/aggregate";
import StatsRing, { type RingNode } from "./StatsRing";
import {
  ghostPillStyle,
  iconButtonStyle,
  panelStyle,
  primaryPillStyle,
  sectionTitleStyle,
  statsTheme,
  tileStyle,
} from "./statsTheme";

type Props = {
  /** The rosco just played (or today's, when reopened). Null = nothing played yet. */
  result: GameResult | null;
  stats: Stats;
  gameNo: number;
  dateLabel: string;
  signedIn: boolean;
  accountsEnabled: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenArchive: () => void;
  onSignIn: () => void;
  onShare: () => void;
};

function msUntilTomorrow(now: Date): number {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return tomorrow.getTime() - now.getTime();
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function useCountdown(): string {
  const [ms, setMs] = useState(() => msUntilTomorrow(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setMs(msUntilTomorrow(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);
  return formatCountdown(ms);
}

export default function StatsSheet({
  result,
  stats,
  gameNo,
  dateLabel,
  signedIn,
  accountsEnabled,
  onClose,
  onOpenProfile,
  onOpenArchive,
  onSignIn,
  onShare,
}: Props) {
  const countdown = useCountdown();

  const ringNodes: RingNode[] = useMemo(
    () =>
      SPANISH_LETTERS.map((letter) => {
        const status = result?.letters?.[letter];
        if (status === "correct") {
          return { label: letter, bg: statsTheme.correct, fg: "#ffffff", title: `${letter} · acertada` };
        }
        if (status === "wrong") {
          return { label: letter, bg: statsTheme.wrong, fg: "#ffffff", title: `${letter} · fallada` };
        }
        return { label: letter, bg: statsTheme.unresolved, fg: "#ffffff", title: `${letter} · sin resolver` };
      }),
    [result]
  );

  const todayBucket = result ? bucketIndexFor(result.correctCount) : -1;
  const maxBucket = Math.max(1, ...stats.distribution.map((b) => b.count));

  return (
    <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 28, paddingBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button type="button" aria-label="Cerrar" onClick={onClose} style={iconButtonStyle}>
          ✕
        </button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: statsTheme.serif, fontSize: 20, fontWeight: 700 }}>Rosco n.º {gameNo}</div>
          <div style={{ fontSize: 12, color: statsTheme.muted, marginTop: 2 }}>{dateLabel}</div>
        </div>
        <button
          type="button"
          onClick={onOpenProfile}
          style={{
            minWidth: 44,
            height: 44,
            padding: "0 14px",
            background: "transparent",
            border: "1px solid rgba(255, 255, 255, 0.4)",
            borderRadius: 9999,
            color: statsTheme.text,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Perfil
        </button>
      </div>

      {result ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <StatsRing
            nodes={ringNodes}
            size={250}
            nodeSize={26}
            ariaLabel={`Rosco de hoy: ${result.correctCount} aciertos de 25`}
          >
            <div style={{ fontFamily: statsTheme.serif, fontSize: 60, fontWeight: 700, lineHeight: 1 }}>
              {result.correctCount}
              <span style={{ fontSize: 26, color: statsTheme.muted }}>/25</span>
            </div>
            <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: statsTheme.muted }}>
              aciertos
            </div>
          </StatsRing>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <Chip glyph="✓" tint={statsTheme.correct} label={`${result.correctCount} bien`} />
            <Chip glyph="✗" tint={statsTheme.wrong} label={`${result.wrongCount} mal`} />
            <Chip
              glyph="↻"
              tint={statsTheme.unresolved}
              label={`${result.passedCount + result.unansweredCount} sin resolver`}
            />
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, textAlign: "center", color: statsTheme.muted, fontSize: 16, lineHeight: 1.5 }}>
          Todavía no has jugado el rosco de hoy.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        <Tile value={String(stats.played)} label={<>roscos<br />jugados</>} />
        <Tile value={`${stats.averagePct}%`} label={<>media de<br />aciertos</>} />
        <Tile value={String(stats.perfectCount)} label={<>roscos<br />completos</>} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <h2 style={sectionTitleStyle}>Aciertos por rosco</h2>
          <span style={{ fontSize: 13, color: statsTheme.muted }}>
            {stats.played} {stats.played === 1 ? "partida" : "partidas"}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {stats.distribution.map((bucket, index) => {
            const isToday = index === todayBucket;
            return (
              <div key={bucket.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    textAlign: "right",
                    fontSize: 13,
                    color: statsTheme.muted,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {bucket.label}
                </div>
                <div style={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      height: 26,
                      width: `${Math.max(4, (bucket.count / maxBucket) * 100)}%`,
                      maxWidth: "72%",
                      borderRadius: 9999,
                      background: isToday ? "#ffffff" : statsTheme.fillStrong,
                    }}
                  />
                  <div style={{ fontSize: 13, fontWeight: 700, color: statsTheme.text }}>{bucket.count}</div>
                  {isToday ? (
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "0.12em",
                        padding: "4px 8px",
                        borderRadius: 9999,
                        background: "#ffffff",
                        color: statsTheme.ink,
                      }}
                    >
                      HOY
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {accountsEnabled && !signedIn ? (
        <button
          type="button"
          onClick={onSignIn}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "14px 18px",
            borderRadius: 20,
            background: statsTheme.fill,
            border: `1px solid ${statsTheme.hairline}`,
            color: statsTheme.text,
            fontSize: 14,
            textAlign: "left",
            cursor: "pointer",
            lineHeight: 1.4,
          }}
        >
          <span>Estos roscos están solo en este móvil.</span>
          <strong style={{ whiteSpace: "nowrap" }}>Guardarlos →</strong>
        </button>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
        <button
          type="button"
          onClick={onShare}
          disabled={!result}
          style={{ ...primaryPillStyle, width: "100%", opacity: result ? 1 : 0.55 }}
        >
          Compartir
        </button>
        <button type="button" onClick={onOpenArchive} style={{ ...ghostPillStyle, width: "100%" }}>
          Roscos anteriores
        </button>
        <div style={{ textAlign: "center", fontSize: 13, color: statsTheme.muted }}>
          Siguiente rosco en{" "}
          <strong style={{ fontVariantNumeric: "tabular-nums", color: statsTheme.text }}>{countdown}</strong>
        </div>
      </div>
    </div>
  );
}

function Chip({ glyph, tint, label }: { glyph: string; tint: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 9999,
        background: statsTheme.fill,
        border: `1px solid ${statsTheme.hairline}`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: 9999,
          background: tint,
          color: "#ffffff",
          fontSize: 11,
          fontWeight: 900,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
      >
        {glyph}
      </span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: ReactNode }) {
  return (
    <div style={tileStyle}>
      <div style={{ fontFamily: statsTheme.serif, fontSize: 32, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, lineHeight: 1.3, textAlign: "center", color: statsTheme.muted }}>{label}</div>
    </div>
  );
}
