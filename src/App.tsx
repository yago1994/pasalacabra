import { useEffect, useMemo, useRef, useState } from "react";
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

  // Common STT confusion in Spanish: ñ → n.
  const sN = s.replace(/ñ/g, "n");
  const eN = e.replace(/ñ/g, "n");
  if (sN === eN) return true;

  // Very small plural/singular tolerance for short one-word answers.
  if (s === `${e}s` || e === `${s}s`) return true;
  if (s === `${e}es` || e === `${s}es`) return true;

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
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [sttSupported, setSttSupported] = useState<boolean>(true);
  const [sttError, setSttError] = useState<string>("");
  const [answerText, setAnswerText] = useState<string>("");
  const userEditedAnswerRef = useRef<boolean>(false);
  const sttCommandKeyRef = useRef<string | null>(null);

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

  function stopListening() {
    const r = recognitionRef.current;
    recognitionRef.current = null;
    setIsListening(false);
    if (!r) return;
    try {
      // stop() triggers onend; abort() is immediate.
      r.onresult = null;
      r.onend = null;
      r.onerror = null;
      r.abort?.();
      r.stop?.();
    } catch {
      // ignore
    }
  }

  function startListeningWithHints(hints: string[]) {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    const SGL = window.SpeechGrammarList ?? window.webkitSpeechGrammarList;

    if (!SR) {
      setSttSupported(false);
      setIsListening(false);
      return;
    }

    setSttSupported(true);
    setSttError("");

    stopListening();

    const r = new SR();
    recognitionRef.current = r;

    r.lang = "es-ES";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    // Bias per question (low-latency accuracy win): phrase list / grammar hints.
    // Web Speech API doesn’t have Azure phrase lists, but JSGF grammars are the closest analogue.
    if (SGL && Array.isArray(hints) && hints.length > 0) {
      try {
        const gl = new SGL();
        const safe = hints
          .map((h) =>
            h
              .trim()
              .replace(/[|;]/g, " ")
              .replace(/\s+/g, " ")
              .trim()
          )
          .filter(Boolean);
        if (safe.length > 0) {
          const body = safe.join(" | ");
          const jsgf = `#JSGF V1.0; grammar answers; public <answer> = ${body} ;`;
          gl.addFromString(jsgf, 1);
          r.grammars = gl;
        }
      } catch {
        // ignore; hints are best-effort
      }
    }

    r.onresult = (ev: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i];
        const t = res?.[0]?.transcript ?? "";
        if (res.isFinal) finalText += `${t} `;
        else interimText += `${t} `;
      }
      const combined = `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
      if (!userEditedAnswerRef.current) setAnswerText(combined);

      // Voice command: "pasalacabra" / "pasapalabra" triggers the button action.
      // We only trigger on *final* results to avoid false positives from interim text.
      if (!finalText.trim()) return;
      if (phase !== "playing") return;
      const key = `${activePlayerId ?? "noplayer"}:${activeSetId}:${currentLetter}:${currentIndex}`;
      if (sttCommandKeyRef.current === key) return;
      const normalized = normalizeForCompare(finalText).replace(/\s+/g, "");
      if (normalized.includes("pasalacabra") || normalized.includes("pasapalabra")) {
        sttCommandKeyRef.current = key;
        stopListening();
        // Don't keep the command text in the input.
        userEditedAnswerRef.current = false;
        setAnswerText("");
        handlePasalacabra();
      }
    };

    r.onerror = (ev: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      setSttError(String(ev?.error || "Speech recognition error"));
    };

    r.onend = () => {
      setIsListening(false);
    };

    try {
      r.start();
      setIsListening(true);
    } catch (err) {
      setIsListening(false);
      setSttError(String(err));
    }
  }

  function speakWithCallback(text: string, onDone: () => void) {
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
    utterance.rate = 1;
    utterance.pitch = 1;

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
    stopListening();
    userEditedAnswerRef.current = false;
    setAnswerText("");
    setSttError("");

    const hints = [...buildPhraseHintsForAnswer(currentQA.answer), "pasalacabra", "pasapalabra"];

    if (!("speechSynthesis" in window)) {
      startListeningWithHints(hints);
      return;
    }

    const t = currentQA.question.trim();
    if (!t) {
      startListeningWithHints(hints);
      return;
    }

    // Cancel any ongoing speech before starting a new one.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(t);
    const v = getSpanishVoice(voices);
    if (v) utterance.voice = v;
    utterance.lang = (v?.lang || "es-ES") as string;
    utterance.rate = 1;
    utterance.pitch = 1;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sttCommandKeyRef.current = null;
      startListeningWithHints(hints);
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    window.speechSynthesis.speak(utterance);

    // Fallback: only fire if onend never arrives (avoid firing too early).
    const words = t.split(/\s+/).filter(Boolean).length;
    const fallbackMs = Math.min(20000, Math.max(2500, words * 650));
    window.setTimeout(finish, fallbackMs);
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
  }, [phase]);

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

  // Camera on by default (even when turn is stopped). Restart it on facingMode changes.
  useEffect(() => {
    void startCamera(cameraFacingMode);
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraFacingMode]);

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

  function startFromSetup() {
    unlockAudioOnce();
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

    setPlayerStates(initialStates);
    setSession({ players, currentPlayerIndex: 0 });
    setScreen("game");
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
  }

  async function startTurn() {
    unlockAudioOnce();
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
    if (phase !== "playing") return;

    unlockAudioOnce();
    stopListening();
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
    if (phase !== "playing") return;

    unlockAudioOnce();
    stopListening();
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
    if (phase !== "playing") return;

    unlockAudioOnce();
    stopListening();
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setFeedback("wrong");
    setRevealed(true);
    // End the turn immediately to stop the timer, but don't cancel speech.
    endTurn("");
    speakWithCallback(`No. La respuesta correcta es ${currentQA.answer}.`, () => {
      void ensureSfxReady().then(() => playSfx("wrong"));
    });

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

  function submitAnswer() {
    if (phase !== "playing") return;
    const spoken = answerText.trim();
    if (!spoken) return;

    // Stop mic before we speak feedback / play SFX.
    stopListening();

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
      <video
        ref={videoRef}
        className="camera"
        muted
        playsInline
        autoPlay
      />

      <div className="overlay">
        <div className="topBar">
          {screen === "game" ? (
            <>
              <div className="playerTag">{currentPlayerLabel}</div>
              <div className="timerBig">{formatTime(timeLeft)}</div>
            </>
          ) : (
            <div className="setupTopTitle">Configura jugadores</div>
          )}
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
                      {availableSets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title ? `${s.id} — ${s.title}` : s.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <div className="setupActions">
                <button className="btnPrimary" type="button" onClick={startFromSetup}>
                  Continuar
                </button>
              </div>

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
                <LetterRing letters={letters} statusByLetter={statusByLetter} />
              </div>

              <div className="controls">
              {phase === "idle" ? (
                  <button className="btnPrimary" onClick={startTurn} disabled={timeLeft <= 0}>
                    Start
                  </button>
              ) : phase === "playing" ? (
                  <button className="btnPrimary" onClick={handlePasalacabra}>
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
                        onChange={(e) => {
                          userEditedAnswerRef.current = true;
                          setAnswerText(e.target.value);
                        }}
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
