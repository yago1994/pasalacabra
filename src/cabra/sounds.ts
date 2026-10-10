// Procedural goat sounds with WebAudio: no audio files, every bleat a little different.
// A bleat is a sawtooth voice with the fast (~20–28 Hz) pitch-and-volume tremolo that
// makes goats sound like goats, shaped by vowel formants ("beee" in Spanish, "baa" in English).

import pasalacabraUrl from "../assets/sfx-pasalacabra.wav";

type Opts = { pitch?: number; gain?: number };

// The game's own Pasalacabra bleat, decoded once per AudioContext. Any "¡Beee!" bubble plays it.
const samples = new WeakMap<AudioContext, Promise<AudioBuffer | null>>();
function pasalacabraSample(ctx: AudioContext) {
  let p = samples.get(ctx);
  if (!p) {
    p = fetch(pasalacabraUrl)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null);
    samples.set(ctx, p);
  }
  return p;
}
/** Starts decoding the bleat sample early so the first "¡Beee!" isn't late. */
export function preloadSounds(ctx: AudioContext) {
  void pasalacabraSample(ctx);
}

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

const VOWELS: Record<string, [number, number, number][]> = {
  e: [[560, 6, 1], [1850, 9, 0.55], [2650, 12, 0.25]],
  a: [[820, 5, 1], [1250, 8, 0.7], [2600, 12, 0.22]],
  eh: [[640, 6, 1], [1600, 9, 0.6], [2550, 12, 0.22]],
};

function voice(ctx: AudioContext, out: AudioNode, t0: number, dur: number, f0: number, vowel: string, wobble: number, gain: number, contour: "up" | "down" | "flat" = "flat") {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const f = osc.frequency;
  f.setValueAtTime(f0 * 0.82, t0);
  f.linearRampToValueAtTime(f0 * 1.04, t0 + 0.07);
  if (contour === "up") f.linearRampToValueAtTime(f0 * 1.22, t0 + dur * 0.8);
  else if (contour === "down") f.linearRampToValueAtTime(f0 * 0.72, t0 + dur * 0.9);
  else f.linearRampToValueAtTime(f0 * 0.97, t0 + dur * 0.75);
  f.linearRampToValueAtTime(f0 * 0.78, t0 + dur);

  // Tremolo: the bleat "wobble" deepens through the call.
  const lfo = ctx.createOscillator();
  lfo.frequency.setValueAtTime(20 + Math.random() * 7, t0);
  const lfoF = ctx.createGain();
  lfoF.gain.setValueAtTime(f0 * 0.015, t0);
  lfoF.gain.linearRampToValueAtTime(f0 * 0.06 * wobble, t0 + dur * 0.5);
  lfo.connect(lfoF).connect(f);
  const am = ctx.createGain();
  am.gain.value = 0.62;
  const lfoA = ctx.createGain();
  lfoA.gain.setValueAtTime(0.08, t0);
  lfoA.gain.linearRampToValueAtTime(0.38 * wobble, t0 + dur * 0.45);
  lfo.connect(lfoA).connect(am.gain);

  // "b" onset: lips open, so the filter opens quickly.
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(350, t0);
  lp.frequency.exponentialRampToValueAtTime(4200, t0 + 0.06);
  lp.frequency.setValueAtTime(4200, t0 + dur * 0.8);
  lp.frequency.exponentialRampToValueAtTime(1200, t0 + dur);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.045);
  env.gain.setValueAtTime(gain, t0 + dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(am).connect(lp);
  const sum = ctx.createGain();
  for (const [fc, q, g] of VOWELS[vowel] || VOWELS.e) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = fc * (0.96 + Math.random() * 0.08);
    bp.Q.value = q;
    const gg = ctx.createGain();
    gg.gain.value = g * 2.2;
    lp.connect(bp).connect(gg).connect(sum);
  }
  // a little nasal body
  const body = ctx.createBiquadFilter();
  body.type = "lowpass";
  body.frequency.value = 900;
  const bg = ctx.createGain();
  bg.gain.value = 0.25;
  lp.connect(body).connect(bg).connect(sum);
  sum.connect(env).connect(out);

  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + dur + 0.05);
  lfo.stop(t0 + dur + 0.05);
}

function noiseHit(ctx: AudioContext, out: AudioNode, t0: number, dur: number, fc: number, q: number, gain: number) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = fc;
  bp.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(env).connect(out);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
  return bp;
}

function tone(ctx: AudioContext, out: AudioNode, t0: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(env).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  return o;
}

