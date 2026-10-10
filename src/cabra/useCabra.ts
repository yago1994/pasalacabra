import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { Director } from "./director";
import type { GameInputs } from "./director";
import { playSound, preloadSounds } from "./sounds";
import { CabraStage, WORDS } from "./stage";

type Options = {
  /** Layer drawn under the letters (mountains, rainbows) and the one drawn over them. */
  backRef: RefObject<SVGGElement | null>;
  frontRef: RefObject<SVGGElement | null>;
  inputs: GameInputs;
  /** The game's AudioContext; the goat only makes sound once it is running. */
  getAudioCtx?: () => AudioContext | null;
  lang?: "es" | "en";
};

/**
 * Puts the goat on the ring. The director and renderer live outside React: React only
 * feeds them the game state, and a requestAnimationFrame loop draws straight into the SVG.
 */
export function useCabra({ backRef, frontRef, inputs, getAudioCtx, lang = "es" }: Options) {
  const directorRef = useRef<Director | null>(null);
  const audioRef = useRef(getAudioCtx);
  audioRef.current = getAudioCtx;
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    const back = backRef.current, front = frontRef.current;
    if (!back || !front) return;
    const director = new Director();
    const stage = new CabraStage(back, front);
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    director.reducedMotion = !!motion?.matches;
    const onMotion = () => (director.reducedMotion = !!motion?.matches);
    motion?.addEventListener?.("change", onMotion);
    director.onSound = (name, opts) => {
      const ctx = audioRef.current?.();
      if (ctx && ctx.state === "running") playSound(ctx, name, opts);
    };
    const onPoke = (e: Event) => {
      e.stopPropagation();
      director.poke();
    };
    stage.goat.hit.addEventListener("pointerdown", onPoke);
    stage.goat.root.style.cursor = "pointer";
    directorRef.current = director;

    let raf = 0;
    let preloaded = false;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const { goat, sets } = director.frame(t);
      stage.render(goat, sets, t, { ...(WORDS[langRef.current] || WORDS.es), ...director.words });
      if (!preloaded) {
        const ctx = audioRef.current?.();
        if (ctx) {
          preloadSounds(ctx);
          preloaded = true;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      motion?.removeEventListener?.("change", onMotion);
      stage.goat.hit.removeEventListener("pointerdown", onPoke);
      stage.destroy();
      directorRef.current = null;
    };
  }, [backRef, frontRef]);

  // Feed the game state every time it changes (the director diffs it).
  // The clock only matters to the goat in its last 10 seconds, so whole seconds are plenty.
  const clockKey = inputs.timeLeft !== undefined && inputs.timeLeft <= 11 ? Math.ceil(inputs.timeLeft) : "ok";
  const key = `${inputs.n}|${inputs.index}|${inputs.phase}|${inputs.gameOver}|${clockKey}|${inputs.statuses.join(",")}`;
  useEffect(() => {
    directorRef.current?.update(inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
