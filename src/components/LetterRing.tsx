import type { Letter } from "../data/sets";

type LetterStatus = "pending" | "current" | "passed" | "correct" | "wrong";

function statusToFill(status: LetterStatus): string {
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
  recentlyCorrect?: Letter | null;
  currentIndex: number;
};

export default function LetterRing({ letters, statusByLetter, recentlyCorrect, currentIndex }: Props) {
  // SVG coordinate system
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  // With 27 letters, circumference must comfortably exceed node diameter * letters
  // to avoid touching/overlap. These values keep everything within the 400x400 viewBox.
  const ringR = 178;
  const nodeR = 18;

  // Find the index of the recently correct letter
  const correctLetterIndex = recentlyCorrect ? letters.indexOf(recentlyCorrect) : -1;
  const correctAngle = correctLetterIndex >= 0 
    ? (correctLetterIndex / letters.length) * Math.PI * 2 - Math.PI / 2 
    : 0;
  const correctX = correctLetterIndex >= 0 ? cx + ringR * Math.cos(correctAngle) : 0;
  const correctY = correctLetterIndex >= 0 ? cy + ringR * Math.sin(correctAngle) : 0;

  // Use the passed currentIndex to position the goat (ensures smooth transition even during status changes)
  const currentAngle = currentIndex >= 0 
    ? (currentIndex / letters.length) * Math.PI * 2 - Math.PI / 2 
    : 0;
  const currentX = currentIndex >= 0 ? cx + ringR * Math.cos(currentAngle) : 0;
  const currentY = currentIndex >= 0 ? cy + ringR * Math.sin(currentAngle) : 0;
  // Position goat emoji OUTSIDE the bubble (on the outer edge, away from center)
  // Emoji size is 56px, so radius is ~28px. Offset needs to account for this.
  const emojiSize = 56;
  const emojiRadius = emojiSize / 2;
  const goatOffset = nodeR + emojiRadius - 8; // Position so emoji sits on bubble edge
  const goatX = currentIndex >= 0 ? currentX + goatOffset * Math.cos(currentAngle) : 0;
  const goatY = currentIndex >= 0 ? currentY + goatOffset * Math.sin(currentAngle) : 0;
  // Rotate goat to face the direction of movement (clockwise around the ring)
  // The emoji 🐐 faces left by default (angle = π)
  // Tangent direction (clockwise) at currentAngle is: currentAngle + π/2
  // To rotate a left-facing emoji to face direction φ: rotate by (φ - π)
  // So: rotation = (currentAngle + π/2 - π) = (currentAngle - π/2)
  const goatRotation = currentIndex >= 0 
    ? ((currentAngle - Math.PI / 2) * 180 / Math.PI) : 0;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      height="100%"
      aria-label="Ring of letters"
      style={{ overflow: "visible" }}
    >
      {/* Glow filter definition */}
      <defs>
        <filter id="particle-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
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
            <circle cx={x} cy={y} r={nodeR} fill="transparent" stroke={status === "current" ? "rgb(255,255,255)" : "rgba(255,255,255,0.35)"} strokeWidth="2" />
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
      {/* Goat emoji on current letter with smooth transition */}
      {currentIndex >= 0 && (
        <g 
          className="goat-move"
          style={{
            transform: `translate(${goatX}px, ${goatY}px) rotate(${goatRotation}deg) scale(1, -1)`,
          }}
        >
          <text
            x={0}
            y={0}
            textAnchor="middle"
            fontSize={emojiSize}
            dominantBaseline="middle"
            style={{ userSelect: "none", pointerEvents: "none" }}
          >
            🐐
          </text>
        </g>
      )}
      {/* Particle effects for correct answer - render on top */}
      {recentlyCorrect && correctLetterIndex >= 0 && (
        <g className="particle-effects">
          {Array.from({ length: 16 }).map((_, i) => {
            const particleAngle = (i / 16) * Math.PI * 2;
            const startDistance = nodeR + 2; // Start from letter bubble edge
            const endDistance = 55; // End distance from center
            const startX = startDistance * Math.cos(particleAngle);
            const startY = startDistance * Math.sin(particleAngle);
            const deltaX = (endDistance - startDistance) * Math.cos(particleAngle);
            const deltaY = (endDistance - startDistance) * Math.sin(particleAngle);
            const delay = i * 0.04;
            const size = 5 + (i % 3) * 1.5; // Varying particle sizes
            
            return (
              <g 
                key={`particle-${recentlyCorrect}-${i}`}
                transform={`translate(${correctX}, ${correctY})`}
              >
                {/* Star/particle with animation */}
                <circle
                  cx={startX}
                  cy={startY}
                  r={size}
                  fill="#FFD700"
                  opacity="0"
                  filter="url(#particle-glow)"
                >
                  <animateTransform
                    attributeName="transform"
                    type="translate"
                    values={`0,0;${deltaX},${deltaY}`}
                    dur="10s"
                    begin={`${delay}s`}
                    fill="freeze"
                  />
                  <animate
                    attributeName="opacity"
                    values="0;1;1;0"
                    keyTimes="0;0.02;0.9;1"
                    dur="10s"
                    begin={`${delay}s`}
                    fill="freeze"
                  />
                  <animate
                    attributeName="r"
                    values={`${size * 0.5};${size * 1.4};${size}`}
                    keyTimes="0;0.05;1"
                    dur="10s"
                    begin={`${delay}s`}
                    fill="freeze"
                  />
                </circle>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}