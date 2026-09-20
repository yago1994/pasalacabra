import { useMemo } from "react";
import { SPANISH_LETTERS } from "../data/sets";
import { formatDuration, type Stats } from "../stats/aggregate";
import StatsRing, { type RingNode } from "./StatsRing";
import {
  ACCURACY_RAMP,
  accuracyStep,
  ghostPillStyle,
  iconButtonStyle,
  panelStyle,
  primaryPillStyle,
  quietPillStyle,
  sectionTitleStyle,
  statsTheme,
  tileStyle,
} from "./statsTheme";

type Props = {
  displayName: string | null;
  email: string | null;
  memberSince: string | null;
  stats: Stats;
  loading: boolean;
  isSubscriber: boolean;
  signedIn: boolean;
  accountsEnabled: boolean;
  /** Games just pulled off this device into the account, for the welcome line. */
  migratedCount: number;
  onBack: () => void;
  onOpenArchive: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
};

function initialsFor(name: string | null, email: string | null): string {
  const source = (name ?? email ?? "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

export default function ProfilePage({
  displayName,
  email,
  memberSince,
  stats,
  loading,
  isSubscriber,
  signedIn,
  accountsEnabled,
  migratedCount,
  onBack,
  onOpenArchive,
  onSignIn,
  onSignOut,
}: Props) {
  const ringNodes: RingNode[] = useMemo(() => {
    const byLetter = new Map(stats.letters.map((l) => [l.letter, l]));
    return SPANISH_LETTERS.map((letter) => {
      const stat = byLetter.get(letter);
      const step = accuracyStep(stat?.pct ?? null);
      return {
        label: letter,
        bg: step.bg,
        fg: step.fg,
        title:
          stat && stat.pct !== null
            ? `${letter} · ${stat.pct}% de aciertos (${stat.seen} roscos)`
            : `${letter} · sin datos todavía`,
      };
    });
  }, [stats.letters]);

  return (
    <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 30, paddingBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" aria-label="Volver" onClick={onBack} style={iconButtonStyle}>
          ←
        </button>
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 18,
            background: statsTheme.fill,
            border: `1px solid ${statsTheme.hairline}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: statsTheme.serif,
            fontSize: 20,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {signedIn ? (
            initialsFor(displayName, email)
          ) : (
            <span style={{ transform: "scaleX(-1)", fontSize: 28 }} aria-hidden>
              🐐
            </span>
          )}
        </div>
        <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <div
            style={{
              fontFamily: statsTheme.serif,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {signedIn ? displayName ?? "Tu perfil" : "Tus roscos"}
          </div>
          <div style={{ fontSize: 13, color: statsTheme.muted }}>
            {stats.played} {stats.played === 1 ? "rosco" : "roscos"}
            {signedIn && memberSince ? ` · desde ${memberSince}` : signedIn ? "" : " · solo en este móvil"}
          </div>
          {/* Which account this is — the thing you check before signing out. */}
          {signedIn && email ? (
            <div
              style={{
                fontSize: 13,
                color: statsTheme.muted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {email}
            </div>
          ) : null}
        </div>
      </div>

      {migratedCount > 0 ? (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 18,
            background: statsTheme.fill,
            border: `1px solid ${statsTheme.hairline}`,
            fontSize: 14,
            lineHeight: 1.45,
          }}
          role="status"
        >
          {migratedCount === 1
            ? "He añadido la partida que tenías en este móvil."
            : `He añadido las ${migratedCount} partidas que tenías en este móvil.`}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={sectionTitleStyle}>Tu rosco de siempre</h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: statsTheme.muted }}>
            Cuanto más blanca la letra, más veces la has acertado.
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <StatsRing
            nodes={ringNodes}
            size={300}
            nodeSize={30}
            ariaLabel="Tu porcentaje de aciertos letra a letra"
          >
            <div style={{ fontFamily: statsTheme.serif, fontSize: 52, fontWeight: 700, lineHeight: 1 }}>
              {stats.averagePct}%
            </div>
            <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: statsTheme.muted }}>
              de media
            </div>
          </StatsRing>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center" }}>
          <span style={{ fontSize: 12, color: statsTheme.muted }}>0%</span>
          <div style={{ display: "flex", gap: 3 }}>
            {ACCURACY_RAMP.map((color) => (
              <div
                key={color}
                style={{
                  width: 28,
                  height: 12,
                  borderRadius: 9999,
                  background: color,
                  border: "1px solid rgba(255, 255, 255, 0.25)",
                  boxSizing: "border-box",
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 12, color: statsTheme.muted }}>100%</span>
        </div>

        {stats.bestLetter && stats.worstLetter ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <LetterCard
              letter={stats.bestLetter.letter}
              caption="Tu mejor letra"
              value={`${stats.bestLetter.pct}% acertadas`}
              solid
            />
            <LetterCard
              letter={stats.worstLetter.letter}
              caption="Tu bestia negra"
              value={`${stats.worstLetter.pct}% acertadas`}
            />
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: statsTheme.muted, textAlign: "center" }}>
            {loading
              ? "Cargando tus roscos…"
              : "Juega unos cuantos roscos y aquí saldrán tu mejor letra y tu bestia negra."}
          </p>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={sectionTitleStyle}>Marcas personales</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <Tile value={String(stats.perfectCount)} label="roscos completos" />
          <Tile value={`${stats.bestScore}/25`} label="tu mejor rosco" />
          <Tile value={formatDuration(stats.fastestSeconds)} label="rosco completo más rápido" />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
        <button type="button" onClick={onOpenArchive} style={{ ...ghostPillStyle, width: "100%" }}>
          Ver roscos anteriores
        </button>
        {isSubscriber ? (
          <div style={{ fontSize: 13, textAlign: "center", color: statsTheme.muted }}>
            Suscripción activa · puedes jugar cualquier rosco anterior
          </div>
        ) : null}
        {signedIn ? (
          <button
            type="button"
            onClick={onSignOut}
            style={{
              ...quietPillStyle,
              width: "100%",
              color: statsTheme.muted,
            }}
          >
            Cerrar sesión
          </button>
        ) : accountsEnabled ? (
          <button type="button" onClick={onSignIn} style={{ ...primaryPillStyle, width: "100%" }}>
            Guardar mis roscos
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LetterCard({
  letter,
  caption,
  value,
  solid = false,
}: {
  letter: string;
  caption: string;
  value: string;
  solid?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderRadius: 20,
        background: statsTheme.fill,
        border: `1px solid ${statsTheme.hairline}`,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 9999,
          background: solid ? "#ffffff" : "rgba(255, 255, 255, 0.22)",
          color: solid ? statsTheme.ink : "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 17,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {letter}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: statsTheme.muted }}>
          {caption}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div style={tileStyle}>
      <div style={{ fontFamily: statsTheme.serif, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, lineHeight: 1.35, textAlign: "center", color: statsTheme.muted }}>{label}</div>
    </div>
  );
}
