import type { Letter } from "../data/sets";
import { useTweenedGoat } from "../components/useTweenedGoat";

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
};

const TAU = Math.PI * 2;

function angleForIndex(i: number, total: number) {
  // Put letters[0] at the top
  return (i / total) * TAU - Math.PI / 2;
}

export default function LetterRing({ letters, statusByLetter, currentIndex }: Props) {
  // SVG coordinate system
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;

  const ringR = 178;
  const nodeR = 18;

  // Goat sizing
  const emojiSize = 56;
  const emojiRadius = emojiSize / 2;

  const hasCurrent = currentIndex >= 0 && currentIndex < letters.length;

  const currentAngle = hasCurrent ? angleForIndex(currentIndex, letters.length) : 0;
  const currentX = cx + ringR * Math.cos(currentAngle);
  const currentY = cy + ringR * Math.sin(currentAngle);

  // Outside the bubble (your existing offset behavior)
  const goatOffset = nodeR + emojiRadius - 8;
  const goatX = currentX + goatOffset * Math.cos(currentAngle);
  const goatY = currentY + goatOffset * Math.sin(currentAngle);

  const goatRotationDeg = (currentAngle - Math.PI / 2) * (180 / Math.PI);

  // Smooth animation (cross-browser)
  const anim = useTweenedGoat(
    { x: goatX, y: goatY, rot: goatRotationDeg },
    220
  );

  const goatTransform = `translate(${anim.x} ${anim.y}) rotate(${anim.rot}) scale(1 -1)`;

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

      {hasCurrent && (
        <g transform={goatTransform}>
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={emojiSize}
            style={{ userSelect: "none", pointerEvents: "none" }}
          >
            🐐
          </text>
        </g>
      )}
    </svg>
  );
}