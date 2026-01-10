import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import LetterRing from "./components/LetterRing";
import GameDetails, { type SetupPlayer } from "./components/GameDetails";
import HomePage from "./components/HomePage";
import {
  SPANISH_LETTERS,
  type Letter,
  type QA,
  buildQuestionMap as buildSetQuestionMap,
  getSet,
  listSets,
} from "./data/sets";
import { generatePlayerBanks } from "./questions/index";
import type { QA as TopicQA } from "./questions/types";
import sfxCorrectUrl from "./assets/sfx-correct.wav";
import sfxWrongUrl from "./assets/sfx-wrong.wav";
import sfxPasalacabraUrl from "./assets/sfx-pasalacabra.wav";
import type { GameSession, Player, LetterStatus, DifficultyMode } from "./game/engine";
import { preflightAzureAuth, setPhraseHints } from "./speech/speechazure";
import { createAzureRecognizer } from "./speech/createAzureRecognizer";
import type { Topic } from "./questions/types";
import {
  captureSnapshotWithRing,
  type StatusByLetter as SnapshotStatusByLetter,
  type LetterStatus as SnapshotLetterStatus,
} from "./snapshotComposer";
import type { CanvasRecording } from "./game/canvasRecorder";
import { createCanvasRecorder, downloadRecording, shareOrDownloadRecording } from "./game/canvasRecorder";
import { initializePendo } from "./lib/pendo";
import { isStagingMode } from "./env/getSpeechTokenUrl";
import { shareEmojiSequence } from "./game/shareRing";

// Player snapshot captured when timer runs out
export type PlayerSnapshot = {
  playerId: string;
  playerName: string;
  blobUrl: string;
  statusByLetter: Record<Letter, LetterStatus>;
  correctCount: number;
  wrongCount: number;
};

type GamePhase = "idle" | "playing" | "ended";
type Screen = "home" | "setup" | "game";

const TURN_SECONDS =180; // Default fallback (will be replaced by difficulty-based time)

function getTimeFromDifficulty(difficulty: DifficultyMode): number {
  const isStaging = isStagingMode();
  switch (difficulty) {
    case "dificil": return isStaging ? 2 : 180; // 2 seconds in staging, 3 minutes in prod
    case "medio": return isStaging ? 15 : 240; // 15 seconds in staging, 4 minutes in prod
    case "facil": return isStaging ? 30 : 300; // 5 minutes
  }
}

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

