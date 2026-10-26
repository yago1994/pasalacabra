/**
 * Dev-only stand-in for Azure + the microphone: `?fakestt` on a dev build.
 *
 * Lets the whole game run where there's no token or no usable mic (the Browser
 * pane, the iOS simulator): the "recognizer" connects instantly, and the
 * FakeSttPanel buttons feed it what it "heard", or break it on purpose
 * (speech outage, dead mic) to exercise the pause / retry / watchdog paths.
 * Never active in production builds.
 */
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { MicHealth } from "./PushAudioStreamManager";
import type { AzureRecognizerBundle } from "./createAzureRecognizer";
import { SpeechServiceError } from "../platform/micDiagnostics";

export const FAKE_STT: boolean =
  import.meta.env.DEV && new URLSearchParams(location.search).has("fakestt");

type Handler = ((s: unknown, e: unknown) => void) | undefined;
type FakeRecognizer = {
  recognizing: Handler;
  recognized: Handler;
  canceled: Handler;
  sessionStopped: Handler;
  startContinuousRecognitionAsync: (ok?: () => void, fail?: (e: string) => void) => void;
  stopContinuousRecognitionAsync: (ok?: () => void, fail?: (e: string) => void) => void;
  close: () => void;
};

let current: FakeRecognizer | null = null;
let sharedContext: AudioContext | null = null;
// One context for the fake "mic", like the real one, so ?audio=single works here too.
function fakeContext() {
  if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContext();
  return sharedContext;
}
let outage = false;
let micDead = false;

function log(...args: unknown[]) {
  console.log("[fakestt]", ...args);
}

export async function createFakeRecognizer(): Promise<AzureRecognizerBundle> {
  // Like a real token fetch that can't reach the worker.
  await new Promise((r) => setTimeout(r, 150));
  if (outage) throw new SpeechServiceError("fake outage (FakeSttPanel)");

  let gateOpen = false;
  let closed = false;
  const r: FakeRecognizer = {
    recognizing: undefined,
    recognized: undefined,
    canceled: undefined,
    sessionStopped: undefined,
    startContinuousRecognitionAsync: (ok) => {
      current = r;
      log("connected");
      setTimeout(() => ok?.(), 100);
    },
    stopContinuousRecognitionAsync: (ok) => {
      if (current === r) current = null;
      setTimeout(() => ok?.(), 0);
    },
    close: () => {
      closed = true;
      if (current === r) current = null;
    },
  };

  const health = (): MicHealth => ({
    msSinceStart: 60_000,
    contextState: "running",
    sampleRate: 48000,
    msSinceFrame: 0,
    msSinceSound: 0,
    trackState: micDead || closed ? "ended" : "live",
    trackMuted: false,
  });

  return {
    recognizer: r as unknown as sdk.SpeechRecognizer,
    getDb: () => -40,
    close: () => r.close(),
    stream: new MediaStream(),
    openGate: () => (gateOpen = true),
    closeGate: () => (gateOpen = false),
    isGateOpen: () => gateOpen,
    resume: async () => {},
    health,
    audioContext: fakeContext(),
  };
}

/** The recognizer "hears" `text` (a final result, like Azure's `recognized`). */
export function fakeSay(text: string) {
  if (!current) return log("say ignored: not connected");
  log("say", text);
  current.recognizing?.(null, { result: { text } });
  current.recognized?.(null, { result: { text, reason: sdk.ResultReason.RecognizedSpeech } });
}

/** Speech drops and stays down: the session cancels and reconnects fail until restored. */
export function fakeOutage() {
  outage = true;
  log("outage on");
  current?.canceled?.(null, {
    reason: sdk.CancellationReason.Error,
    errorCode: sdk.CancellationErrorCode.ConnectionFailure,
    errorDetails: "fake connection lost",
  });
}

/** The session drops once (a blip); reconnecting works. */
export function fakeBlip() {
  log("blip");
  current?.sessionStopped?.(null, {});
}

/** The mic track dies while Azure stays connected (the silent-mic case). */
export function fakeKillMic() {
  micDead = true;
  log("mic dead");
}

/** Everything works again. */
export function fakeRestore() {
  outage = false;
  micDead = false;
  log("restored");
}
