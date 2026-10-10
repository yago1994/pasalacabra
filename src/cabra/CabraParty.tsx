import { useEffect, useRef, useState } from "react";
import { GoatParty } from "./party";

/**
 * Full-screen goat party for the end of the game. While `active`, a pack of goats gallops,
 * hops and flips across the screen over rising mountains; when it turns false they finish
 * with the mountains sinking and fade out. Skipped entirely under reduced motion.
 */
export default function CabraParty({ active }: { active: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const partyRef = useRef<GoatParty | null>(null);
  const [mounted, setMounted] = useState(active);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  if (active && !mounted) setMounted(true);

  useEffect(() => {
    if (!mounted || !ref.current || reduced) return;
    const party = new GoatParty(ref.current);
    partyRef.current = party;
    party.start(() => setMounted(false));
    return () => {
      party.destroy();
      partyRef.current = null;
    };
  }, [mounted, reduced]);

  useEffect(() => {
    if (!active) partyRef.current?.end();
  }, [active]);

  if (!mounted || reduced) return null;
  return (
    <svg
      ref={ref}
      aria-hidden
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 3000, overflow: "visible" }}
    />
  );
}
