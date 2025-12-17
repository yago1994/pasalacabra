import { useEffect, useMemo, useRef, useState } from "react";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import LetterRing from "./components/LetterRing";
import {
  SPANISH_LETTERS,
  type Letter,
  type QA,
  buildQuestionMap as buildSetQuestionMap,
  getSet,
  listSets,
} from "./data/sets";
import sfxCorrectUrl from "./assets/sfx-correct.wav";
import sfxWrongUrl from "./assets/sfx-wrong.wav";
import sfxPasalacabraUrl from "./assets/sfx-pasalacabra.wav";
import type { GameSession, Player, LetterStatus } from "./game/engine";
import { createAzureRecognizer, preflightAzureAuth, setPhraseHints } from "./speech/speechazure";

type GamePhase = "idle" | "playing" | "ended";
type Screen = "setup" | "game";

const TURN_SECONDS = 120;

function removeDiacritics(s: string) {
  // `NFD` splits letters+diacritics into separate codepoints.
  // Then we remove the combining diacritic marks.
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeForCompare(raw: string) {
  const s = removeDiacritics(raw)
    .toLowerCase()
    .replace(/[¡!¿?.,;:()[\]{}"“”'’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip common Spanish leading articles / contractions (helps with STT).
  return s.replace(/^(el|la|los|las|un|una|unos|unas|al|del)\s+/i, "").trim();
}

function uniqueNonEmpty(list: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const t = v.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function buildPhraseHintsForAnswer(answer: string) {
  // Phrase hints for recognition bias (answer + common variants/confusions).
  // Keep this list small; big lists can hurt latency/quality.
  const a = answer.trim();
  const aNoDiacritics = removeDiacritics(a);
  const aNtildeToN = a.replace(/[ñÑ]/g, (m) => (m === "Ñ" ? "N" : "n"));
  const aNoDiacriticsNtildeToN = removeDiacritics(aNtildeToN);

  const lower = a.toLowerCase();
  const pluralS = lower.endsWith("s") ? a.slice(0, -1) : `${a}s`;
  const pluralEs = lower.endsWith("s") ? a : `${a}es`;

  return uniqueNonEmpty([
    a,
    aNoDiacritics,
    aNtildeToN,
    aNoDiacriticsNtildeToN,
    pluralS,
    removeDiacritics(pluralS),
    pluralEs,
    removeDiacritics(pluralEs),
    `el ${a}`,
    `la ${a}`,
  ]).slice(0, 10);
}

function isAnswerCorrect(spoken: string, expected: string) {
  const s = normalizeForCompare(spoken);
  const e = normalizeForCompare(expected);
  if (!s || !e) return false;
  if (s === e) return true;

  function levenshteinRatio(a: string, b: string) {
    if (a === b) return 1;
    const n = a.length;
    const m = b.length;
    if (n === 0 || m === 0) return 0;
    const maxLen = Math.max(n, m);

    // DP with two rows to keep it small.
    let prev = new Array<number>(m + 1);
    let cur = new Array<number>(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= m; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        const del = prev[j] + 1;
        const ins = cur[j - 1] + 1;
        const sub = prev[j - 1] + cost;
        cur[j] = Math.min(del, ins, sub);
      }
      const tmp = prev;
      prev = cur;
      cur = tmp;
    }
    const dist = prev[m];
    return 1 - dist / maxLen;
  }

  // Common STT confusion in Spanish: ñ → n.
  const sN = s.replace(/ñ/g, "n");
  const eN = e.replace(/ñ/g, "n");
  if (sN === eN) return true;

  // Very small plural/singular tolerance for short one-word answers.
  if (s === `${e}s` || e === `${s}s`) return true;
  if (s === `${e}es` || e === `${s}es`) return true;

  // Fuzzy match for single-word answers (helps with minor phoneme confusions like d→k):
  // e.g. "delfin" vs "kelfin" should be accepted.
  const sOneWord = !/\s/.test(sN);
  const eOneWord = !/\s/.test(eN);
  if (sOneWord && eOneWord && sN.length >= 4 && eN.length >= 4) {
    const ratio = levenshteinRatio(sN, eN);
    if (ratio >= 0.6) return true;
  }

  return false;
}

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${mm}:${ss}`;
}

function nextUnresolvedIndex(
  letters: readonly Letter[],
  statusByLetter: Record<Letter, LetterStatus>,
  startFrom: number
) {
  for (let offset = 1; offset <= letters.length; offset++) {
    const idx = (startFrom + offset) % letters.length;
    const l = letters[idx];
    const st = statusByLetter[l];
    if (st === "pending" || st === "passed" || st === "current") return idx;
  }
  return -1;
}

function anyUnresolved(statusByLetter: Record<Letter, LetterStatus>, letters: readonly Letter[]) {
  return letters.some((l) => {
    const st = statusByLetter[l];
    return st === "pending" || st === "passed" || st === "current";
  });
}

export default function App() {
  const DEBUG_STT = true;
  const letters = SPANISH_LETTERS;
  const availableSets = useMemo(() => listSets(), []);

  const [screen, setScreen] = useState<Screen>("setup");
  const [setupPlayerCount, setSetupPlayerCount] = useState<number>(2);
  type SetupPlayer = { name: string; setId: string };
  const [setupPlayers, setSetupPlayers] = useState<SetupPlayer[]>(() => {
    const def = listSets()[0]?.id ?? "set_01";
    return [
      { name: "", setId: def },
      { name: "", setId: def },
    ];
  });
  const [session, setSession] = useState<GameSession | null>(null);

  const [phase, setPhase] = useState<GamePhase>("idle");
  const [timeLeft, setTimeLeft] = useState<number>(TURN_SECONDS); // active player's time
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [gameOverMessage, setGameOverMessage] = useState<string>("");

  // Per-player saved progress
  type PlayerState = {
    statusByLetter: Record<Letter, LetterStatus>;
    currentIndex: number;
    timeLeft: number;
    revealed: boolean;
  };
  const [playerStates, setPlayerStates] = useState<Record<string, PlayerState>>({});

  const [statusByLetter, setStatusByLetter] = useState<Record<Letter, LetterStatus>>(() => {
    const initial = {} as Record<Letter, LetterStatus>;
    for (const l of letters) initial[l] = "pending";
    return initial;
  });

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [revealed, setRevealed] = useState<boolean>(false);
  const [turnMessage, setTurnMessage] = useState<string>("");
  const [feedback, setFeedback] = useState<null | "correct" | "wrong">(null);
  const feedbackTimerRef = useRef<number | null>(null);

  // Camera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string>("");
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("user");
  const [isSwitchingCamera, setIsSwitchingCamera] = useState<boolean>(false);

  // Speech (Text-to-speech)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const lastSpokenKeyRef = useRef<string | null>(null);

  // Speech-to-text (browser)
  const recognitionRef = useRef<sdk.SpeechRecognizer | null>(null);
  const phraseListRef = useRef<sdk.PhraseListGrammar | null>(null);
  const sttStartPromiseRef = useRef<Promise<void> | null>(null);
  const sttGenRef = useRef<number>(0);
  const sttAutoSubmitTimerRef = useRef<number | null>(null);
  const sttAutoSubmitSeqRef = useRef<number>(0);
  const sttLastFinalTextRef = useRef<string>("");
  const sttLastFinalAtRef = useRef<number>(0);
  const micWarmRef = useRef<boolean>(false);
  const ttsWarmRef = useRef<boolean>(false);
  const ttsPrimeAtRef = useRef<number>(0);
  const ttsPrimingRef = useRef<boolean>(false);
  const sttMicReadyChimeKeyRef = useRef<string | null>(null);
  const sttPreStartTimerRef = useRef<number | null>(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [sttSupported, setSttSupported] = useState<boolean>(true);
  const [sttError, setSttError] = useState<string>("");
  const [answerText, setAnswerText] = useState<string>("");
  const userEditedAnswerRef = useRef<boolean>(false);
  const [questionRead, setQuestionRead] = useState<boolean>(false);
  const [sttPreflightChecking, setSttPreflightChecking] = useState<boolean>(false);
  const sttCommandKeyRef = useRef<string | null>(null);
  const sttDesiredRef = useRef<boolean>(false);
  const sttLastHintsRef = useRef<string[]>([]);
  const sttRestartTimerRef = useRef<number | null>(null);
  const sttRestartCountRef = useRef<number>(0);
  const sttLastErrorRef = useRef<string | null>(null);
  const sttArmedRef = useRef<boolean>(false);
  const phaseRef = useRef<GamePhase>("idle");
  const activePlayerIdRef = useRef<string | null>(null);
  const activeSetIdRef = useRef<string>("");
  const currentLetterRef = useRef<Letter>(letters[0]);
  const currentIndexRef = useRef<number>(0);

  function sttLog(...args: unknown[]) {
    if (!DEBUG_STT) return;
    console.log("[stt]", ...args);
  }

  async function warmupMicrophoneOnce() {
    if (micWarmRef.current) return;
    micWarmRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const t of stream.getTracks()) t.stop();
      sttLog("mic warmup ok");
    } catch (err) {
      // If permission is denied, we still mark warmed to avoid repeated prompts.
      sttLog("mic warmup failed", String(err));
    }
  }

  function warmupSpeechSynthesisOnce() {
    if (ttsWarmRef.current) return;
    if (!("speechSynthesis" in window)) return;
    ttsWarmRef.current = true;
    try {
      // Some browsers "warm up" the TTS pipeline on first utterance (volume ducking / ramp).
      // Speak a near-instant, muted utterance once so the first real question sounds consistent.
      const u = new SpeechSynthesisUtterance(".");
      u.volume = 0;
      u.rate = 10;
      u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch {
      // ignore
    }
  }

  function primeSpeechSynthesisIfNeeded(onReady: () => void) {
    if (!("speechSynthesis" in window)) {
      onReady();
      return;
    }
    const now = Date.now();
    // iOS/Safari can "duck/ramp" TTS volume on the first utterance after inactivity or audio-session changes.
    // Prime with a near-silent, very short utterance so the *real* question starts at full volume.
    if (ttsPrimingRef.current) return;
    if (ttsPrimeAtRef.current && now - ttsPrimeAtRef.current < 60_000) {
      onReady();
      return;
    }

    ttsPrimingRef.current = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ttsPrimingRef.current = false;
      ttsPrimeAtRef.current = Date.now();
      onReady();
    };

    try {
      const u = new SpeechSynthesisUtterance("a");
      u.volume = 0.02; // low but non-zero so the audio path engages
      u.rate = 4;
      u.pitch = 1;
      u.onend = finish;
      u.onerror = finish;
      // Cancel any pending speech before priming.
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      // Fallback in case onend doesn't fire (some mobile edge cases)
      window.setTimeout(finish, 250);
    } catch {
      finish();
    }
  }

  function shouldTriggerPasalacabra(text: string) {
    const normalizedWords = normalizeForCompare(text);
    const normalizedJoined = normalizedWords.replace(/\s+/g, "");
    if (!normalizedJoined) return { ok: false as const, normalizedJoined };
    const hasExact =
      normalizedJoined.includes("pasalacabra") || normalizedJoined.includes("pasapalabra");
    const tokens = normalizedWords.split(/\s+/g).filter(Boolean);
    // Match whole words to avoid false positives like "pasado" matching "pasa".
    const hasPasaWord = tokens.includes("pasa");
    const hasCabraWord = tokens.includes("cabra");
    // Treat "pasa" as a valid command by itself (user intent: "pasa la cabra").
    return { ok: hasExact || hasPasaWord || hasCabraWord, normalizedJoined };
  }

  // Keep latest values for async STT callbacks (avoid stale closures).
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Sound effects (Web Audio, preloaded + pre-decoded for low latency)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sfxBuffersRef = useRef<Partial<Record<"correct" | "wrong" | "pasalacabra", AudioBuffer>>>({});
  const sfxRawRef = useRef<Partial<Record<"correct" | "wrong" | "pasalacabra", ArrayBuffer>>>({});
  const sfxLoadPromiseRef = useRef<Promise<void> | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);

  function getAudioCtx() {
    if (audioCtxRef.current) return audioCtxRef.current;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    // "interactive" prioritizes low latency (best for game-show SFX).
    audioCtxRef.current = new Ctx({ latencyHint: "interactive" });
    return audioCtxRef.current;
  }

  function unlockAudioOnce() {
    if (audioUnlockedRef.current) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    audioUnlockedRef.current = true;

    // IMPORTANT: do not await here; we want this to run in the same user-gesture call stack.
    try {
      void ctx.resume();
    } catch {
      // ignore
    }

    // iOS Safari sometimes needs an actual (silent) start() call to fully unlock audio output.
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = 0;
      s.buffer = b;
      s.connect(g);
      g.connect(ctx.destination);
      s.start();
    } catch {
      // ignore
    }

    // Kick off decoding in the background (may complete before first SFX is needed).
    void ensureSfxReady();
  }

  // Prefetch audio bytes early (doesn't require user gesture).
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function prefetch() {
      const entries: Array<["correct" | "wrong" | "pasalacabra", string]> = [
        ["correct", sfxCorrectUrl],
        ["wrong", sfxWrongUrl],
        ["pasalacabra", sfxPasalacabraUrl],
      ];

      await Promise.all(
        entries.map(async ([key, url]) => {
          try {
            const res = await fetch(url, { signal });
            if (!res.ok) return;
            const buf = await res.arrayBuffer();
            sfxRawRef.current[key] = buf;
          } catch {
            // Ignore; we'll retry on-demand.
          }
        })
      );
    }

    void prefetch();
    return () => controller.abort();
  }, []);

  // Mobile browsers often require a user gesture to enable audio output.
  // Unlock on the very first pointer interaction anywhere in the app.
  useEffect(() => {
    const handler = () => unlockAudioOnce();
    window.addEventListener("pointerdown", handler, { once: true });
    return () => window.removeEventListener("pointerdown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureSfxReady() {
    if (sfxLoadPromiseRef.current) return sfxLoadPromiseRef.current;

    sfxLoadPromiseRef.current = (async () => {
      const ctx = getAudioCtx();
      if (!ctx) return;

      // On iOS/Safari, AudioContext starts "suspended" until user gesture.
      // Also, some browsers may suspend again; we try to resume whenever we prepare SFX.
      try {
        if (ctx.state !== "running") await ctx.resume();
      } catch {
        // If resume fails, we keep going; playback may no-op until a later gesture.
      }

      // "Unlock" audio output path (helps on some mobile Safari versions).
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        const g = ctx.createGain();
        g.gain.value = 0;
        s.buffer = b;
        s.connect(g);
        g.connect(ctx.destination);
        s.start();
      } catch {
        // ignore
      }

      const entries: Array<["correct" | "wrong" | "pasalacabra", string]> = [
        ["correct", sfxCorrectUrl],
        ["wrong", sfxWrongUrl],
        ["pasalacabra", sfxPasalacabraUrl],
      ];

      await Promise.all(
        entries.map(async ([key, url]) => {
          if (sfxBuffersRef.current[key]) return;
          try {
            const raw =
              sfxRawRef.current[key] ??
              (await (await fetch(url)).arrayBuffer());
            sfxRawRef.current[key] = raw;
            const decoded = await ctx.decodeAudioData(raw.slice(0));
            sfxBuffersRef.current[key] = decoded;
          } catch {
            // Ignore; missing buffer means no sound for that key.
          }
        })
      );
    })();

    return sfxLoadPromiseRef.current;
  }

  function playSfx(key: "correct" | "wrong" | "pasalacabra") {
    const ctx = getAudioCtx();
    const buf = sfxBuffersRef.current[key];
    if (!ctx || !buf) return;

    const start = () => {
      const src = ctx.createBufferSource();
      src.buffer = buf;

      const gain = ctx.createGain();
      // Slight per-SFX tuning.
      const volume = key === "pasalacabra" ? 1.0 : 0.95;
      gain.gain.value = volume;

      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
    };

    // If the context is suspended (e.g. after backgrounding), resume then play.
    if (ctx.state !== "running") {
      void ctx
        .resume()
        .then(() => start())
        .catch(() => {
          /* ignore */
        });
      return;
    }

    start();
  }

  function playMicReadyChime() {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";

    // Short upward chirp.
    osc.frequency.setValueAtTime(660, t0);
    osc.frequency.exponentialRampToValueAtTime(990, t0 + 0.08);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.13);
  }

  const activePlayer = session?.players[session.currentPlayerIndex];
  const activePlayerId = activePlayer?.id ?? null;
  const activeSetId = activePlayer?.setId ?? (availableSets[0]?.id ?? "set_01");
  const activeSet = getSet(activeSetId) ?? (availableSets[0]?.id ? getSet(availableSets[0].id) : undefined);
  const qaMap = useMemo(
    () => (activeSet ? buildSetQuestionMap(activeSet) : new Map<Letter, QA>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSetId]
  );

  const currentLetter: Letter = letters[currentIndex];
  const currentQA = qaMap.get(currentLetter) ?? {
    letter: currentLetter,
    question: `Con la ${currentLetter}: (añade tu pregunta en src/data/sets/*.json)`,
    answer: "(sin respuesta)",
  };

  // Keep latest values for async STT callbacks (avoid stale closures).
  useEffect(() => {
    activePlayerIdRef.current = activePlayerId;
    activeSetIdRef.current = activeSetId;
    currentLetterRef.current = currentLetter;
    currentIndexRef.current = currentIndex;
  }, [activePlayerId, activeSetId, currentLetter, currentIndex]);

  const currentPlayerLabel = useMemo(() => {
    if (!session) return "";
    const idx = session.currentPlayerIndex;
    const p = session.players[idx];
    if (!p) return "";
    const n = idx + 1;
    const name = p.name?.trim();
    return name ? `Jugador ${n}: ${name}` : `Jugador ${n}`;
  }, [session]);

  const nextPlayerButtonLabel = useMemo(() => {
    if (!session || session.players.length === 0) return "Siguiente";
    const nextIdx = (session.currentPlayerIndex + 1) % session.players.length;
    const p = session.players[nextIdx];
    const n = nextIdx + 1;
    const name = p?.name?.trim();
    return `Siguiente: ${name || `Jugador ${n}`}`;
  }, [session]);

  function findNextPlayerIndexWithTimeLeft(sess: GameSession, states: Record<string, PlayerState>) {
    const n = sess.players.length;
    if (n <= 1) return -1;
    const from = sess.currentPlayerIndex;
    for (let offset = 1; offset < n; offset++) {
      const idx = (from + offset) % n;
      const p = sess.players[idx];
      const t = states[p.id]?.timeLeft ?? TURN_SECONDS;
      if (t > 0) return idx;
    }
    return -1;
  }

  function getSpanishVoice(vs: SpeechSynthesisVoice[]) {
    // Prefer Spanish voices; fall back gracefully.
    const es = vs.filter((v) => v.lang?.toLowerCase().startsWith("es"));
    const esES = es.find((v) => v.lang?.toLowerCase() === "es-es");
    return esES ?? es[0] ?? vs[0] ?? null;
  }

  function stopSpeaking() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
  }

  function stopListening(reason: "replace" | "user" = "user") {
    sttGenRef.current += 1; // invalidate any in-flight recognizer/events
    // Allow re-starting immediately even if a prior start promise is still pending.
    sttStartPromiseRef.current = null;
    if (sttAutoSubmitTimerRef.current) window.clearTimeout(sttAutoSubmitTimerRef.current);
    sttAutoSubmitTimerRef.current = null;
    const r = recognitionRef.current;
    recognitionRef.current = null;
    phraseListRef.current = null;
    setIsListening(false);
    if (reason === "user") sttDesiredRef.current = false;
    sttLog("stopListening", { reason, hadRecognizer: Boolean(r), desired: sttDesiredRef.current });
    if (!r) return;
    try {
      // Detach callbacks first (avoid state updates after stop).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r as any).recognizing = undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r as any).recognized = undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r as any).canceled = undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r as any).sessionStopped = undefined;

      r.stopContinuousRecognitionAsync(
        () => {
          try {
            r.close();
          } catch {
            // ignore
          }
        },
        () => {
          try {
            r.close();
          } catch {
            // ignore
          }
        }
      );
    } catch {
      try {
        r.close();
      } catch {
        // ignore
      }
    }
  }

  async function startListeningWithHints(hints: string[]): Promise<void> {
    setSttError("");

    // Replace any existing recognizer without disabling STT desire.
    stopListening("replace");
    sttDesiredRef.current = true;
    sttLastHintsRef.current = hints;
    sttLog("startListeningWithHints", { hintsCount: hints.length, desired: sttDesiredRef.current });

    const gen = sttGenRef.current;

    let r: sdk.SpeechRecognizer | null = null;
    try {
      r = await createAzureRecognizer();
    } catch (err) {
      setSttSupported(false);
      setIsListening(false);
      sttDesiredRef.current = false;
      setSttError(String(err));
      sttLog("createAzureRecognizer failed", String(err));
      return;
    }

    // If something changed while we were awaiting token/mic, discard this recognizer.
    if (gen !== sttGenRef.current || !sttDesiredRef.current) {
      try {
        r.close();
      } catch {
        // ignore
      }
      return;
    }

    setSttSupported(true);
    recognitionRef.current = r;

    // Phrase hints: take effect at the start of the NEXT recognition, so set them before start.
    try {
      const pl = sdk.PhraseListGrammar.fromRecognizer(r);
      phraseListRef.current = pl;
      if (Array.isArray(hints) && hints.length > 0) setPhraseHints(pl, hints);
    } catch {
      // ignore; hints are best-effort
    }

    r.recognizing = (_s, e) => {
      if (gen !== sttGenRef.current) return;
      const t = (e.result.text ?? "").trim();
      if (DEBUG_STT && t) sttLog("interim", t);
      // NOTE: don't cancel a pending auto-submit on empty/no-op partial events.
      // Azure can emit a trailing recognizing event with empty text right after a final,
      // which would otherwise cancel the first auto-submit.
      if (t) {
        // Also: after a final, Azure may emit additional partials that repeat the final text.
        // Don't cancel the pending submit unless the user is clearly still speaking (text changed).
        if (sttAutoSubmitTimerRef.current) {
          const lastFinal = sttLastFinalTextRef.current.trim();
          const lastFinalComparable = lastFinal.replace(/[.?!]+$/g, "").trim().toLowerCase();
          const tComparable = t.replace(/[.?!]+$/g, "").trim().toLowerCase();
          const repeatsFinal =
            Boolean(lastFinalComparable) &&
            (tComparable === lastFinalComparable || tComparable.startsWith(lastFinalComparable));
          if (!repeatsFinal) {
            window.clearTimeout(sttAutoSubmitTimerRef.current);
            sttAutoSubmitTimerRef.current = null;
          }
        }
      }
      if (!sttArmedRef.current) return;
      if (!userEditedAnswerRef.current) setAnswerText(t);

      // Voice command should be responsive; Azure sometimes never emits a final RecognizedSpeech.
      if (!t) return;
      if (phaseRef.current !== "playing") return;
      const key = `${activePlayerIdRef.current ?? "noplayer"}:${activeSetIdRef.current}:${currentLetterRef.current}:${currentIndexRef.current}`;
      if (sttCommandKeyRef.current === key) return;
      const { ok, normalizedJoined } = shouldTriggerPasalacabra(t);
      if (!ok) return;
      sttLog("command-check(interim)", { normalizedJoined });
      sttCommandKeyRef.current = key;
      stopListening("user");
      userEditedAnswerRef.current = false;
      setAnswerText("");
      sttLog("-> triggering PASALACABRA (interim)");
      handlePasalacabra();
    };

    r.recognized = (_s, e) => {
      if (gen !== sttGenRef.current) return;
      if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
      const finalText = (e.result.text ?? "").trim();
      if (DEBUG_STT && finalText) sttLog("final", finalText);

      // Only accept transcriptions after the question has finished reading.
      if (!sttArmedRef.current) return;
      sttLastFinalTextRef.current = finalText;
      sttLastFinalAtRef.current = Date.now();
      if (finalText && !userEditedAnswerRef.current) setAnswerText(finalText);

      // Voice command: "pasalacabra" / "pasapalabra" triggers the button action.
      // Trigger only on *final* results.
      if (!finalText) return;
      if (phaseRef.current !== "playing") return;
      const key = `${activePlayerIdRef.current ?? "noplayer"}:${activeSetIdRef.current}:${currentLetterRef.current}:${currentIndexRef.current}`;
      if (sttCommandKeyRef.current === key) return;
      const normalizedWords = normalizeForCompare(finalText);
      const normalizedJoined = normalizedWords.replace(/\s+/g, "");
      const { ok } = shouldTriggerPasalacabra(finalText);
      sttLog("command-check(final)", { normalizedJoined, ok });
      if (ok) {
        sttCommandKeyRef.current = key;
        stopListening("user");
        // Don't keep the command text in the input.
        userEditedAnswerRef.current = false;
        setAnswerText("");
        sttLog("-> triggering PASALACABRA");
        handlePasalacabra();
        return;
      }

      // Auto-submit shortly after the user finishes an utterance.
      // Debounced: any new partial/final cancels the pending submit.
      if (userEditedAnswerRef.current) return;
      if (!finalText) return;
      if (sttAutoSubmitTimerRef.current) window.clearTimeout(sttAutoSubmitTimerRef.current);
      const seq = (sttAutoSubmitSeqRef.current += 1);
      sttAutoSubmitTimerRef.current = window.setTimeout(() => {
        if (seq !== sttAutoSubmitSeqRef.current) return;
        if (phaseRef.current !== "playing") return;
        if (!sttArmedRef.current) return;
        submitAnswer(finalText);
      }, 450);
    };

    const scheduleRestart = (why: string) => {
      setIsListening(false);
      sttLog("restart-check", { why, desired: sttDesiredRef.current, phase: phaseRef.current });
      if (!sttDesiredRef.current) return;
      if (phaseRef.current !== "playing") return;
      if (sttRestartTimerRef.current) window.clearTimeout(sttRestartTimerRef.current);
      sttRestartCountRef.current += 1;
      sttLog("restart-scheduled", { count: sttRestartCountRef.current, why });
      if (sttRestartCountRef.current > 10) return; // safety guard
      sttRestartTimerRef.current = window.setTimeout(() => {
        sttLog("restarting now");
        void startListeningWithHints(sttLastHintsRef.current);
      }, 250);
    };

    r.canceled = (_s, e) => {
      if (gen !== sttGenRef.current) return;
      sttLog("canceled", {
        reason: e.reason,
        errorCode: e.errorCode,
        errorDetails: e.errorDetails,
      });
      sttLastErrorRef.current = String(e.reason ?? "canceled");
      if (e.reason === sdk.CancellationReason.Error) {
        setSttError(e.errorDetails || "Speech recognition canceled");
      }
      scheduleRestart("canceled");
    };

    r.sessionStopped = () => {
      if (gen !== sttGenRef.current) return;
      scheduleRestart("sessionStopped");
    };

    try {
      await new Promise<void>((resolve, reject) => {
        r!.startContinuousRecognitionAsync(
          () => resolve(),
          (err) => reject(err)
        );
      });
      if (gen !== sttGenRef.current) return;
      setIsListening(true);
      sttLog("started");

      // Signal to the user that they can respond (once per question).
      if (sttArmedRef.current && phaseRef.current === "playing") {
        const key = `${activePlayerIdRef.current ?? "noplayer"}:${activeSetIdRef.current}:${currentLetterRef.current}:${currentIndexRef.current}`;
        if (sttMicReadyChimeKeyRef.current !== key) {
          sttMicReadyChimeKeyRef.current = key;
          playMicReadyChime();
        }
      }
    } catch (err) {
      if (gen !== sttGenRef.current) return;
      setIsListening(false);
      sttDesiredRef.current = false; // don't thrash if start failed
      setSttError(String(err));
      sttLog("startContinuousRecognitionAsync failed", String(err));
      try {
        r.close();
      } catch {
        // ignore
      }
    }
  }

  function ensureListeningForQuestion(hints: string[]) {
    // Start recognition once from a user gesture (Start button). After that, keep it running.
    // This avoids WebKit/Safari immediately aborting starts that are not gesture-initiated.
    sttDesiredRef.current = true;
    sttLastHintsRef.current = hints;
    if (recognitionRef.current) return;
    if (sttStartPromiseRef.current) return;
    sttStartPromiseRef.current = startListeningWithHints(hints).finally(() => {
      sttStartPromiseRef.current = null;
    });
  }

  function speakWithCallback(text: string, onDone: () => void, opts?: { rate?: number }) {
    if (!("speechSynthesis" in window)) {
      onDone();
      return;
    }
    const t = text.trim();
    if (!t) {
      onDone();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(t);
    const v = getSpanishVoice(voices);
    if (v) utterance.voice = v;
    utterance.lang = (v?.lang || "es-ES") as string;
    utterance.rate = opts?.rate ?? 1.0;
    utterance.pitch = 1;
    utterance.volume = 1;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDone();
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    window.speechSynthesis.speak(utterance);
    // Fallback in case onend doesn't fire (some mobile edge cases)
    window.setTimeout(finish, 600);
  }

  function speakCurrentQuestionThenListen() {
    // Clear previous draft + (re)start STT only after TTS finishes.
    // Stop mic immediately so the TTS doesn't leak into recognition.
    stopListening("replace");
    sttMicReadyChimeKeyRef.current = null;
    if (sttPreStartTimerRef.current) window.clearTimeout(sttPreStartTimerRef.current);
    sttPreStartTimerRef.current = null;
    userEditedAnswerRef.current = false;
    setAnswerText("");
    setSttError("");
    sttRestartCountRef.current = 0;
    sttArmedRef.current = false;
    setQuestionRead(false);

    const hints = [...buildPhraseHintsForAnswer(currentQA.answer), "pasalacabra", "pasapalabra", "pasa", "cabra"];

    if (!("speechSynthesis" in window)) {
      // No TTS; start mic immediately.
      sttCommandKeyRef.current = null;
      ensureListeningForQuestion(hints);
      sttArmedRef.current = true;
      setQuestionRead(true);
      return;
    }

    const t = currentQA.question.trim();
    if (!t) {
      sttCommandKeyRef.current = null;
      ensureListeningForQuestion(hints);
      sttArmedRef.current = true;
      setQuestionRead(true);
      return;
    }

    const speakQuestion = () => {
      // Cancel any ongoing speech before starting a new one.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(t);
      const v = getSpanishVoice(voices);
      if (v) utterance.voice = v;
      utterance.lang = (v?.lang || "es-ES") as string;
      utterance.rate = 1.15;
      utterance.pitch = 1;
      utterance.volume = 1;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (sttPreStartTimerRef.current) window.clearTimeout(sttPreStartTimerRef.current);
        sttPreStartTimerRef.current = null;
        sttCommandKeyRef.current = null;
        // Start mic immediately after TTS ends (prevents TTS leakage into the answer).
        // This also reduces the "dead air" window where the user starts speaking too early.
        ensureListeningForQuestion(hints);
        sttArmedRef.current = true; // accept results right away
        setQuestionRead(true);
      };
      utterance.onend = finish;
      utterance.onerror = finish;

      window.speechSynthesis.speak(utterance);

      // Fallback: only fire if onend never arrives (avoid firing too early).
      const words = t.split(/\s+/).filter(Boolean).length;
      const fallbackMs = Math.min(20000, Math.max(2500, words * 650));
      // Start STT slightly before we expect TTS to end so the first user syllable is captured.
      // We still keep `sttArmedRef` false until `finish()`, so partials won't update the UI.
      const preStartMs = Math.max(0, fallbackMs - 500);
      sttPreStartTimerRef.current = window.setTimeout(() => {
        // Only pre-start while the question is still being read.
        if (phaseRef.current !== "playing") return;
        if (sttArmedRef.current) return; // already finished
        ensureListeningForQuestion(hints);
      }, preStartMs);
      window.setTimeout(finish, fallbackMs);
    };

    // Prime immediately before the first real question to avoid "first word volume dip".
    primeSpeechSynthesisIfNeeded(speakQuestion);
  }

  // Ensure only one "current"
  useEffect(() => {
    setStatusByLetter((prev) => {
      const next = { ...prev };
      for (const l of letters) {
        if (next[l] === "current") next[l] = "pending";
      }
      next[currentLetter] =
        next[currentLetter] === "correct" || next[currentLetter] === "wrong"
          ? next[currentLetter]
          : "current";
      return next;
    });
    setRevealed(false);
    setFeedback(null);
    userEditedAnswerRef.current = false;
    setAnswerText("");
    setSttError("");
  }, [currentIndex, currentLetter, letters]);

  // Timer
  useEffect(() => {
    if (phase !== "playing") return;
    if (screen !== "game") return;
    if (!activePlayerId) return;

    const id = window.setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) return 0;
        return t - 1;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [phase, screen, activePlayerId]);

  // Load available voices (async in many browsers)
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    const load = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Auto-read the question when the current letter changes during play
  useEffect(() => {
    if (phase !== "playing") return;
    if (!activePlayerId) return;

    const key = `${activePlayerId}:${activeSetId}:${currentLetter}`;
    if (lastSpokenKeyRef.current === key) return;

    lastSpokenKeyRef.current = key;
    speakCurrentQuestionThenListen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentLetter, activePlayerId, activeSetId]);

  // Ensure mic stops outside of play
  useEffect(() => {
    if (phase === "playing") return;
    stopListening();
    setQuestionRead(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Preflight Azure auth on setup screen (avoid network during gameplay/TTS).
  useEffect(() => {
    if (screen !== "setup") return;
    let alive = true;
    setSttPreflightChecking(true);
    void preflightAzureAuth().then((r) => {
      if (!alive) return;
      setSttPreflightChecking(false);
      if (r.ok) {
        setSttSupported(true);
        setSttError("");
      } else {
        // Fail gracefully: allow manual typing.
        setSttSupported(false);
        setSttError(`Voz no disponible: ${r.error}`);
      }
    });
    return () => {
      alive = false;
    };
  }, [screen]);

  // End on timer
  useEffect(() => {
    if (phase === "playing" && timeLeft === 0) {
      // Move index so the next player starts on the next unresolved letter.
      const nextIdx = nextUnresolvedIndex(letters, statusByLetter, currentIndex);
      if (nextIdx !== -1) setCurrentIndex(nextIdx);
      stopSpeaking();
      // If there are multiple players, advance automatically to the next player who still has time.
      if (session && session.players.length > 1) {
        const idxWithTime = findNextPlayerIndexWithTimeLeft(session, playerStates);
        if (idxWithTime === -1) {
          setGameOver(true);
          setGameOverMessage("⏱️ Tiempo. Juego terminado.");
          endTurn("");
          return;
        }
        // Pause at idle for handoff (timer should not run while passing the phone).
        setSession((prev) => (prev ? { ...prev, currentPlayerIndex: idxWithTime } : prev));
        setPhase("idle");
        setTurnMessage("");
        setFeedback(null);
        setRevealed(false);
        lastSpokenKeyRef.current = null;
        return;
      }

      // Single player: game ends when their time is over.
      setGameOver(true);
      setGameOverMessage("⏱️ Tiempo. Juego terminado.");
      endTurn("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase]);

  async function startCamera(facingMode: "user" | "environment" = cameraFacingMode) {
    setCameraError("");
    try {
      // Stop any existing stream before requesting a new one (important for camera flipping)
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        // Use `ideal` to avoid "OverconstrainedError" on devices/browsers that can't satisfy `exact`.
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError("");
    }
  }

  function stopCamera() {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamRef.current = null;
  }

  async function toggleCamera() {
    setIsSwitchingCamera(true);
    try {
      const next: "user" | "environment" = cameraFacingMode === "user" ? "environment" : "user";
      setCameraFacingMode(next);
      await startCamera(next);
    } finally {
      setIsSwitchingCamera(false);
    }
  }

  // Request camera only after entering the game screen.
  // This avoids prompting for camera on the setup screen and ensures mic warmup can happen first.
  useEffect(() => {
    if (screen !== "game") {
      stopCamera();
      return;
    }
    void startCamera(cameraFacingMode);
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraFacingMode, screen]);

  // Keep setup players array sized to player count.
  useEffect(() => {
    const def = availableSets[0]?.id ?? "set_01";
    setSetupPlayers((prev) => {
      const next = prev.slice(0, setupPlayerCount);
      while (next.length < setupPlayerCount) next.push({ name: "", setId: def });
      return next;
    });
  }, [setupPlayerCount, availableSets]);

  // Load active player's saved state when switching players.
  useEffect(() => {
    if (!activePlayerId) return;
    const st = playerStates[activePlayerId];
    if (!st) return;
    setStatusByLetter(st.statusByLetter);
    setCurrentIndex(st.currentIndex);
    setTimeLeft(st.timeLeft);
    setRevealed(st.revealed);
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlayerId]);

  // Persist active player's state on changes.
  useEffect(() => {
    if (!activePlayerId || screen !== "game") return;
    setPlayerStates((prev) => ({
      ...prev,
      [activePlayerId]: { statusByLetter, currentIndex, timeLeft, revealed },
    }));
  }, [activePlayerId, screen, statusByLetter, currentIndex, timeLeft, revealed]);

  async function startFromSetup() {
    unlockAudioOnce();
    // Warm up microphone permission first. On some browsers, requesting mic can temporarily
    // affect the audio session, so we do it before the first meaningful TTS utterance.
    await warmupMicrophoneOnce();

    warmupSpeechSynthesisOnce();
    setGameOver(false);
    setGameOverMessage("");
    const players: Player[] = Array.from({ length: setupPlayerCount }, (_, i) => {
      const raw = setupPlayers[i]?.name ?? "";
      const name = raw.trim() || `Jugador ${i + 1}`;
      const setId = setupPlayers[i]?.setId ?? (availableSets[0]?.id ?? "set_01");
      return { id: `p${i + 1}`, name, setId };
    });

    const initialStates: Record<string, PlayerState> = {};
    for (const p of players) {
      const s = {} as Record<Letter, LetterStatus>;
      for (const l of letters) s[l] = "pending";
      s[letters[0]] = "current";
      initialStates[p.id] = { statusByLetter: s, currentIndex: 0, timeLeft: TURN_SECONDS, revealed: false };
    }

    const proceedToGame = () => {
      setPlayerStates(initialStates);
      setSession({ players, currentPlayerIndex: 0 });
      setScreen("game"); // triggers camera permission request (see effect above)
      setPhase("idle");
      setTurnMessage("");
      setFeedback(null);

      const first = players[0];
      if (first) {
        const st = initialStates[first.id];
        setStatusByLetter(st.statusByLetter);
        setCurrentIndex(st.currentIndex);
        setTimeLeft(st.timeLeft);
        setRevealed(st.revealed);
      }
    };

    proceedToGame();
  }

  async function startTurn() {
    unlockAudioOnce();
    warmupSpeechSynthesisOnce();
    setTurnMessage("");
    // Do NOT reset the clock here: each player has a single 2:00 bank for the whole game.
    // `timeLeft` is already loaded from the active player's saved state.
    if (activePlayerId) {
      const remaining = playerStates[activePlayerId]?.timeLeft ?? TURN_SECONDS;
      if (remaining <= 0) return;
      setTimeLeft(remaining);
    }
    setPhase("playing");
    lastSpokenKeyRef.current = null;
    setFeedback(null);
    // Speak the question directly in the user gesture (mobile Safari often blocks TTS from effects).
    if (activePlayerId) {
      lastSpokenKeyRef.current = `${activePlayerId}:${activeSetId}:${currentLetter}`;
    }
    speakCurrentQuestionThenListen();

    // Preload/prepare SFX in the background; don't await (keeps this handler "gesture-synchronous").
    void ensureSfxReady();

    // Don't reset player time here; only clear per-turn UI flags if needed.
    if (activePlayerId) {
      setPlayerStates((prev) => {
        const existing = prev[activePlayerId];
        if (!existing) return prev;
        return { ...prev, [activePlayerId]: { ...existing, revealed: false } };
      });
    }
  }

  function endTurn(message: string) {
    setPhase("ended");
    setTurnMessage(message);
  }

  function startNextPlayerTurn() {
    // Handoff: next player must press Start (we go back to idle), and their timer resets.
    setTurnMessage("");
    setFeedback(null);
    setRevealed(false);
    setPhase("idle");
    lastSpokenKeyRef.current = null;

    setSession((prev) => {
      if (!prev || prev.players.length === 0) return prev;
      // Skip players who are out of time; if nobody has time left, end the game.
      const idxWithTime = findNextPlayerIndexWithTimeLeft(prev, playerStates);
      if (idxWithTime === -1) {
        setGameOver(true);
        setGameOverMessage("Juego terminado.");
        endTurn("");
        return prev;
      }
      return { ...prev, currentPlayerIndex: idxWithTime };
    });
  }

  function handlePasalacabra() {
    if (phaseRef.current !== "playing") return;

    unlockAudioOnce();
    stopListening("user");
    stopSpeaking();
    // Goat SFX + end turn (timer stops because phase changes away from "playing")
    void ensureSfxReady().then(() => playSfx("pasalacabra"));

    setStatusByLetter((prev) => {
      const next = { ...prev };
      const st = next[currentLetter];
      if (st === "current" || st === "pending") next[currentLetter] = "passed";
      // passed stays passed
      return next;
    });

    // Move to next unresolved so the next turn starts there.
    const nextIdx = nextUnresolvedIndex(letters, { ...statusByLetter, [currentLetter]: "passed" }, currentIndex);
    if (nextIdx !== -1) setCurrentIndex(nextIdx);
    // Single player: Pasalacabra just passes and continues playing.
    if (!session || session.players.length <= 1) {
      setRevealed(false);
      setFeedback(null);
      return;
    }

    // Multiplayer: end the turn and require handoff.
    endTurn("");
  }

  function markCorrect() {
    if (phaseRef.current !== "playing") return;

    unlockAudioOnce();
    stopListening("user");
    stopSpeaking();
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setFeedback("correct");
    speakWithCallback("Sí", () => {
      void ensureSfxReady().then(() => playSfx("correct"));
    });

    setStatusByLetter((prev) => {
      const next = { ...prev };
      next[currentLetter] = "correct";
      return next;
    });

    // Delay the next question a bit so "Correcto" + sound are perceivable.
    const statusAfter = { ...statusByLetter, [currentLetter]: "correct" as LetterStatus };
    feedbackTimerRef.current = window.setTimeout(() => {
      if (!anyUnresolved(statusAfter, letters)) {
        endTurn("🎉 ¡Perfecto! Has terminado todas las letras.");
        return;
      }
      const nextIdx = nextUnresolvedIndex(letters, statusAfter, currentIndex);
      if (nextIdx === -1) {
        endTurn("🎉 ¡Perfecto! Has terminado todas las letras.");
        return;
      }
      setCurrentIndex(nextIdx);
    }, 700);
  }

  function markWrong() {
    if (phaseRef.current !== "playing") return;

    unlockAudioOnce();
    stopListening("user");
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setFeedback("wrong");
    setRevealed(true);
    // End the turn immediately to stop the timer, but don't cancel speech.
    endTurn("");
    speakWithCallback(
      `No. La respuesta correcta es ${currentQA.answer}.`,
      () => {
      void ensureSfxReady().then(() => playSfx("wrong"));
      },
      { rate: 1 }
    );

    setStatusByLetter((prev) => {
      const next = { ...prev };
      next[currentLetter] = "wrong";
      return next;
    });

    // Move index so the next player starts on the next unresolved letter.
    const statusAfter = { ...statusByLetter, [currentLetter]: "wrong" as LetterStatus };
    const nextIdx = nextUnresolvedIndex(letters, statusAfter, currentIndex);
    if (nextIdx !== -1) setCurrentIndex(nextIdx);

    // No need to show "Incorrecto" label; SFX + turn end is enough.
    endTurn("");
  }

  function submitAnswer(spokenOverride?: string) {
    if (phaseRef.current !== "playing") return;
    const spoken = (spokenOverride ?? answerText).trim();
    if (!spoken) return;

    // Stop mic before we speak feedback / play SFX.
    stopListening("user");

    if (isAnswerCorrect(spoken, currentQA.answer)) {
      markCorrect();
    } else {
      markWrong();
    }
  }

  // Note: We don't auto-cancel speech on phase changes because mobile browsers can
  // cancel "No" immediately when ending a turn. We explicitly cancel in the handlers
  // that need it (e.g. Pasalacabra, timeout).

  return (
    <div className="app">
      <div className="backgroundDecoration" aria-hidden="true">
        <span className="goat goat1">🐐</span>
        <span className="goat goat2">🐐</span>
        <span className="goat goat3">🐐</span>
        <span className="goat goat4">🐐</span>
        <span className="goat goat5">🐐</span>
        <span className="goat goat6">🐐</span>
        <span className="goat goat7">🐐</span>
        <span className="goat goat8">🐐</span>
      </div>
      <div className="overlay">
        <div className="topBar">
          {screen === "game" ? (
            <>
              <div className="playerTag">{currentPlayerLabel}</div>
              <div className="timerBig">{formatTime(timeLeft)}</div>
              <button
                className="btnCamFlip"
                type="button"
                onClick={toggleCamera}
                disabled={isSwitchingCamera}
                aria-label="Cambiar cámara"
                title="Cambiar cámara"
              >
                📷 ⟲
              </button>
            </>
          ) : (
            <div className="setupTopTitle"></div>
          )}
        </div>

        {screen === "setup" ? (
          <div className="center">
            <div className="setupCard">
              <div className="setupTitle">Jugadores</div>

              <label className="setupLabel">
                Número de jugadores
                <select
                  className="setupSelect"
                  value={setupPlayerCount}
                  onChange={(e) => setSetupPlayerCount(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <div className="setupPlayers">
                {Array.from({ length: setupPlayerCount }, (_, i) => (
                  <label key={i} className="setupLabel">
                    Jugador {i + 1}
                    <input
                      className="setupInput"
                      value={setupPlayers[i]?.name ?? ""}
                      placeholder={`Nombre del jugador ${i + 1}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSetupPlayers((prev) => {
                          const copy = [...prev];
                          const cur = copy[i] ?? { name: "", setId: availableSets[0]?.id ?? "set_01" };
                          copy[i] = { ...cur, name: v };
                          return copy;
                        });
                      }}
                    />
                    <select
                      className="setupSelect"
                      value={setupPlayers[i]?.setId ?? (availableSets[0]?.id ?? "set_01")}
                      onChange={(e) => {
                        const setId = e.target.value;
                        setSetupPlayers((prev) => {
                          const copy = [...prev];
                          const cur = copy[i] ?? { name: "", setId };
                          copy[i] = { ...cur, setId };
                          return copy;
                        });
                      }}
                    >
                      {availableSets.map((s) => {
                        const setNumber = s.id.match(/\d+/)?.[0] ?? "0";
                        return (
                          <option key={s.id} value={s.id}>
                            Set {setNumber}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                ))}
              </div>

              <div className="setupActions">
                <button className="btnPrimary" type="button" onClick={startFromSetup}>
                  Continuar
                </button>
              </div>

              {sttPreflightChecking ? (
                <div className="answerReveal" style={{ marginTop: 8 }}>
                  Preparando voz…
                </div>
              ) : sttError ? (
                <div className="answerReveal" style={{ marginTop: 8 }}>
                  ⚠️ {sttError}
                </div>
              ) : (
                <div className="answerReveal" style={{ marginTop: 8 }}>
                  Voz lista
                </div>
              )}

              {cameraError && (
                <div className="answerReveal" style={{ marginTop: 8 }}>
                  ⚠️ {cameraError}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="center">
            <div className="ringAndControls">
              <div className="ringWrap">
                <video
                  ref={videoRef}
                  className="cameraInRing"
                  muted
                  playsInline
                  autoPlay
                />
                <LetterRing letters={letters} statusByLetter={statusByLetter} />
              </div>

              <div className="controls">
              {phase === "idle" ? (
                  <button className="btnPrimary" onClick={startTurn} disabled={timeLeft <= 0}>
                    Start
                  </button>
              ) : phase === "playing" ? (
                  <button className="btnPrimary" onClick={handlePasalacabra} disabled={!questionRead}>
                    Pasalacabra
                  </button>
              ) : null}

                <div className="revealSlot">
                  {phase === "playing" ? (
                    <>
                      <input
                        className="answerInput"
                        value={answerText}
                        placeholder={
                          sttSupported
                            ? isListening
                              ? "Escuchando… (pulsa Enter para enviar)"
                              : "Pulsa Enter para enviar"
                            : "Tu navegador no soporta voz: escribe y pulsa Enter"
                        }
                        readOnly={sttSupported}
                        onChange={
                          sttSupported
                            ? undefined
                            : (e) => {
                                userEditedAnswerRef.current = true;
                                setAnswerText(e.target.value);
                              }
                        }
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          submitAnswer();
                        }}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        inputMode="text"
                      />
                      {sttError ? (
                        <div className="answerReveal" style={{ marginTop: 6 }}>
                          Aviso: {sttError}
                        </div>
                      ) : null}
                      {!sttError ? (
                        <div className="answerReveal" style={{ marginTop: 6 }}>
                          {sttSupported ? (isListening ? "Escuchando…" : "Micrófono listo") : "Escritura manual"}
                        </div>
                      ) : null}
                      {feedback === "wrong" || revealed ? (
                        <div className="answerReveal answerRevealBig" style={{ marginTop: 8 }}>
                          Respuesta: <strong>{currentQA.answer}</strong>
                        </div>
                      ) : feedback === "correct" ? (
                        <div className="answerReveal answerRevealBig" style={{ marginTop: 8 }}>
                          <strong>Correcto</strong>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {phase === "ended" && (
                  <>
                    {turnMessage ? (
                      <div className="answerReveal" style={{ marginTop: 2 }}>
                        <strong>{turnMessage}</strong>
                      </div>
                    ) : null}
                  {gameOver ? (
                    <div className="answerReveal answerRevealBig" style={{ marginTop: 2 }}>
                      <strong>{gameOverMessage || "Juego terminado."}</strong>
                    </div>
                  ) : (
                    <button className="btnPrimary" type="button" onClick={startNextPlayerTurn}>
                      {nextPlayerButtonLabel}
                    </button>
                  )}
                  </>
                )}

                {cameraError && (
                  <div className="answerReveal" style={{ marginTop: 2 }}>
                    ⚠️ {cameraError}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