function computeWinnerIds(snaps: PlayerSnapshot[]): Set<string> {
  if (!snaps.length) return new Set();
  const maxCorrect = Math.max(...snaps.map((s) => s.correctCount));
  const topPlayers = snaps.filter((s) => s.correctCount === maxCorrect);
  const minWrong = Math.min(...topPlayers.map((s) => s.wrongCount));
  return new Set(topPlayers.filter((s) => s.wrongCount === minWrong).map((s) => s.playerId));
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

  // If the spoken text contains the expected answer (like "pasalacabra" detection),
  // mark it as correct. This handles cases like "Es ADN" or "La respuesta es ADN".
  if (s.includes(e)) return true;

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

  const [screen, setScreen] = useState<Screen>("home");
  const [setupPlayerCount, setSetupPlayerCount] = useState<number>(2);
  const [difficultyMode, setDifficultyMode] = useState<DifficultyMode>("medio");
  
  // Topic selection state
  const [selectedTopics, setSelectedTopics] = useState<Set<Topic>>(new Set());
  const [topicSelectionError, setTopicSelectionError] = useState<string>("");
  const [testMode, setTestMode] = useState<boolean>(isStagingMode());
  // Generated question banks for each player (indexed by player id)
  const [generatedBanks, setGeneratedBanks] = useState<Record<string, Map<Letter, TopicQA>>>({});
  
  const [setupPlayers, setSetupPlayers] = useState<SetupPlayer[]>(() => {
    const def = "set_04"; // Set all to set 4 as requested
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
  const [confettiGoats, setConfettiGoats] = useState<Array<{ id: number; left: number; delay: number }>>([]);

  // Player snapshots for end-of-game slideshow
  const [playerSnapshots, setPlayerSnapshots] = useState<PlayerSnapshot[]>([]);
  const [slideshowIndex, setSlideshowIndex] = useState<number>(0);
  const [slideshowActive, setSlideshowActive] = useState<boolean>(false);

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
  const [recentlyCorrectLetter, setRecentlyCorrectLetter] = useState<Letter | null>(null);
  const [lastWrongLetter, setLastWrongLetter] = useState<Letter | null>(null); // For override button

  // Camera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string>("");
  const cameraFacingMode: "user" | "environment" = "user";

  // Video recording for sharing
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<ReturnType<typeof createCanvasRecorder> | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<CanvasRecording | null>(null);
  const SLIDE_MS = 1500;
  // Keep a ref mirror so timeouts/raf can read the latest value
  const isRecordingRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  // Safari can produce 0-byte/unplayable blobs if we start recording before the canvas paints.
  const recordingHasPaintedRef = useRef(false);
  const recordingImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

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
  // Interim-based auto-submit: faster response when user stops speaking
  const sttInterimAutoSubmitTimerRef = useRef<number | null>(null);
  const sttLastInterimTextRef = useRef<string>("");
  const sttLastInterimAtRef = useRef<number>(0);
  const sttLastFinalTextRef = useRef<string>("");
  const sttLastFinalAtRef = useRef<number>(0);
  const micWarmRef = useRef<boolean>(false);
  const ttsWarmRef = useRef<boolean>(false);
  const ttsPrimeAtRef = useRef<number>(0);
  const ttsPrimingRef = useRef<boolean>(false);
  const ttsSeqRef = useRef<number>(0);
  const sttMicReadyChimeKeyRef = useRef<string | null>(null);
  const sttPreStartTimerRef = useRef<number | null>(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [sttSupported, setSttSupported] = useState<boolean>(true);
  const [sttError, setSttError] = useState<string>("");
  const [answerText, setAnswerText] = useState<string>("");
  const userEditedAnswerRef = useRef<boolean>(false);
  const [questionRead, setQuestionRead] = useState<boolean>(false);
  const [earlySkipAllowed, setEarlySkipAllowed] = useState<boolean>(false);
  const earlySkipTimerRef = useRef<number | null>(null);
  const [sttPreflightChecking, setSttPreflightChecking] = useState<boolean>(false);
  const sttCommandKeyRef = useRef<string | null>(null);
  const sttDesiredRef = useRef<boolean>(false);
  const sttLastHintsRef = useRef<string[]>([]);
  const sttRestartTimerRef = useRef<number | null>(null);
  const sttRestartCountRef = useRef<number>(0);
  const sttLastErrorRef = useRef<string | null>(null);
  const sttArmedRef = useRef<boolean>(false);
  const sttArmedAtRef = useRef<number>(0); // Timestamp when mic was armed - used to ignore stale results
  const sttPostFlushRef = useRef<boolean>(false); // True when arming after a barrier restart/flush
  const sttBellPendingRef = useRef<boolean>(false); // True when we should play chime on first non-empty partial
  const phaseRef = useRef<GamePhase>("idle");
  const activePlayerIdRef = useRef<string | null>(null);
  const activeSetIdRef = useRef<string>("");
  const currentLetterRef = useRef<Letter>(letters[0]);
  const currentIndexRef = useRef<number>(0);
  const currentQARef = useRef<{ question: string; answer: string }>({ question: "", answer: "" });
  const statusByLetterRef = useRef<Record<Letter, LetterStatus>>({} as Record<Letter, LetterStatus>);
  const sessionRef = useRef<GameSession | null>(null);
  const playerStatesRef = useRef<Record<string, PlayerState>>({});
  // Ref to always call the latest submitAnswer (avoids stale closures in persistent recognizer)
  const submitAnswerRef = useRef<(spokenOverride?: string) => void>(() => {});
  // Track player switches to avoid persisting stale values when loading a new player's state
  const lastLoadedPlayerIdRef = useRef<string | null>(null);

  // Speech-to-text (Azure)// Holds a cleanup function for the Azure mic stream + meter
  const azureMicCloseRef = useRef<null | (() => void)>(null);
  // Store the MediaStream to reuse across recognizer restarts (prevents Chrome permission prompts)
  const azureMicStreamRef = useRef<MediaStream | null>(null);

  // Optional: expose current mic volume in dB for gating/debug
  const micDbRef = useRef<null | (() => number)>(null);

  // Push-stream gating: control what audio reaches Azure during TTS
  const openGateRef = useRef<null | (() => void)>(null);
  const closeGateRef = useRef<null | (() => void)>(null);
  const resumeAudioContextRef = useRef<null | (() => Promise<void>)>(null);
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
      const v = getSpanishVoice(voices);
      if (v) u.voice = v;
      u.lang = (v?.lang || "es-ES") as string;
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
      const v = getSpanishVoice(voices);
      if (v) u.voice = v;
      u.lang = (v?.lang || "es-ES") as string;
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

  // Initialize Pendo analytics
  useEffect(() => {
    // TODO: Replace with actual visitor and account IDs when user authentication is implemented
    // For now, Pendo will use anonymous IDs generated from localStorage
    
    // Determine environment (staging or production) from build-time variable
    const env = (import.meta.env.VITE_DEFAULT_ENV as string | undefined) || 'prod';
    const isStaging = env === 'staging';
    
    initializePendo(
      undefined, // visitorId - using anonymous
      undefined, // accountId - using anonymous
      undefined, // visitorData
      {
        name: isStaging ? 'Staging' : 'Production',
        environment: env,
      }
    );
  }, []);

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
    const ctx = getAudioCtx();
    if (!ctx) return;

    // IMPORTANT: do not await here; we want this to run in the same user-gesture call stack.
    try {
      void ctx.resume();
    } catch {
      // ignore
    }

    // iOS Safari sometimes needs an actual (silent) start() call to fully unlock audio output.
    // We do this every time on mobile to ensure audio stays unlocked.
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
    if (!audioUnlockedRef.current) {
      audioUnlockedRef.current = true;
      void ensureSfxReady();
    }
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
  // On mobile, the AudioContext can get suspended again (e.g., after backgrounding),
  // so we re-unlock on every tap to ensure audio keeps working.
  useEffect(() => {
    const handler = () => unlockAudioOnce();
    // Use capture phase to ensure we run before any other handlers
    window.addEventListener("pointerdown", handler, { capture: true });
    window.addEventListener("touchstart", handler, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", handler, { capture: true });
      window.removeEventListener("touchstart", handler, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureSfxReady() {
    const ctx = getAudioCtx();
    if (!ctx) return;

    // On mobile, ALWAYS try to resume the audio context before playing,
    // even if buffers are already loaded. Context can get suspended unexpectedly.
    try {
      if (ctx.state !== "running") {
        await ctx.resume();
      }
    } catch {
      // If resume fails, we keep going; playback may no-op until a later gesture.
    }

    if (sfxLoadPromiseRef.current) return sfxLoadPromiseRef.current;

    sfxLoadPromiseRef.current = (async () => {
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
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;

        const gain = ctx.createGain();
        // Slight per-SFX tuning.
        const volume = key === "pasalacabra" ? 1.0 : 0.95;
        gain.gain.value = volume;

        src.connect(gain);
        gain.connect(ctx.destination);
        src.start();
      } catch (err) {
        console.warn("Failed to play SFX:", key, err);
      }
    };

    // Always try to resume first on mobile (context can get suspended unexpectedly).
    // Then play the sound.
    if (ctx.state !== "running") {
      void ctx
        .resume()
        .then(() => start())
        .catch(() => {
          // Try to play anyway - some browsers report wrong state
          start();
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
    gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.01);
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
  
  // Use generated bank if available (dynamic mode), otherwise use set-based questions (test mode)
  const qaMap = useMemo(() => {
    // Check if we have a generated bank for this player
    if (activePlayerId && generatedBanks[activePlayerId]) {
      // Convert TopicQA to QA format
      const bank = generatedBanks[activePlayerId];
      const converted = new Map<Letter, QA>();
      for (const [letter, q] of bank.entries()) {
        converted.set(letter, {
          letter: q.letter,
          question: q.question,
          answer: q.answer,
        });
      }
      return converted;
    }
    // Fallback to set-based questions (test mode)
    return activeSet ? buildSetQuestionMap(activeSet) : new Map<Letter, QA>();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSetId, activePlayerId, generatedBanks]);

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
    currentQARef.current = currentQA;
    statusByLetterRef.current = statusByLetter;
    sessionRef.current = session;
    playerStatesRef.current = playerStates;
  }, [activePlayerId, activeSetId, currentLetter, currentIndex, currentQA, statusByLetter, session, playerStates]);

  const currentPlayerLabel = useMemo(() => {
    if (!session) return "";
    const idx = session.currentPlayerIndex;
    const p = session.players[idx];
    if (!p) return "";
    const n = idx + 1;
    const name = p.name?.trim();
    return name || `Jugador ${n}`;
  }, [session]);

  const nextPlayerButtonLabel = useMemo(() => {
    if (!session || session.players.length === 0) return "Siguiente";
    // Find the next player who still has time left
    const nextIdx = findNextPlayerIndexWithTimeLeft(session, playerStates);
    if (nextIdx === -1) return "Siguiente";
    const p = session.players[nextIdx];
    const n = nextIdx + 1;
    const name = p?.name?.trim();
    return `Siguiente: ${name || `Jugador ${n}`}`;
  }, [session, playerStates]);

  // Check if the current player has completed the first round (reached Z at least once)
  // The first round ends when the Z letter has been answered/passed
  // TODO: Remove `true ||` after testing - this enables early skip from the start for testing
  const hasCompletedFirstRound = useMemo(() => {
    const zStatus = statusByLetter["Z" as Letter];
    return false || zStatus === "correct" || zStatus === "wrong" || zStatus === "passed";
  }, [statusByLetter]);

  function findNextPlayerIndexWithTimeLeft(sess: GameSession, states: Record<string, PlayerState>) {
    const n = sess.players.length;
    if (n <= 1) return -1;
    const from = sess.currentPlayerIndex;
    const defaultTime = getTimeFromDifficulty(sess.difficulty);
    for (let offset = 1; offset < n; offset++) {
      const idx = (from + offset) % n;
      const p = sess.players[idx];
      const t = states[p.id]?.timeLeft ?? defaultTime;
      if (t > 0) return idx;
    }
    return -1;
  }

  function countPlayersWithTimeLeft(sess: GameSession, states: Record<string, PlayerState>) {
    let count = 0;
    const defaultTime = getTimeFromDifficulty(sess.difficulty);
    for (const p of sess.players) {
      const t = states[p.id]?.timeLeft ?? defaultTime;
      if (t > 0) count++;
    }
    return count;
  }

  function calculatePlayerScore(states: Record<string, PlayerState>, playerId: string) {
    const state = states[playerId];
    if (!state) return { correct: 0, wrong: 0 };
    let correct = 0;
    let wrong = 0;
    for (const status of Object.values(state.statusByLetter)) {
      if (status === "correct") correct++;
      else if (status === "wrong") wrong++;
    }
    return { correct, wrong };
  }

  // Convert game LetterStatus to snapshot LetterStatus
  function toSnapshotStatus(status: LetterStatus): SnapshotLetterStatus {
    switch (status) {
      case "correct": return "correct";
      case "wrong": return "wrong";
      case "passed": return "passed";
      case "current":
      case "pending":
      default: return "idle";
    }
  }

  // Capture a snapshot for a player when their timer runs out
  const capturePlayerSnapshot = useCallback(async (
    playerId: string,
    playerName: string,
    currentStatusByLetter: Record<Letter, LetterStatus>,
    playerCurrentIndex: number
  ) => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      console.warn("Cannot capture snapshot: video not ready");
      return;
    }

    try {
      // Convert status map for snapshot composer
      const snapshotStatus: SnapshotStatusByLetter = {};
      for (const l of letters) {
        snapshotStatus[l] = toSnapshotStatus(currentStatusByLetter[l]);
      }

      // Calculate scores
      let correctCount = 0;
      let wrongCount = 0;
      for (const status of Object.values(currentStatusByLetter)) {
        if (status === "correct") correctCount++;
        else if (status === "wrong") wrongCount++;
      }

      // Capture the snapshot with full game UI
      // Uses same proportions as LetterRing.tsx (800px canvas = 2x the 400px SVG)
      const canvasSize = 800;
      const blob = await captureSnapshotWithRing(video, {
        outWidth: canvasSize,
        outHeight: canvasSize,
        fit: "cover",
        mimeType: "image/webp",
        quality: 0.92,
        ring: {
          letters: [...letters],
          statusByLetter: snapshotStatus,
          currentIndex: playerCurrentIndex,
          // Let the composer calculate dimensions using the game's ratios
          style: {
            // Scale font to match: 16px in 400px SVG = 32px in 800px canvas
            letterFont: "800 32px system-ui, -apple-system, Segoe UI, Roboto",
            letterColor: "rgba(255,255,255,0.98)",
            dotStrokeWidth: 4, // Scale: 2px * 2
            dotStroke: "rgba(255,255,255,0.35)",
            backgroundColor: "#4f8dff", // --letter-default (blue background)
            // Use exact game colors from CSS variables
            statusFill: {
              correct: "#2bb673", // --letter-correct (green)
              wrong: "#ff4d4d",   // --letter-wrong (red)
              passed: "#4f8dff",  // --letter-passed (blue, same as default)
              idle: "#4f8dff",    // --letter-default (blue)
            },
            idleFill: "#4f8dff",
          },
        },
      });

      const blobUrl = URL.createObjectURL(blob);

      const snapshot: PlayerSnapshot = {
        playerId,
        playerName,
        blobUrl,
        statusByLetter: { ...currentStatusByLetter },
        correctCount,
        wrongCount,
      };

      setPlayerSnapshots((prev) => {
        console.log(`Adding snapshot for ${playerName}, total will be:`, prev.length + 1);
        return [...prev, snapshot];
      });
      console.log(`Snapshot captured for ${playerName}, blobUrl:`, blobUrl.substring(0, 50));
    } catch (err) {
      console.error("Failed to capture snapshot:", err);
    }
  }, [letters]);

  function determineWinners(sess: GameSession, states: Record<string, PlayerState>) {
    const scores = sess.players.map((p) => {
      const { correct, wrong } = calculatePlayerScore(states, p.id);
      return { player: p, correct, wrong };
    });

    // Sort by correct (desc), then by wrong (asc)
    scores.sort((a, b) => {
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.wrong - b.wrong;
    });

    // Find all players with the same best score
    const best = scores[0];
    const winners = scores.filter(
      (s) => s.correct === best.correct && s.wrong === best.wrong
    );

    return { winners, allScores: scores };
  }

  function getSpanishVoice(vs: SpeechSynthesisVoice[]) {
    if (vs.length === 0) return null;
    
    const userAgent = navigator.userAgent.toLowerCase();
    const defaultVoice = (() => {
      // Prefer Spanish voices; fall back gracefully.
      const es = vs.filter((v) => v.lang?.toLowerCase().startsWith("es"));
      const esES = es.find((v) => v.lang?.toLowerCase() === "es-es");
      return esES ?? es[0] ?? vs[0] ?? null;
    })();
    
    // Helper function to find Monica voice using multiple strategies
    const findMonicaVoice = () => {
      // Strategy 1: Exact voiceURI match for macOS Safari
      const macosVoice = vs.find(
        (v) => v.voiceURI === "com.apple.voice.super-compact.es-ES.Monica"
      );
      if (macosVoice) return macosVoice;
      
      // Strategy 2: Search for "monica" or "mónica" in voiceURI (case-insensitive)
      const uriMatch = vs.find((v) => 
        v.voiceURI.toLowerCase().includes("monica") || 
        v.voiceURI.toLowerCase().includes("mónica")
      );
      if (uriMatch) return uriMatch;
      
      // Strategy 3: Search for "monica" or "mónica" in name (case-insensitive)
      const nameMatch = vs.find((v) => 
        v.name.toLowerCase().includes("monica") || 
        v.name.toLowerCase().includes("mónica")
      );
      if (nameMatch) return nameMatch;
      
      return null;
    };
    
    // Firefox detection - use Monica voice
    if (userAgent.includes("firefox")) {
      const firefoxVoice = vs.find(
        (v) => v.voiceURI === "urn:moz-tts:osx:com.apple.voice.compact.es-ES.Monica"
      );
      if (firefoxVoice) return firefoxVoice;
      // Fallback to default if specific voice not found
      return defaultVoice;
    }
    
    // Chrome detection - use Mónica voice
    if (userAgent.includes("chrome") && !userAgent.includes("edg")) {
      const chromeVoice = vs.find((v) => v.voiceURI === "Mónica");
      if (chromeVoice) return chromeVoice;
      // Fallback to default if specific voice not found
      return defaultVoice;
    }
    
    // Safari detection (macOS and iOS) - use Monica voice
    if (userAgent.includes("safari") && !userAgent.includes("chrome")) {
      const monicaVoice = findMonicaVoice();
      if (monicaVoice) return monicaVoice;
      // Fallback to default if Monica not found
      return defaultVoice;
    }
    
    // Other browsers - use default Spanish voice
    return defaultVoice;
  }


  function stopSpeaking() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
  }

  function stopListening(reason: "replace" | "user" = "user") {
    sttGenRef.current += 1; // invalidate any in-flight recognizer/events
    // Allow re-starting immediately even if a prior start promise is still pending.
    sttStartPromiseRef.current = null;
    azureMicCloseRef.current?.();
    azureMicCloseRef.current = null;
    micDbRef.current = null;
    // Clear gate refs when stopping
    openGateRef.current = null;
    closeGateRef.current = null;
    resumeAudioContextRef.current = null;
    
    // Only clear the stream ref if we're fully stopping (not just replacing)
    // When replacing, we want to keep the stream alive for reuse
    if (reason === "user") {
      if (azureMicStreamRef.current) {
        for (const track of azureMicStreamRef.current.getTracks()) {
          try {
            track.stop();
          } catch { /* ignore */ }
        }
        azureMicStreamRef.current = null;
      }
    }
    
    if (sttAutoSubmitTimerRef.current) window.clearTimeout(sttAutoSubmitTimerRef.current);
    sttAutoSubmitTimerRef.current = null;
    if (sttInterimAutoSubmitTimerRef.current) window.clearTimeout(sttInterimAutoSubmitTimerRef.current);
    sttInterimAutoSubmitTimerRef.current = null;
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
      // Reuse existing stream if available (prevents repeated getUserMedia calls)
      const bundle = await createAzureRecognizer({
        existingStream: azureMicStreamRef.current ?? undefined,
      });
      r = bundle.recognizer;

      // Store the stream for future reuse
      azureMicStreamRef.current = bundle.stream;

      // store these so your recognizing/recognized handlers can gate
      azureMicCloseRef.current?.();      // close any previous stream if it exists  
      azureMicCloseRef.current = bundle.close;   // so you can cleanup on replace/stop
      micDbRef.current = bundle.getDb;           // store function
      // Store gate control functions for TTS integration
      openGateRef.current = bundle.openGate;
      closeGateRef.current = bundle.closeGate;
      resumeAudioContextRef.current = bundle.resume;
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

      // Ignore stale partials that were captured during TTS but arrive right after arming.
      // After a barrier restart/flush, use a shorter guard (20ms) since there shouldn't be stale audio.
      const msSinceArmed = Date.now() - sttArmedAtRef.current;
      const guardMs = sttPostFlushRef.current ? 20 : 150;
      if (msSinceArmed < guardMs) return;

      // Once we accept any event post-flush, clear the flag
      if (sttPostFlushRef.current) sttPostFlushRef.current = false;

      // Play the mic ready chime on the first non-empty partial after arming
      if (sttArmedRef.current && sttBellPendingRef.current && t) {
        sttBellPendingRef.current = false;
        if (phaseRef.current === "playing") {
          const key = `${activePlayerIdRef.current ?? "noplayer"}:${activeSetIdRef.current}:${currentLetterRef.current}:${currentIndexRef.current}`;
          if (sttMicReadyChimeKeyRef.current !== key) {
            sttMicReadyChimeKeyRef.current = key;
            playMicReadyChime();
          }
        }
      }

      if (!userEditedAnswerRef.current) setAnswerText(t);

      // Voice command should be responsive; Azure sometimes never emits a final RecognizedSpeech.
      if (!t) return;
      if (phaseRef.current !== "playing") return;
      const key = `${activePlayerIdRef.current ?? "noplayer"}:${activeSetIdRef.current}:${currentLetterRef.current}:${currentIndexRef.current}`;
      if (sttCommandKeyRef.current === key) return;
      const { ok, normalizedJoined } = shouldTriggerPasalacabra(t);
      if (ok) {
        sttLog("command-check(interim)", { normalizedJoined });
        sttCommandKeyRef.current = key;
        // Don't stop listening yet - let handlePasalacabra decide based on single/multiplayer
        // This preserves the stream in single-player mode (handlePasalacabra will just disarm)
        userEditedAnswerRef.current = false;
        setAnswerText("");
        sttLog("-> triggering PASALACABRA (interim)");
        handlePasalacabra();
        return;
      }

      // Interim-based auto-submit: if no new speech arrives within 500ms, submit the interim text.
      // This is faster than waiting for Azure's final (which waits for silence + post-processing).
      // Only for regular answers (not commands like pasalacabra which are handled above).
      if (userEditedAnswerRef.current) return;
      sttLastInterimTextRef.current = t;
      sttLastInterimAtRef.current = Date.now();
      if (sttInterimAutoSubmitTimerRef.current) window.clearTimeout(sttInterimAutoSubmitTimerRef.current);
      const interimSeq = (sttAutoSubmitSeqRef.current += 1);
      sttInterimAutoSubmitTimerRef.current = window.setTimeout(() => {
        // Don't submit if a final already handled it or if state changed
        if (interimSeq !== sttAutoSubmitSeqRef.current) return;
        if (phaseRef.current !== "playing") return;
        if (!sttArmedRef.current) return;
        // Don't submit if user edited the answer manually
        if (userEditedAnswerRef.current) return;
        // Submit using the last interim text
        const textToSubmit = sttLastInterimTextRef.current.trim();
        if (!textToSubmit) return;
        sttLog("interim-auto-submit", { textToSubmit });
        submitAnswerRef.current(textToSubmit);
      }, 500);
    };

    r.recognized = (_s, e) => {
      if (gen !== sttGenRef.current) return;
      if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
      const finalText = (e.result.text ?? "").trim();
      if (DEBUG_STT && finalText) sttLog("final", finalText);

      // Clear any pending interim auto-submit since final is more authoritative
      if (sttInterimAutoSubmitTimerRef.current) {
        window.clearTimeout(sttInterimAutoSubmitTimerRef.current);
        sttInterimAutoSubmitTimerRef.current = null;
      }

      // Only accept transcriptions after the question has finished reading.
      if (!sttArmedRef.current) return;

      // Ignore stale results that were captured during TTS but arrive right after arming.
      // After a barrier restart/flush, use a shorter guard (20ms) since there shouldn't be stale audio.
      const msSinceArmed = Date.now() - sttArmedAtRef.current;
      const guardMs = sttPostFlushRef.current ? 20 : 150;
      if (msSinceArmed < guardMs) {
        if (DEBUG_STT) sttLog("ignoring-stale-result", { finalText, msSinceArmed, guardMs });
        return;
      }

      // Once we accept any event post-flush, clear the flag
      if (sttPostFlushRef.current) sttPostFlushRef.current = false;

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
        // Don't stop listening yet - let handlePasalacabra decide based on single/multiplayer
        // This preserves the stream in single-player mode (handlePasalacabra will just disarm)
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
        // Use ref to call the LATEST submitAnswer (avoids stale closure)
        submitAnswerRef.current(finalText);
      }, 300);
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

  function disarmListening() {
    // Just disarm the mic (ignore results) without stopping it.
    // This avoids audio ducking from re-initializing the mic.
    sttArmedRef.current = false;
    sttPostFlushRef.current = false;
    sttBellPendingRef.current = false;
    if (sttAutoSubmitTimerRef.current) window.clearTimeout(sttAutoSubmitTimerRef.current);
    sttAutoSubmitTimerRef.current = null;
    if (sttInterimAutoSubmitTimerRef.current) window.clearTimeout(sttInterimAutoSubmitTimerRef.current);
    sttInterimAutoSubmitTimerRef.current = null;
  }

  function ensureListeningForQuestion(hints: string[]) {
    // Start recognition once from a user gesture (Start button). After that, keep it running.
    // This avoids WebKit/Safari immediately aborting starts that are not gesture-initiated.
    sttDesiredRef.current = true;
    sttLastHintsRef.current = hints;

    // If recognizer is already running, just update the phrase hints
    if (recognitionRef.current) {
      if (phraseListRef.current) {
        try {
          setPhraseHints(phraseListRef.current, hints);
          sttLog("updated hints on running recognizer", { hintsCount: hints.length });
        } catch {
          // ignore; hints are best-effort
        }
      }
      return;
    }

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
    const rate = opts?.rate ?? 1.0;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    let done = false;
    let pollId: number | null = null;
    let maxTimer: number | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (pollId) window.clearInterval(pollId);
      if (maxTimer) window.clearTimeout(maxTimer);
      onDone();
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    window.speechSynthesis.speak(utterance);

    // Dynamic TTS end detection (same pattern as speakCurrentQuestionThenListen):
    // - Safari can have unreliable `onend` timing; also, we never want to "end early".
    // - We poll `speechSynthesis.speaking` and only finish when it truly stops.
    // - We still include a generous max timeout as a safety valve.
    const startedAt = Date.now();
    const words = t.split(/\s+/).filter(Boolean).length;
    // Adjust for speech rate: at rate 0.9, TTS is ~10% slower
    // Estimate ~200ms per word at normal rate, with buffer
    const maxMs = Math.min(45000, Math.max(2000, words * (250 / rate)));

    let speechStoppedAt: number | null = null;
    pollId = window.setInterval(() => {
      if (done) return;
      const now = Date.now();
      if (now - startedAt < 400) return; // avoid false negatives right after speak()
      
      if (!window.speechSynthesis.speaking) {
        // Speech has stopped, but wait 300ms to ensure audio buffer finishes
        if (speechStoppedAt === null) {
          speechStoppedAt = now;
        } else if (now - speechStoppedAt >= 300) {
          // Speech has been stopped for at least 300ms, safe to finish
          finish();
        }
      } else {
        // Speech is still speaking, reset the stopped timer
        speechStoppedAt = null;
      }
    }, 120);

    maxTimer = window.setTimeout(finish, maxMs);
  }

  function speakCurrentQuestionThenListen() {
    const ttsSeq = ++ttsSeqRef.current;
    // Disarm mic during TTS - don't stop it to avoid audio ducking.
    // The mic stays running continuously; we just ignore its output during TTS.
    disarmListening();
    // Close the audio gate to send silence to Azure during TTS (prevents leakage).
    closeGateRef.current?.();
    sttMicReadyChimeKeyRef.current = null;
    if (sttPreStartTimerRef.current) window.clearTimeout(sttPreStartTimerRef.current);
    sttPreStartTimerRef.current = null;
    userEditedAnswerRef.current = false;
    setAnswerText("");
    setSttError("");
    sttRestartCountRef.current = 0;
    setQuestionRead(false);
    // Reset early skip state and start 1s timer for early skip after first round
    setEarlySkipAllowed(false);
    if (earlySkipTimerRef.current) window.clearTimeout(earlySkipTimerRef.current);
    earlySkipTimerRef.current = window.setTimeout(() => {
      setEarlySkipAllowed(true);
    }, 1000);
    // Reset last final text to avoid stale data affecting the new question
    sttLastFinalTextRef.current = "";
    sttLastFinalAtRef.current = 0;

    // Use ref to get current QA (avoids stale closures when called from setTimeout)
    const qa = currentQARef.current;
    const hints = [...buildPhraseHintsForAnswer(qa.answer), "pasalacabra", "pasapalabra", "pasa", "cabra"];

    // Ensure mic is running BEFORE TTS starts.
    // If already running, this just updates the phrase hints.
    // Starting before TTS avoids mid-question audio ducking.
    ensureListeningForQuestion(hints);

    if (!("speechSynthesis" in window)) {
      // No TTS; arm mic and open gate immediately.
      sttCommandKeyRef.current = null;
      openGateRef.current?.();
      sttArmedRef.current = true;
      sttArmedAtRef.current = Date.now();
      setQuestionRead(true);
      return;
    }

    const t = qa.question.trim();
    if (!t) {
      sttCommandKeyRef.current = null;
      openGateRef.current?.();
      sttArmedRef.current = true;
      sttArmedAtRef.current = Date.now();
      setQuestionRead(true);
      return;
    }

    const speakQuestion = () => {
      const QUESTION_RATE = 0.9;
      const INTRO_TO_BODY_PAUSE_MS = 500;

      // Split "Con la X:" / "Empieza por X:" / "Contiene la X:" so the prefix is read at normal speed,
      // and the actual clue is read at the configured question speed.
      const m = t.match(/^(Con\s+la|Empieza\s+por|Contiene\s+la)\s+([A-ZÑ])\s*:\s*(.+)$/i);
      const intro = m ? `${m[1]} ${m[2].toUpperCase()}.` : "";
      const body = (m ? m[3] : t).trim();

      const finishAll = () => {
        if (ttsSeq !== ttsSeqRef.current) return;
        if (sttPreStartTimerRef.current) window.clearTimeout(sttPreStartTimerRef.current);
        sttPreStartTimerRef.current = null;
        sttCommandKeyRef.current = null;
        // Mic is already running (started at the beginning of TTS).
        // Open the gate to start sending real audio to Azure, then arm to accept results.
        // No barrier restart needed: the gate was sending silence during TTS, so no stale audio.
        openGateRef.current?.();
        setAnswerText("");
        sttLastFinalTextRef.current = "";
        sttLastFinalAtRef.current = 0;
        sttPostFlushRef.current = true; // Still use short guard since gate was closed
        sttBellPendingRef.current = true;
        sttArmedRef.current = true;
        sttArmedAtRef.current = Date.now();
        setQuestionRead(true);
      };

      const speakChunk = (text: string, rate: number, onDone: () => void) => {
        const chunk = text.trim();
        if (!chunk) {
          onDone();
          return;
        }

        const utterance = new SpeechSynthesisUtterance(chunk);
        const v = getSpanishVoice(voices);
        if (v) utterance.voice = v;
        utterance.lang = (v?.lang || "es-ES") as string;
        utterance.rate = rate;
        utterance.pitch = 1;
        utterance.volume = 1;

        let done = false;
        let pollId: number | null = null;
        let maxTimer: number | null = null;

        const finish = () => {
          if (done) return;
          done = true;
          if (pollId) window.clearInterval(pollId);
          if (maxTimer) window.clearTimeout(maxTimer);
          onDone();
        };
        utterance.onend = finish;
        utterance.onerror = finish;

        window.speechSynthesis.speak(utterance);

        // Dynamic TTS end detection:
        // - Safari can have unreliable `onend` timing; also, we never want to "end early".
        // - We poll `speechSynthesis.speaking` and only finish when it truly stops.
        // We still include a generous max timeout as a safety valve.
        const startedAt = Date.now();
        const words = chunk.split(/\s+/).filter(Boolean).length;
        // Adjust for speech rate: at rate 0.9, TTS is ~10% slower
        const maxMs = Math.min(45000, Math.max(8000, words * (1000 / rate)));

        pollId = window.setInterval(() => {
          if (done) return;
          const now = Date.now();
          if (now - startedAt < 400) return; // avoid false negatives right after speak()
          if (!window.speechSynthesis.speaking) finish();
        }, 120);

        maxTimer = window.setTimeout(finish, maxMs);
      };

      // Cancel any ongoing speech before starting the (intro + question) sequence.
      window.speechSynthesis.cancel();

      if (intro) {
        speakChunk(intro, 1.0, () => {
          if (ttsSeq !== ttsSeqRef.current) return;
          window.setTimeout(() => {
            if (ttsSeq !== ttsSeqRef.current) return;
            speakChunk(body, QUESTION_RATE, finishAll);
          }, INTRO_TO_BODY_PAUSE_MS);
        });
      } else {
        speakChunk(body, QUESTION_RATE, finishAll);
      }
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

  // Mobile hardening: resume AudioContext when page becomes visible
  // This handles iOS/Safari suspending audio when the page is backgrounded
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        sttLog("Page visible, resuming AudioContext");
        resumeAudioContextRef.current?.();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
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

  // Ensure mic stops when game ends, but keep it running during idle (player handoff)
  useEffect(() => {
    if (phase === "playing") return;
    if (phase === "idle") {
      // During handoff, just disarm but keep mic running for quick start
      disarmListening();
      setQuestionRead(false);
      return;
    }
    // Phase is "ended" - stop the mic fully
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
      unlockAudioOnce();
      stopSpeaking();
      disarmListening();
      
      // Capture snapshot for the current player (with a small delay to ensure video frame is stable)
      const currentSession = sessionRef.current;
      const currentPlayerId = activePlayerIdRef.current;
      const snapshotCurrentIndex = currentIndexRef.current;
      if (currentSession && currentPlayerId) {
        const player = currentSession.players.find(p => p.id === currentPlayerId);
        if (player) {
          // Small delay to ensure video frame is rendered and stable
          window.setTimeout(() => {
            void capturePlayerSnapshot(
              currentPlayerId,
              player.name || `Jugador ${currentSession.currentPlayerIndex + 1}`,
              statusByLetterRef.current,
              snapshotCurrentIndex
            );
          }, 200);
        }
      }
      
      // Stop the turn immediately by changing phase, then speak "Tiempoooo!"
      setPhase("idle");
      
      // Small delay to ensure speech cancellation completes before speaking "Tiempoooo!"
      window.setTimeout(() => {
        speakWithCallback("Tieeeeeeeempoo!", () => {
          // Use refs to get current values (avoids stale closures)
          const sess = sessionRef.current;
          const states = playerStatesRef.current;
          
          // Check if there are other players with time left
          if (sess && sess.players.length > 1) {
            const idxWithTime = findNextPlayerIndexWithTimeLeft(sess, states);
            if (idxWithTime === -1) {
              // No players left with time - game ends
              setGameOver(true);
              setGameOverMessage("⏱️ Tiempo. Fin del juego.");
              endTurn("");
              return;
            }
            // End turn and wait for manual "Siguiente" click
            // The game continues as long as other players have time
            endTurn("");
            return;
          }

          // Single player: game ends when their time is over.
          setGameOver(true);
          setGameOverMessage("⏱️ Tiempo. Fin del juego.");
          endTurn("");
        });
      }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase, capturePlayerSnapshot]);

  // Confetti goats when game ends
  useEffect(() => {
    if (!gameOver) {
      setConfettiGoats([]);
      return;
    }

    // Create 100 confetti goats with random positions and delays spread over 10 seconds
    const goats = Array.from({ length: 100 }, (_, i) => ({
      id: Date.now() + i,
      left: Math.random() * 100, // Random horizontal position (0-100%)
      delay: Math.random() * 10, // Random delay spread over 10 seconds
    }));
    setConfettiGoats(goats);

    // Clean up after animation completes (10s max delay + 3s animation)
    const cleanup = setTimeout(() => {
      setConfettiGoats([]);
    }, 14000);

    return () => clearTimeout(cleanup);
  }, [gameOver]);

  // Slideshow effect when game ends with snapshots
  useEffect(() => {
    if (!gameOver || playerSnapshots.length === 0) {
      setSlideshowActive(false);
      setSlideshowIndex(0);
      return;
    }

    // Start slideshow after a brief delay
    const startTimer = setTimeout(() => {
      setSlideshowActive(true);
      setSlideshowIndex(0);
    }, 500);

    return () => clearTimeout(startTimer);
  }, [gameOver, playerSnapshots.length]);

  // Auto-advance slideshow (loops continuously until closed)
  useEffect(() => {
    if (!slideshowActive || playerSnapshots.length === 0) return;

    // Show each snapshot for 1.5 seconds, then loop
    const advanceTimer = setInterval(() => {
      setSlideshowIndex((prev) => {
        const next = prev + 1;
        // Loop back to start when reaching the end
        return next >= playerSnapshots.length ? 0 : next;
      });
    }, 1500);

    return () => clearInterval(advanceTimer);
  }, [slideshowActive, playerSnapshots.length]);

  // Function to close the slideshow
  function closeSlideshow() {
    if (isRecording) void stopRecording();
    setSlideshowActive(false);
  }

  // Function to replay the slideshow
  function replaySlideshow() {
    setSlideshowIndex(0);
    setSlideshowActive(true);
  }

  // Clean up blob URLs only when component unmounts (not on every change)
  // We use a ref to track URLs that need cleanup
  const snapshotUrlsRef = useRef<string[]>([]);
  
  useEffect(() => {
    // Track new blob URLs for cleanup
    const currentUrls = playerSnapshots.map(s => s.blobUrl);
    snapshotUrlsRef.current = currentUrls;
  }, [playerSnapshots]);

  useEffect(() => {
    // Only cleanup on unmount
    return () => {
      for (const url of snapshotUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

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

  // Video recording functions
  async function startRecording() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Guard against async races (e.g. double-tap)
    if (isRecordingRef.current) return;

    // cleanup old url
    if (recording?.url) URL.revokeObjectURL(recording.url);
    setRecording(null);

    const r = createCanvasRecorder(canvas, 30);
    recorderRef.current = r;

    await r.start(); // <- now async
    setIsRecording(true);
    isRecordingRef.current = true;
  }
  
  async function stopRecording(): Promise<CanvasRecording | null> {
    const r = recorderRef.current;
    if (!r) return null;

    const result = await r.stop();
    recorderRef.current = null;

    setRecording(result);
    setIsRecording(false);
    isRecordingRef.current = false;
    return result;
  }
  
  async function shareRecording() {
    if (!recording) return;
  
    await shareOrDownloadRecording(
      recording,
      `pasalacabra-${crypto.randomUUID()}`
    );
  }

  function downloadVideo() {
    if (!recording) return;
    downloadRecording(
      recording,
      `pasalacabra-${crypto.randomUUID()}`
    );
  }

  async function grabarYCompartir() {
    if (!canvasRef.current) return;
    if (!playerSnapshots.length) return;
    if (isRecordingRef.current) return;
  
    // limpia anterior
    if (recording?.url) URL.revokeObjectURL(recording.url);
    setRecording(null);
    recordingHasPaintedRef.current = false;
  
    // reinicia slideshow para que el video empiece “bonito”
    setSlideshowIndex(0);
    setSlideshowActive(true);

    // Wait until the recording canvas has actually painted at least one frame.
    // (On Safari, starting MediaRecorder before the first paint often yields an unplayable blob.)
    const startWait = performance.now();
    while (!recordingHasPaintedRef.current && performance.now() - startWait < 2000) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
  
    await startRecording();
  
    const durationMs = playerSnapshots.length * SLIDE_MS + 300;
    await new Promise((r) => setTimeout(r, durationMs));
  
    const result = await stopRecording();
    if (!result) return;
  
      // intenta compartir (si el navegador lo bloquea, el botón "Compartir video" seguirá funcionando)
      try {
        await shareOrDownloadRecording(
          result,
          `pasalacabra-${crypto.randomUUID()}`
        );
    } catch (e) {
      console.log("Share blocked/cancelled:", e);
    }
  }

  async function handleShareEmojiSequence() {
    // Only available for single-player games
    if (!session || session.players.length !== 1) {
      alert("La función de compartir emoji solo está disponible para juegos de un solo jugador.");
      return;
    }

    // Get the first (and only) player snapshot
    if (playerSnapshots.length === 0) {
      alert("No hay resultados para compartir.");
      return;
    }

    const snapshot = playerSnapshots[0];
    const playerName = session.players[0]?.name;

    // Use the refactored function from shareRing
    await shareEmojiSequence(snapshot.statusByLetter, playerName);
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

  // Record slideshow animation when it starts
  useEffect(() => {
    if (!slideshowActive || !playerSnapshots.length || !canvasRef.current) return;
  
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const drawCtx = ctx;
    
    canvas.width = 800;
    canvas.height = 800;
  
    let animationFrameId: number;
    let lastFrameTime = 0;
    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS;
    const slideshowDuration = playerSnapshots.length * SLIDE_MS;
    const startTime = Date.now();
  
    function drawFrame() {
      const now = Date.now();
      if (now - lastFrameTime < frameInterval) {
        animationFrameId = requestAnimationFrame(drawFrame);
        return;
      }
      lastFrameTime = now;
  
      const elapsed = now - startTime;
  
      try {
        const slideIndex = Math.floor((elapsed % slideshowDuration) / SLIDE_MS);
        const currentSlide = playerSnapshots[slideIndex];
        if (!currentSlide) {
          animationFrameId = requestAnimationFrame(drawFrame);
          return;
        }
  
        // Always paint a background so the canvas has pixels.
        drawCtx.fillStyle = "rgba(0,0,0,0.85)";
        drawCtx.fillRect(0, 0, canvas.width, canvas.height);

        // Load/cache the image so we don't create a new Image every frame.
        const cache = recordingImageCacheRef.current;
        let img = cache.get(currentSlide.blobUrl);
        if (!img) {
          img = new Image();
          img.src = currentSlide.blobUrl;
          cache.set(currentSlide.blobUrl, img);
        }

        if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
          const imgAspect = img.naturalWidth / img.naturalHeight;

          // Fit image with a bit of padding
          const pad = 40;
          const maxW = canvas.width - pad * 2;
          const maxH = canvas.height - pad * 2;

          let drawW = maxW;
          let drawH = drawW / imgAspect;
          if (drawH > maxH) {
            drawH = maxH;
            drawW = drawH * imgAspect;
          }
          const drawX = (canvas.width - drawW) / 2;
          const drawY = (canvas.height - drawH) / 2;

          // Rounded rect clip
          const r = 24;
          drawCtx.save();
          drawCtx.beginPath();
          drawCtx.moveTo(drawX + r, drawY);
          drawCtx.lineTo(drawX + drawW - r, drawY);
          drawCtx.quadraticCurveTo(drawX + drawW, drawY, drawX + drawW, drawY + r);
          drawCtx.lineTo(drawX + drawW, drawY + drawH - r);
          drawCtx.quadraticCurveTo(drawX + drawW, drawY + drawH, drawX + drawW - r, drawY + drawH);
          drawCtx.lineTo(drawX + r, drawY + drawH);
          drawCtx.quadraticCurveTo(drawX, drawY + drawH, drawX, drawY + drawH - r);
          drawCtx.lineTo(drawX, drawY + r);
          drawCtx.quadraticCurveTo(drawX, drawY, drawX + r, drawY);
          drawCtx.closePath();
          drawCtx.clip();
          drawCtx.drawImage(img, drawX, drawY, drawW, drawH);
          drawCtx.restore();

          // Caption overlay (winner + name + score)
          const winnerIds = computeWinnerIds(playerSnapshots);
          const isWinner = winnerIds.has(currentSlide.playerId);

          // Bottom overlay
          const overlayH = 150;
          const overlayY = canvas.height - overlayH - 24;
          drawCtx.save();
          drawCtx.fillStyle = "rgba(0,0,0,0.55)";
          drawCtx.beginPath();
          const ox = 40;
          const ow = canvas.width - 80;
          const r2 = 18;
          drawCtx.moveTo(ox + r2, overlayY);
          drawCtx.lineTo(ox + ow - r2, overlayY);
          drawCtx.quadraticCurveTo(ox + ow, overlayY, ox + ow, overlayY + r2);
          drawCtx.lineTo(ox + ow, overlayY + overlayH - r2);
          drawCtx.quadraticCurveTo(ox + ow, overlayY + overlayH, ox + ow - r2, overlayY + overlayH);
          drawCtx.lineTo(ox + r2, overlayY + overlayH);
          drawCtx.quadraticCurveTo(ox, overlayY + overlayH, ox, overlayY + overlayH - r2);
          drawCtx.lineTo(ox, overlayY + r2);
          drawCtx.quadraticCurveTo(ox, overlayY, ox + r2, overlayY);
          drawCtx.closePath();
          drawCtx.fill();
          drawCtx.restore();

          // Text
          const centerX = canvas.width / 2;
          let y = overlayY + 48;
          drawCtx.textAlign = "center";
          drawCtx.textBaseline = "middle";

          if (isWinner) {
            drawCtx.font = "900 34px system-ui, -apple-system, Segoe UI, Roboto";
            drawCtx.fillStyle = "#FFD700";
            drawCtx.shadowColor = "rgba(255,215,0,0.55)";
            drawCtx.shadowBlur = 16;
            drawCtx.fillText(`🏆 Ganador: ${currentSlide.playerName}!`, centerX, y);
            drawCtx.shadowBlur = 0;
            y += 44;
          } else {
            drawCtx.font = "900 36px system-ui, -apple-system, Segoe UI, Roboto";
            drawCtx.fillStyle = "#ffffff";
            drawCtx.shadowColor = "rgba(0,0,0,0.5)";
            drawCtx.shadowBlur = 14;
            drawCtx.fillText(currentSlide.playerName, centerX, y);
            drawCtx.shadowBlur = 0;
            y += 44;
          }

          // Score line
          drawCtx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto";
          drawCtx.fillStyle = "#2bb673";
          drawCtx.fillText(`✓ ${currentSlide.correctCount}`, centerX - 90, y);
          drawCtx.fillStyle = "#ff4d4d";
          drawCtx.fillText(`✗ ${currentSlide.wrongCount}`, centerX + 90, y);

          // Mark that we have painted a real frame (Safari recording gate).
          recordingHasPaintedRef.current = true;
        }
  
      } catch (err) {
        console.error("Error drawing slideshow frame:", err);
      }
  
      animationFrameId = requestAnimationFrame(drawFrame);
    }
  
    drawFrame();
  
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [slideshowActive, playerSnapshots.length]);

  // Keep setup players array sized to player count.
  useEffect(() => {
    const def = "set_04"; // Set all to set 4 as requested
    setSetupPlayers((prev) => {
      const next = prev.slice(0, setupPlayerCount);
      while (next.length < setupPlayerCount) next.push({ name: "", setId: def });
      return next;
    });
  }, [setupPlayerCount, availableSets]);

  // Load active player's saved state when switching players.
  useEffect(() => {
    if (!activePlayerId) return;
    // Only load if this is a DIFFERENT player than before
    if (activePlayerId === lastLoadedPlayerIdRef.current) return;
    
    const st = playerStates[activePlayerId];
    if (!st) return;
    
    // Mark that we're loading this player's state
    lastLoadedPlayerIdRef.current = activePlayerId;
    
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
    // Only persist if this player's state has been loaded
    // (prevents persisting stale values during player switch)
    if (activePlayerId !== lastLoadedPlayerIdRef.current) return;
    
    setPlayerStates((prev) => ({
      ...prev,
      [activePlayerId]: { statusByLetter, currentIndex, timeLeft, revealed },
    }));
  }, [activePlayerId, screen, statusByLetter, currentIndex, timeLeft, revealed]);

  async function startDailyGame() {
    unlockAudioOnce();
    // Warm up microphone permission first. On some browsers, requesting mic can temporarily
    // affect the audio session, so it before the first meaningful TTS utterance.
    await warmupMicrophoneOnce();

    warmupSpeechSynthesisOnce();
    setGameOver(false);
    setGameOverMessage("");
    // Clear previous snapshots when starting a new game
    for (const snapshot of playerSnapshots) {
      URL.revokeObjectURL(snapshot.blobUrl);
    }
    setPlayerSnapshots([]);
    setSlideshowActive(false);
    setSlideshowIndex(0);
    
    // Create a single player using set_01 for daily game
    const players: Player[] = [{ 
      id: "p1", 
      name: "Jugador 1", 
      setId: "set_01" 
    }];

    // Don't set generatedBanks - the game will use the set file directly via setId
    setGeneratedBanks({});

    const dailyDifficulty: DifficultyMode = "medio"; // Default difficulty for daily game
    const timePerPlayer = getTimeFromDifficulty(dailyDifficulty);
    const initialStates: Record<string, PlayerState> = {};
    for (const p of players) {
      const s = {} as Record<Letter, LetterStatus>;
      for (const l of letters) s[l] = "pending";
      s[letters[0]] = "current";
      initialStates[p.id] = { statusByLetter: s, currentIndex: 0, timeLeft: timePerPlayer, revealed: false };
    }

    const proceedToGame = () => {
      setPlayerStates(initialStates);
      setSession({ players, currentPlayerIndex: 0, difficulty: dailyDifficulty });
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
        // Mark this player as loaded so the persist effect works correctly
        lastLoadedPlayerIdRef.current = first.id;
      }

      // Start the recognizer early (before first TTS) to avoid audio ducking.
      // Use generic hints; they'll be updated when the first question starts.
      const genericHints = ["pasalacabra", "pasapalabra", "pasa", "cabra"];
      sttArmedRef.current = false; // Don't process results yet
      ensureListeningForQuestion(genericHints);
    };

    proceedToGame();
  }

  async function startFromSetup() {
    // Validate that at least one topic is selected (unless in test mode)
    if (!testMode && selectedTopics.size === 0) {
      setTopicSelectionError("Selecciona al menos un tema para jugar.");
      return;
    }
    setTopicSelectionError("");
    
    unlockAudioOnce();
    // Warm up microphone permission first. On some browsers, requesting mic can temporarily
    // affect the audio session, so we do it before the first meaningful TTS utterance.
    await warmupMicrophoneOnce();

    warmupSpeechSynthesisOnce();
    setGameOver(false);
    setGameOverMessage("");
    // Clear previous snapshots when starting a new game
    for (const snapshot of playerSnapshots) {
      URL.revokeObjectURL(snapshot.blobUrl);
    }
    setPlayerSnapshots([]);
    setSlideshowActive(false);
    setSlideshowIndex(0);
    const players: Player[] = Array.from({ length: setupPlayerCount }, (_, i) => {
      const raw = setupPlayers[i]?.name ?? "";
      const name = raw.trim() || `Jugador ${i + 1}`;
      const setId = setupPlayers[i]?.setId ?? "set_04";
      return { id: `p${i + 1}`, name, setId };
    });

    // Generate question banks for each player if not in test mode
    let banks: Record<string, Map<Letter, TopicQA>> = {};
    if (!testMode && selectedTopics.size > 0) {
      try {
        const topicsArray = Array.from(selectedTopics);
        const generatedBanksList = generatePlayerBanks(topicsArray, setupPlayerCount);
        for (let i = 0; i < players.length; i++) {
          banks[players[i].id] = generatedBanksList[i];
        }
        setGeneratedBanks(banks);
      } catch (err) {
        console.error("Error generating question banks:", err);
        setTopicSelectionError("Error al generar preguntas. Intenta seleccionar más temas.");
        return;
      }
    }

    const timePerPlayer = getTimeFromDifficulty(difficultyMode);
    const initialStates: Record<string, PlayerState> = {};
    for (const p of players) {
      const s = {} as Record<Letter, LetterStatus>;
      for (const l of letters) s[l] = "pending";
      s[letters[0]] = "current";
      initialStates[p.id] = { statusByLetter: s, currentIndex: 0, timeLeft: timePerPlayer, revealed: false };
    }

    const proceedToGame = () => {
      setPlayerStates(initialStates);
      setSession({ players, currentPlayerIndex: 0, difficulty: difficultyMode });
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
        // Mark this player as loaded so the persist effect works correctly
        lastLoadedPlayerIdRef.current = first.id;
      }

      // Start the recognizer early (before first TTS) to avoid audio ducking.
      // Use generic hints; they'll be updated when the first question starts.
      const genericHints = ["pasalacabra", "pasapalabra", "pasa", "cabra"];
      sttArmedRef.current = false; // Don't process results yet
      ensureListeningForQuestion(genericHints);
    };

    proceedToGame();
  }

  async function startTurn() {
    unlockAudioOnce();
    warmupSpeechSynthesisOnce();
    setTurnMessage("");
    setLastWrongLetter(null); // Clear any pending override from previous turn
    
    // Use refs to get current values (avoids stale closures when called from setTimeout)
    const playerId = activePlayerIdRef.current;
    const states = playerStatesRef.current;
    
    // Do NOT reset the clock here: each player has a single time bank for the whole game.
    // `timeLeft` is already loaded from the active player's saved state.
    if (playerId) {
      const currentSession = sessionRef.current;
      const defaultTime = currentSession ? getTimeFromDifficulty(currentSession.difficulty) : TURN_SECONDS;
      const remaining = states[playerId]?.timeLeft ?? defaultTime;
      if (remaining <= 0) return;
      setTimeLeft(remaining);
    }
    setPhase("playing");
    lastSpokenKeyRef.current = null;
    setFeedback(null);

    // If mic is still initializing (from handoff), wait for it to complete.
    // This prevents audio ducking when the next player presses Start quickly.
    if (sttStartPromiseRef.current) {
      await sttStartPromiseRef.current;
    }

    // Speak the question directly in the user gesture (mobile Safari often blocks TTS from effects).
    if (playerId) {
      lastSpokenKeyRef.current = `${playerId}:${activeSetIdRef.current}:${currentLetterRef.current}`;
    }
    speakCurrentQuestionThenListen();

    // Preload/prepare SFX in the background; don't await (keeps this handler "gesture-synchronous").
    void ensureSfxReady();

    // Don't reset player time here; only clear per-turn UI flags if needed.
    if (playerId) {
      setPlayerStates((prev) => {
        const existing = prev[playerId];
        if (!existing) return prev;
        return { ...prev, [playerId]: { ...existing, revealed: false } };
      });
    }
  }

  function endTurn(message: string) {
    setPhase("ended");
    setTurnMessage(message);
  }

  function startNextPlayerTurn() {
    // Handoff: advance to next player and automatically start their turn.
    setTurnMessage("");
    setFeedback(null);
    setRevealed(false);
    lastSpokenKeyRef.current = null;

    // Use refs to get current values (avoids stale closures)
    const currentSession = sessionRef.current;
    const states = playerStatesRef.current;

    // Check if there's a next player with time
    const idxWithTime = currentSession ? findNextPlayerIndexWithTimeLeft(currentSession, states) : -1;
    if (idxWithTime === -1) {
      setGameOver(true);
      setGameOverMessage("Fin del juego.");
      endTurn("");
      return;
    }

    // Advance to next player (they'll be in idle state, waiting for Empezar button)
    setSession((prev) => {
      if (!prev || prev.players.length === 0) return prev;
      return { ...prev, currentPlayerIndex: idxWithTime };
    });
    
    // Go to idle state so the next player can click "Empezar"
    setPhase("idle");
    
    // Ensure mic stays running during idle for quick start
    const genericHints = ["pasalacabra", "pasapalabra", "pasa", "cabra"];
    ensureListeningForQuestion(genericHints);
  }

  function handlePasalacabra() {
    if (phaseRef.current !== "playing") return;

    // Use refs to get current values (avoids stale closures from persistent recognizer)
    const letter = currentLetterRef.current;
    const idx = currentIndexRef.current;
    const status = statusByLetterRef.current;
    const currentSession = sessionRef.current;
    const states = playerStatesRef.current;

    unlockAudioOnce();
    
    // Check if this is effectively single-player mode:
    // - Actually single player, OR
    // - Only one player left with time remaining
    const isSinglePlayer = !currentSession || currentSession.players.length <= 1;
    const playersWithTime = currentSession ? countPlayersWithTimeLeft(currentSession, states) : 1;
    const isLastPlayerStanding = playersWithTime <= 1;
    const shouldContinuePlaying = isSinglePlayer || isLastPlayerStanding;
    
    if (shouldContinuePlaying) {
      disarmListening();
    } else {
      stopListening("user");
    }
    stopSpeaking();
    // Goat SFX + end turn (timer stops because phase changes away from "playing")
    // On mobile, always try to resume audio context before playing
    const ctx = getAudioCtx();
    if (ctx && ctx.state !== "running") {
      void ctx.resume().catch(() => {});
    }
    void ensureSfxReady().then(() => playSfx("pasalacabra"));

    setStatusByLetter((prev) => {
      const next = { ...prev };
      const st = next[letter];
      if (st === "current" || st === "pending") next[letter] = "passed";
      // passed stays passed
      return next;
    });

    // Move to next unresolved so the next turn starts there.
    const nextIdx = nextUnresolvedIndex(letters, { ...status, [letter]: "passed" }, idx);
    if (nextIdx !== -1) setCurrentIndex(nextIdx);
    
    // Single player or last player standing: just skip to next question
    if (shouldContinuePlaying) {
      setRevealed(false);
      setFeedback(null);
      return;
    }

    // Multiplayer with multiple players remaining: end the turn and require handoff.
    endTurn("");
  }

  function markCorrect() {
    if (phaseRef.current !== "playing") return;

    // Use refs to get current values (avoids stale closures from persistent recognizer)
    const letter = currentLetterRef.current;
    const idx = currentIndexRef.current;
    const status = statusByLetterRef.current;

    unlockAudioOnce();
    // Just disarm - keep mic running for next question
    disarmListening();
    stopSpeaking();
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setFeedback("correct");
    
    // Update status to correct
    const statusAfter = { ...status, [letter]: "correct" as LetterStatus };
    setStatusByLetter((prev) => {
      const next = { ...prev };
      next[letter] = "correct";
      return next;
    });

    // Trigger particle animation
    setRecentlyCorrectLetter(letter);
    setTimeout(() => setRecentlyCorrectLetter(null), 1200);

    // Play SFX first, then speak. When speech finishes, move to next question.
    void ensureSfxReady().then(() => {
      playSfx("correct");
      window.setTimeout(() => {
        // On mobile, always try to resume audio context before speaking (required for TTS on iOS/mobile)
        const ctx = getAudioCtx();
        if (ctx && ctx.state !== "running") {
          void ctx.resume().catch(() => {});
        }
        speakWithCallback("Sí", () => {
          // Speech has finished according to polling, but add a small buffer
          // to ensure audio buffer is fully done before moving to next question
          if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
          feedbackTimerRef.current = window.setTimeout(() => {
            if (!anyUnresolved(statusAfter, letters)) {
              endTurn("🎉 ¡Perfecto! Has terminado todas las letras.");
              return;
            }
            const nextIdx = nextUnresolvedIndex(letters, statusAfter, idx);
            if (nextIdx === -1) {
              endTurn("🎉 ¡Perfecto! Has terminado todas las letras.");
              return;
            }
            setCurrentIndex(nextIdx);
          }, 200); // Small buffer to ensure audio buffer finishes (polling already waits 300ms)
        });
      }, 120);
    });
  }

  function markWrong() {
    if (phaseRef.current !== "playing") return;

    // Use refs to get current values (avoids stale closures from persistent recognizer)
    const letter = currentLetterRef.current;
    const idx = currentIndexRef.current;
    const status = statusByLetterRef.current;
    const currentSession = sessionRef.current;
    const states = playerStatesRef.current;

    // Get the correct answer before any state changes
    const correctAnswer = currentQARef.current.answer;

    unlockAudioOnce();
    
    // Check if this is effectively single-player mode:
    // - Actually single player, OR
    // - Only one player left with time remaining
    const isSinglePlayer = !currentSession || currentSession.players.length <= 1;
    const playersWithTime = currentSession ? countPlayersWithTimeLeft(currentSession, states) : 1;
    const isLastPlayerStanding = playersWithTime <= 1;
    const shouldContinuePlaying = isSinglePlayer || isLastPlayerStanding;
    
    // Disarm to prevent picking up stray audio during feedback
    disarmListening();
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setFeedback("wrong");
    setRevealed(true);

    setStatusByLetter((prev) => {
      const next = { ...prev };
      next[letter] = "wrong";
      return next;
    });

    // Track which letter was marked wrong (for override button)
    setLastWrongLetter(letter);

    // Calculate next index
    const statusAfter = { ...status, [letter]: "wrong" as LetterStatus };
    const nextIdx = nextUnresolvedIndex(letters, statusAfter, idx);

    // Play SFX first, then speak the correct answer.
    void ensureSfxReady().then(() => {
      playSfx("wrong");
      window.setTimeout(() => {
        // On mobile, always try to resume audio context before speaking (required for TTS on iOS/mobile)
        const ctx = getAudioCtx();
        if (ctx && ctx.state !== "running") {
          void ctx.resume().catch(() => {});
        }
        speakWithCallback(`No. La respuesta correcta es: ${correctAnswer}`, () => {
          // Speech has finished according to polling, but add a small buffer
          // to ensure audio buffer is fully done before moving to next question
          if (shouldContinuePlaying) {
            // Single player or last player standing: continue to next question
            if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
            feedbackTimerRef.current = window.setTimeout(() => {
              if (nextIdx === -1 || !anyUnresolved(statusAfter, letters)) {
                // No more questions - game ends
                setGameOver(true);
                setGameOverMessage("🎮 Fin del juego.");
                endTurn("");
              } else {
                // Continue to next question - audio buffer is fully finished now
                // The effect at line 1610 will automatically read the question when currentIndex changes
                setCurrentIndex(nextIdx);
                setRevealed(false);
                setFeedback(null);
                setLastWrongLetter(null);
              }
            }, 300); // Small buffer to ensure audio buffer finishes (polling already waits 300ms)
          } else {
            // Multiplayer with multiple players remaining: end the turn
            if (nextIdx !== -1) setCurrentIndex(nextIdx);
            endTurn("");
          }
        });
      }, 120);
    });
  }

  // Override a wrong answer to correct (when speech recognizer made a mistake)
  function overrideToCorrect() {
    if (!lastWrongLetter) return;
    
    const letter = lastWrongLetter;
    
    // Use refs to get current values (avoids stale closures)
    const status = statusByLetterRef.current;
    
    // Get the index of the letter that was marked wrong (not the current index,
    // which may have already been moved forward in markWrong for multiplayer)
    const wrongLetterIdx = letters.indexOf(letter);
    if (wrongLetterIdx === -1) return; // Safety check
    
    // Stop any current speaking (e.g., "No. La respuesta correcta es: ...")
    stopSpeaking();
    
    // Clear any existing feedback timer
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    
    // Play the correct sound, then speak "Sí"
    void ensureSfxReady().then(() => {
      playSfx("correct");
      window.setTimeout(() => {
        speakWithCallback("Sí", () => {
          // no-op
        });
      }, 120);
    });
    
    // Update status to correct
    const statusAfter = { ...status, [letter]: "correct" as LetterStatus };
    setStatusByLetter((prev) => {
      const next = { ...prev };
      next[letter] = "correct";
      return next;
    });
    
    // Trigger particle animation
    setRecentlyCorrectLetter(letter);
    setTimeout(() => setRecentlyCorrectLetter(null), 1200);
    
    // Clear the override state
    setLastWrongLetter(null);
    
    // Clear feedback and revealed states
    setFeedback(null);
    setRevealed(false);
    setTurnMessage("");
    
    // Pause so "Sí" + sound are fully perceivable before next question starts.
    // This matches the behavior in markCorrect (650ms delay)
    feedbackTimerRef.current = window.setTimeout(() => {
      // Check if there are more questions to answer
      if (!anyUnresolved(statusAfter, letters)) {
        // No more questions - end the turn
        endTurn("🎉 ¡Perfecto! Has terminado todas las letras.");
        return;
      }
      
      // Find the next unresolved question starting from the letter that was just corrected
      // (This matches the behavior in markCorrect where we start from the current letter)
      const nextIdx = nextUnresolvedIndex(letters, statusAfter, wrongLetterIdx);
      if (nextIdx === -1) {
        // No next question found - end the turn
        endTurn("🎉 ¡Perfecto! Has terminado todas las letras.");
        return;
      }
      
      // Resume the turn: continue playing with the next question
      // The effect at line 1554 will automatically read the question and start listening
      // when currentIndex changes and phase is "playing"
      setPhase("playing");
      setCurrentIndex(nextIdx);
    }, 650);
  }

  function submitAnswer(spokenOverride?: string) {
    if (phaseRef.current !== "playing") return;
    const spoken = (spokenOverride ?? answerText).trim();
    if (!spoken) return;

    // Use ref to get the CURRENT answer (avoids stale closure when recognizer persists across questions)
    const expectedAnswer = currentQARef.current.answer;
    
    // markCorrect/markWrong will handle disarming the mic
    if (isAnswerCorrect(spoken, expectedAnswer)) {
      markCorrect();
    } else {
      markWrong();
    }
  }

  // Keep submitAnswerRef updated so callbacks always use the latest version
  submitAnswerRef.current = submitAnswer;

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
      {/* Confetti goats when game ends */}
      {confettiGoats.map((goat) => (
        <div
          key={goat.id}
          className="goatConfetti"
          style={{
            left: `${goat.left}%`,
            animationDelay: `${goat.delay}s`,
          }}
          aria-hidden="true"
        >
          🐐
        </div>
      ))}

      {/* Snapshot slideshow overlay when game ends */}
      {slideshowActive && playerSnapshots.length > 0 && (() => {
        // Calculate winner(s) from snapshots
        const maxCorrect = Math.max(...playerSnapshots.map(s => s.correctCount));
        const topPlayers = playerSnapshots.filter(s => s.correctCount === maxCorrect);
        const minWrong = Math.min(...topPlayers.map(s => s.wrongCount));
        const winnerIds = new Set(
          topPlayers.filter(s => s.wrongCount === minWrong).map(s => s.playerId)
        );
        
        return (
          <div className="slideshowOverlay">
            <button 
              className="slideshowCloseBtn" 
              onClick={closeSlideshow}
              aria-label="Cerrar presentación"
              style={{ position: "absolute", top: 20, right: 20, zIndex: 10 }}
            >
              ✕
            </button>
            <div className="slideshowContent">
              {playerSnapshots.map((snapshot, idx) => {
                const isWinner = winnerIds.has(snapshot.playerId);
                return (
                  <div
                    key={snapshot.playerId}
                    data-slide-id={snapshot.playerId}
                    className={`slideshowSlide ${idx === slideshowIndex ? "slideshowSlideActive" : ""}`}
                  >
                    <img
                      src={snapshot.blobUrl}
                      alt={`Snapshot de ${snapshot.playerName}`}
                      className="slideshowImage"
                      onError={(e) => {
                        console.error("Failed to load snapshot image:", snapshot.playerName, snapshot.blobUrl);
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                      onLoad={() => {
                        console.log("Snapshot image loaded:", snapshot.playerName);
                      }}
                    />
                    <div className="slideshowCaption">
                      {isWinner && (
                        <div className="slideshowWinnerBadge">🏆 ¡Ganador!</div>
                      )}
                      <div className="slideshowPlayerName">{snapshot.playerName}</div>
                      <div className="slideshowScore">
                        <span className="slideshowCorrect">✓ {snapshot.correctCount}</span>
                        <span className="slideshowWrong">✗ {snapshot.wrongCount}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="slideshowProgress">
                {playerSnapshots.map((_, idx) => (
                  <div
                    key={idx}
                    className={`slideshowDot ${idx === slideshowIndex ? "slideshowDotActive" : ""} ${idx < slideshowIndex ? "slideshowDotPast" : ""}`}
                  />
                ))}
              </div>
            </div>
            
            {/* Share and Download buttons - below slideshow content */}
            <div style={{ 
              marginTop: 120,
              display: "flex",
              justifyContent: "center",
              gap: 16,
              width: "100%",
              flexWrap: "wrap"
            }}>
              {isRecording ? (
                <div style={{ color: "white", padding: "14px 28px" }}>🔴 Grabando...</div>
              ) : recording ? (
                <>
                  <button className="slideshowShareBtn" onClick={shareRecording}>
                    📤 Compartir fotos
                  </button>
                  <button
                    className="slideshowShareBtn"
                    onClick={downloadVideo}
                    style={{
                      background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                      boxShadow: "0 6px 25px rgba(34, 197, 94, 0.5)",
                    }}
                  >
                    💾 Descargar fotos
                  </button>
                  {session && session.players.length === 1 && playerSnapshots.length > 0 && (
                    <button
                      className="slideshowShareBtn"
                      onClick={handleShareEmojiSequence}
                      style={{
                        background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
                        boxShadow: "0 6px 25px rgba(139, 92, 246, 0.5)",
                      }}
                    >
                      📱 Compartir rueda
                    </button>
                  )}
                  <div
                    style={{
                      width: "100%",
                      textAlign: "center",
                      marginTop: 8,
                      fontSize: 13,
                      color: "rgba(255,255,255,0.75)",
                      lineHeight: 1.35,
                    }}
                  >
                    Formato: <strong>{recording.ext.toUpperCase()}</strong>
                    {" "}· {Math.round(recording.blob.size / 1024)} KB
                    <br />
                    En Mac, normalmente funciona mejor <strong>descargando</strong> y adjuntando el archivo (no copiar/pegar).
                  </div>
                </>
              ) : (
                <>
                  <button className="slideshowShareBtn" onClick={grabarYCompartir}>
                    🎥 Grabar y compartir
                  </button>
                  {session && session.players.length === 1 && playerSnapshots.length > 0 && (
                    <button
                      className="slideshowShareBtn"
                      onClick={handleShareEmojiSequence}
                      style={{
                        background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
                        boxShadow: "0 6px 25px rgba(139, 92, 246, 0.5)",
                      }}
                    >
                      📱 Compartir rueda
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {screen === "home" ? (
        <HomePage 
          onPlayGroup={() => setScreen("setup")}
          onPlay={startDailyGame}
          onHowToPlay={() => {
            // TODO: Show how to play modal/drawer
            console.log("Como Jugar");
          }}
          onAbout={() => {
            // TODO: Show about modal/drawer
            console.log("About");
          }}
        />
      ) : (
        <div className="overlay">
          <div className="topBar">
            {screen === "game" ? (
              <>
                <div className="playerTag">{currentPlayerLabel}</div>
                <div className="timerBig">{formatTime(timeLeft)}</div>
              </>
            ) : (
              <div className="setupTopTitle"></div>
            )}
          </div>

          {screen === "setup" ? (
            <GameDetails
              setupPlayerCount={setupPlayerCount}
              setSetupPlayerCount={setSetupPlayerCount}
              difficultyMode={difficultyMode}
              setDifficultyMode={setDifficultyMode}
              setupPlayers={setupPlayers}
              setSetupPlayers={setSetupPlayers}
              selectedTopics={selectedTopics}
              setSelectedTopics={setSelectedTopics}
              topicSelectionError={topicSelectionError}
              setTopicSelectionError={setTopicSelectionError}
              testMode={testMode}
              setTestMode={setTestMode}
              sttPreflightChecking={sttPreflightChecking}
              sttError={sttError}
              cameraError={cameraError}
              onStart={startFromSetup}
              onBack={() => setScreen("home")}
            />
          ) : (
<div className="center">
          {/* Hidden canvas for video recording */}
          <canvas
            ref={canvasRef}
            width={800}
            height={800}
            style={{
              position: "fixed",
              left: "-99999px",
              top: 0,
              width: 800,
              height: 800,
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          
          <div className="ringAndControls">
            <div className="ringWrap">
              <video
                ref={videoRef}
                className="cameraInRing"
                muted
                playsInline
                autoPlay
              />
              <LetterRing 
                letters={letters} 
                statusByLetter={statusByLetter}
                recentlyCorrect={recentlyCorrectLetter}
                currentIndex={currentIndex}
              />
            </div>

              <div className="controls">
              {phase === "idle" ? (
                  <button className="btnPrimary" onClick={startTurn} disabled={timeLeft <= 0 || !isListening}>
                    Empezar
                  </button>
              ) : phase === "playing" ? (
                  <button 
                    className="btnPrimary" 
                    onClick={handlePasalacabra} 
                    disabled={!(hasCompletedFirstRound && earlySkipAllowed) && !questionRead}
                  >
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
                            ? isListening && questionRead
                              ? "Escuchando…"
                              : ""
                            : "Tu navegador no soporta reconocimiento de voz: prueba a usar otro buscador"
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
                          {sttSupported ? (isListening && questionRead ? "Escuchando…" : "Micrófono listo") : "Intenta jugar con otro navegador"}
                        </div>
                      ) : null}
                      {feedback === "wrong" || revealed ? (
                        <div className="answerReveal answerRevealBig" style={{ marginTop: 8 }}>
                          Respuesta: <strong>{currentQA.answer}</strong>
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
                  {gameOver && session ? (
                    (() => {
                      const { winners, allScores } = determineWinners(session, playerStates);
                      const isTie = winners.length > 1;
                      const isSinglePlayer = session.players.length === 1;
                      return (
                        <div className="gameOverResults" style={{ marginTop: 8 }}>
                          <div className="answerReveal answerRevealBig" style={{ marginBottom: 12 }}>
                            <strong>🎮 Fin del juego!</strong>
                          </div>
                          
                          {!isSinglePlayer && (
                            <div className="winnerAnnouncement" style={{ marginBottom: 16 }}>
                              {isTie ? (
                                <div className="answerReveal answerRevealBig">
                                  🏆 ¡Empate! Ganadores: {winners.map(w => w.player.name).join(" y ")}
                                </div>
                              ) : (
                                <div className="answerReveal answerRevealBig">
                                  🏆 ¡Ganador: {winners[0].player.name}!
                                </div>
                              )}
                            </div>
                          )}
                          
                          <div className="scoresTable" style={{ textAlign: "left" }}>
                            {allScores.map((s, i) => (
                              <div 
                                key={s.player.id} 
                                className="answerReveal" 
                                style={{ 
                                  marginBottom: 4,
                                  fontWeight: winners.some(w => w.player.id === s.player.id) ? "bold" : "normal"
                                }}
                              >
                                {i + 1}. {s.player.name}: {s.correct} ✓ / {s.wrong} ✗
                              </div>
                            ))}
                          </div>
                          
                          {playerSnapshots.length > 0 && (
                            <button 
                              className="btnOutline" 
                              type="button" 
                              onClick={replaySlideshow}
                              style={{ marginTop: 20, width: "100%" }}
                            >
                              📸 Ver fotos
                            </button>
                          )}
                        </div>
                      );
                    })()
                  ) : gameOver ? (
                    <div className="answerReveal answerRevealBig" style={{ marginTop: 2 }}>
                      <strong>{gameOverMessage || "Fin del juego."}</strong>
                    </div>
                  ) : (
                    <>
                      <button className="btnPrimary" type="button" onClick={startNextPlayerTurn}>
                        {nextPlayerButtonLabel}
                      </button>
                      {lastWrongLetter && (
                        <button 
                          className="btnOutline" 
                          type="button" 
                          onClick={overrideToCorrect}
                          style={{ marginTop: 12 }}
                        >
                          Oye! La respuesta era correcta
                        </button>
                      )}
                    </>
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
      )}
    </div>
  );
}