export type SoundName = "pasalacabra" | "baa" | "beh" | "meh" | "munch" | "boing" | "pop" | "whoosh" | "ding" | "rumble" | "yawn" | "cowbell";

/** Plays one sound now. `lang` picks the bleat vowel ("beee" vs "baa"). */
export function playSound(ctx: AudioContext, name: string, opts: Opts = {}, lang = "es", master = 0.5) {
  const pitch = opts.pitch ?? 1, gain = (opts.gain ?? 1) * master;
  const out = ctx.createGain();
  out.gain.value = gain;
  out.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.01;
  const vowel = lang === "en" ? "a" : "e";
  const jitter = 0.94 + Math.random() * 0.12;
  switch (name as SoundName) {
    case "pasalacabra":
      void pasalacabraSample(ctx).then((buf) => {
        if (!buf) return voice(ctx, out, ctx.currentTime + 0.01, 0.78, 360 * pitch, vowel, 1, 0.5);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = pitch;
        out.gain.value = (opts.gain ?? 1) * Math.max(master, 0.9);
        src.connect(out);
        src.start();
      });
      break;
    case "cowbell": {
      // The classic two-square-wave cowbell, through a band-pass, with a sharp clank and a ring.
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2640 * pitch;
      bp.Q.value = 1.4;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.9, t0 + 0.004);
      env.gain.exponentialRampToValueAtTime(0.25, t0 + 0.06);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
      for (const f of [587, 845]) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = f * pitch * jitter;
        o.connect(bp);
        o.start(t0);
        o.stop(t0 + 0.6);
      }
      bp.connect(env).connect(out);
      noiseHit(ctx, out, t0, 0.025, 4200, 1.2, 0.35);
      break;
    }
    case "baa": // a full, proud bleat
      voice(ctx, out, t0, 0.78, 360 * pitch * jitter, vowel, 1, 0.5);
      break;
    case "beh": // a short, happy one
      voice(ctx, out, t0, 0.32, 470 * pitch * jitter, vowel, 0.7, 0.45, "up");
      break;
    case "meh": // a small, sad, falling one
      voice(ctx, out, t0, 0.62, 330 * pitch * jitter, "eh", 1.2, 0.38, "down");
      break;
    case "yawn":
      voice(ctx, out, t0, 0.9, 260 * pitch, "a", 0.3, 0.25, "down");
      break;
    case "munch":
      for (let i = 0; i < 4; i++) noiseHit(ctx, out, t0 + i * 0.13 + Math.random() * 0.02, 0.07, 1800 + Math.random() * 1400, 1.6, 0.5);
      break;
    case "boing": {
      const o = tone(ctx, out, t0, "sine", 160 * pitch, 520 * pitch, 0.42, 0.55);
      const v = ctx.createOscillator();
      v.frequency.value = 14;
      const vg = ctx.createGain();
      vg.gain.setValueAtTime(40, t0);
      vg.gain.exponentialRampToValueAtTime(1, t0 + 0.42);
      v.connect(vg).connect(o.frequency);
      v.start(t0);
      v.stop(t0 + 0.45);
      break;
    }
    case "pop":
      tone(ctx, out, t0, "sine", 900 * pitch, 240 * pitch, 0.09, 0.6);
      noiseHit(ctx, out, t0, 0.03, 3000, 1, 0.3);
      break;
    case "whoosh": {
      const src = ctx.createBufferSource();
      src.buffer = noise(ctx);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.8;
      f.frequency.setValueAtTime(400 * pitch, t0);
      f.frequency.exponentialRampToValueAtTime(2400 * pitch, t0 + 0.24);
      f.frequency.exponentialRampToValueAtTime(600 * pitch, t0 + 0.5);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.5, t0 + 0.2);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.52);
      src.connect(f).connect(env).connect(out);
      src.start(t0);
      src.stop(t0 + 0.55);
      break;
    }
    case "ding":
      tone(ctx, out, t0, "sine", 1568 * pitch, 1560 * pitch, 0.9, 0.35);
      tone(ctx, out, t0, "sine", 3920 * pitch, 3900 * pitch, 0.4, 0.12);
      break;
    case "rumble": {
      const src = ctx.createBufferSource();
      src.buffer = noise(ctx);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 160;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.9, t0 + 0.12);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
      src.connect(lp).connect(env).connect(out);
      src.start(t0);
      src.stop(t0 + 0.75);
      break;
    }
  }
  window.setTimeout(() => out.disconnect(), 2000);
}
