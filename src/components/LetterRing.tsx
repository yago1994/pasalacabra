import { useRef } from "react";
import type { Letter } from "../data/sets";
import { RING } from "../cabra/engine";
import type { Phase } from "../cabra/director";
import { useCabra } from "../cabra/useCabra";

type LetterStatus = "pending" | "current" | "passed" | "correct" | "wrong";

function statusToFill(status: LetterStatus): string {
  switch (status) {
    case "current":
      return "var(--letter-current)";
    case "correct":
      return "var(--letter-correct)";
    case "wrong":
      return "var(--letter-wrong)";
    case "passed":
      return "var(--letter-passed)";
    case "pending":
    default:
      return "var(--letter-default)";
  }
}

type Props = {
  letters: readonly Letter[];
  statusByLetter: Record<Letter, LetterStatus>;
  recentlyCorrect?: Letter | null;
  currentIndex: number;
  /** Game phase and end state, so the goat can react (start, end of turn, victory). */
  phase?: Phase;
  gameOver?: boolean;
  getAudioCtx?: () => AudioContext | null;
};

const TAU = Math.PI * 2;

function angleForIndex(i: number, total: number) {
  // Put letters[0] at the top
  return (i / total) * TAU - Math.PI / 2;
}

export default function LetterRing({ letters, statusByLetter, currentIndex, phase = "playing", gameOver = false, getAudioCtx }: Props) {
  // SVG coordinate system (shared with the goat engine)
  const { size, cx, cy, ringR, nodeR } = RING;

  // The goat lives in two layers: one under the letters (mountains, rainbows), one over them.
  const backRef = useRef<SVGGElement>(null);
  const frontRef = useRef<SVGGElement>(null);
  useCabra({
    backRef,
    frontRef,
    getAudioCtx,
    inputs: {
      n: letters.length,
      index: currentIndex,
      statuses: letters.map((l) => statusByLetter[l]),
      phase,
      gameOver,
    },
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      height="100%"
      aria-label="Ring of letters"
      style={{ overflow: "visible" }}
    >
      <defs>
        <filter id="particle-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g ref={backRef} />

      {letters.map((letter, i) => {
        const angle = angleForIndex(i, letters.length);
        const x = cx + ringR * Math.cos(angle);
        const y = cy + ringR * Math.sin(angle);

        const status = statusByLetter[letter];
        const fill = statusToFill(status);

        return (
          <g key={letter}>
            <circle cx={x} cy={y} r={nodeR} fill={fill} opacity={0.95} />
            <circle
              cx={x}
              cy={y}
              r={nodeR}
              fill="transparent"
              stroke={status === "current" ? "rgb(255,255,255)" : "rgba(255,255,255,0.35)"}
              strokeWidth="2"
            />
            <text
              x={x}
              y={y + 6}
              textAnchor="middle"
              fontSize="16"
              fontWeight="800"
              fill="rgba(255,255,255,0.98)"
            >
              {letter}
            </text>
          </g>
        );
      })}

      <g ref={frontRef} />
    </svg>
  );
}