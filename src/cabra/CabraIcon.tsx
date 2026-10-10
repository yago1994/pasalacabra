import { useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { STILL_VIEWBOX, drawStill } from "./still";

type Props = {
  /** One of POSES in still.ts: happy, graze, rear, jump, flip, sleep, scratch, stretch, headbutt, cool, king. */
  pose?: string;
  /** CSS size; defaults to 1em so it sizes like the emoji it replaces. */
  size?: number | string;
  /** Face left instead of right. */
  flip?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
};

/** The goat as a still icon, drawn by the same rig as the animated one. */
export default function CabraIcon({ pose = "happy", size = "1em", flip = false, className, style, label }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    if (ref.current) drawStill(ref.current, pose);
  }, [pose]);
  return (
    <svg
      ref={ref}
      viewBox={STILL_VIEWBOX}
      width={size}
      height={size}
      className={className}
      style={{ overflow: "visible", transform: flip ? "scaleX(-1)" : undefined, verticalAlign: "middle", ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
