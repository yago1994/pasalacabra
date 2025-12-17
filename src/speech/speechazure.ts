import * as sdk from "microsoft-cognitiveservices-speech-sdk";

export async function createAzureRecognizer() {
  const { token, region } = await (
    await fetch(import.meta.env.VITE_SPEECH_TOKEN_URL)
  ).json();

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = "es-ES";

  const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  return new sdk.SpeechRecognizer(speechConfig, audioConfig);
}

export function setPhraseHints(
  phraseList: sdk.PhraseListGrammar,
  phrases: string[],
  weight = 0.8
) {
  phraseList.clear();
  phrases.forEach((p) => phraseList.addPhrase(p));
  phraseList.setWeight?.(weight);
}

export function recognizeOnceFast(
  recognizer: sdk.SpeechRecognizer,
  onPartial: (t: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    recognizer.recognizing = (_s, e) => onPartial(e.result.text ?? "");
    recognizer.recognizeOnceAsync(
      (r) => resolve(r.text ?? ""),
      (err) => reject(err)
    );
  });
}
