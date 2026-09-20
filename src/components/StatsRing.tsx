import type { ReactNode } from "react";

export type RingNode = {
  /** The letter drawn in the bubble. */
  label: string;
  bg: string;
  fg: string;
  /** Tooltip / screen-reader text, e.g. "Ñ · 34% de aciertos". */
  title?: string;
};

type Props = {
  nodes: RingNode[];
  size?: number;
  nodeSize?: number;
  /** Anything placed in the middle of the ring (the big number). */
  children?: ReactNode;
  ariaLabel?: string;
};

/**
 * The rosco as a stats mark: same geometry as the game's LetterRing, but the
 * bubbles are coloured by whatever the caller is measuring.
 */
export default function StatsRing({ nodes, size = 240, nodeSize = 22, children, ariaLabel }: Props) {
  const center = size / 2;
  const radius = center - nodeSize / 2 - 2;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
    >
      {nodes.map((node, i) => {
        const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <div
            key={node.label}
            title={node.title}
            style={{
              position: "absolute",
              left: center + radius * Math.cos(angle) - nodeSize / 2,
              top: center + radius * Math.sin(angle) - nodeSize / 2,
              width: nodeSize,
              height: nodeSize,
              borderRadius: 9999,
              background: node.bg,
              color: node.fg,
              border: "1px solid rgba(255, 255, 255, 0.28)",
              boxSizing: "border-box",
              fontSize: Math.round(nodeSize * 0.48),
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            {node.label}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          inset: nodeSize + 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
