// src/game/canvasShare.ts
export async function recordCanvasFor(
  canvas: HTMLCanvasElement,
  seconds: number,
  fps = 20
): Promise<{ blob: Blob; mimeType: string; ext: "mp4" | "webm" }> {
  const stream = canvas.captureStream(fps);

  const MR = (window as any).MediaRecorder;
  const pick = () => {
    if (!MR?.isTypeSupported) return "";
    const cands = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    return cands.find((t) => MR.isTypeSupported(t)) ?? "";
  };

  const mimeType = pick();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];

  rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);

  const done = new Promise<{ blob: Blob; mimeType: string; ext: "mp4" | "webm" }>((resolve, reject) => {
    rec.onerror = (ev: Event) => reject((ev as any)?.error ?? new Error("MediaRecorder error"));
    rec.onstop = () => {
      const finalMime = rec.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunks, { type: finalMime });
      resolve({ blob, mimeType: finalMime, ext: finalMime.includes("mp4") ? "mp4" : "webm" });
    };
  });

  rec.start(250);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  rec.stop();

  return done;
}

export async function shareBlobAsFile(blob: Blob, mimeType: string, filename: string) {
  const file = new File([blob], filename, { type: mimeType });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: "Pasalacabra", files: [file] });
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}