import type { CSSProperties } from "react";

// The stats screens live in the same world as the home page: the blue ground
// with its floating goats, white ink, the serif of the wordmark for anything
// big, and pill buttons — white filled for the main action, white outline for
// the rest. No dark cards: nothing here is a dashboard.
export const statsTheme = {
  serif: "ui-serif, Georgia, Times, serif",
  text: "#ffffff",
  muted: "rgba(255, 255, 255, 0.88)",
  /** Text on top of a white or near-white fill. Deep blue, never black. */
  ink: "#14356f",
  /** A panel of white over the blue, the weight of the home page's outlined pills. */
  fill: "rgba(255, 255, 255, 0.16)",
  fillStrong: "rgba(255, 255, 255, 0.24)",
  hairline: "rgba(255, 255, 255, 0.32)",
  correct: "#1f9d63",
  wrong: "#e23b3b",
  /**
   * Letters left unresolved. A deep translucent blue rather than a white wash:
   * it stays clearly a bubble against the blue ground, and white letters on it
   * are still readable.
   */
  unresolved: "rgba(17, 48, 104, 0.55)",
} as const;

/**
 * "How often do I get this letter right", as whiteness over the blue: the
 * better you know a letter, the more solid its bubble. One ramp, monotonic,
 * so it reads as a quantity rather than five categories — and the label stays
 * deep blue at every step, which is legible on all of them.
 */
export const ACCURACY_RAMP = [
  "rgba(255, 255, 255, 0.22)",
  "rgba(255, 255, 255, 0.40)",
  "rgba(255, 255, 255, 0.58)",
  "rgba(255, 255, 255, 0.78)",
  "#ffffff",
] as const;

export function accuracyStep(pct: number | null): { bg: string; fg: string } {
  // No data yet: an empty outline rather than a step of the ramp.
  if (pct === null) return { bg: "rgba(255, 255, 255, 0.10)", fg: "rgba(255, 255, 255, 0.85)" };
  if (pct < 35) return { bg: ACCURACY_RAMP[0], fg: statsTheme.ink };
  if (pct < 50) return { bg: ACCURACY_RAMP[1], fg: statsTheme.ink };
  if (pct < 65) return { bg: ACCURACY_RAMP[2], fg: statsTheme.ink };
  if (pct < 80) return { bg: ACCURACY_RAMP[3], fg: statsTheme.ink };
  return { bg: ACCURACY_RAMP[4], fg: statsTheme.ink };
}

/** The page column. Sits straight on the blue, like the home page does. */
export const panelStyle: CSSProperties = {
  width: "min(92vw, 420px)",
  padding: "clamp(12px, 4vw, 20px)",
  color: statsTheme.text,
};

export const tileStyle: CSSProperties = {
  background: statsTheme.fill,
  border: `1px solid ${statsTheme.hairline}`,
  borderRadius: 20,
  padding: "16px 8px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
};

const basePill: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 48,
  padding: "0 20px",
  borderRadius: 9999,
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
};

/** White pill — the one thing to do on the screen. */
export const primaryPillStyle: CSSProperties = {
  ...basePill,
  background: "#ffffff",
  color: statsTheme.ink,
  border: "none",
  fontWeight: 700,
};

/** Outlined pill — everything else, exactly as on the home page. */
export const ghostPillStyle: CSSProperties = {
  ...basePill,
  background: "transparent",
  color: statsTheme.text,
  border: "2px solid rgba(255, 255, 255, 0.8)",
};

/** Quieter outlined pill, for rows and secondary rails. */
export const quietPillStyle: CSSProperties = {
  ...basePill,
  background: "transparent",
  color: statsTheme.text,
  border: "1px solid rgba(255, 255, 255, 0.4)",
};

/** Round icon button (close, back) — the same touch target as the pills. */
export const iconButtonStyle: CSSProperties = {
  width: 44,
  height: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 9999,
  background: "transparent",
  border: "none",
  color: statsTheme.text,
  fontSize: 22,
  cursor: "pointer",
  flexShrink: 0,
};

export const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: statsTheme.serif,
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: "-0.01em",
};
