import type { Letter } from "../data/sets";

export type LetterStatus = "pending" | "current" | "passed" | "correct" | "wrong";

export function statusToFill(status: LetterStatus): string {
  switch (status) {
    case "current": return "var(--letter-current)";
    case "correct": return "var(--letter-correct)";
    case "wrong": return "var(--letter-wrong)";
    case "passed": return "var(--letter-passed)";
    case "pending":
    default: return "var(--letter-default)";
  }
}

type Props = {
  letters: readonly Letter[];
  statusByLetter: Record<Letter, LetterStatus>;
};

export default function LetterRing({ letters, statusByLetter }: Props) {
  // SVG coordinate system
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  // With 27 letters, circumference must comfortably exceed node diameter * letters
  // to avoid touching/overlap. These values keep everything within the 400x400 viewBox.
  const ringR = 178;
  const nodeR = 18;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      height="100%"
      aria-label="Ring of letters"
    >
      {letters.map((letter, i) => {
        // Start near top, clockwise
        const angle = (i / letters.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + ringR * Math.cos(angle);
        const y = cy + ringR * Math.sin(angle);

        const status = statusByLetter[letter];
        const fill = statusToFill(status);

        return (
          <g key={letter}>
            <circle cx={x} cy={y} r={nodeR} fill={fill} opacity={0.95} />
            <circle cx={x} cy={y} r={nodeR} fill="transparent" stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
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
    </svg>
  );
}