// src/game/canvasRecorder.ts

export type CanvasRecording = {
  blob: Blob;
  url: string;
  mimeType: string;
  ext: "mp4" | "webm";
};

function pickMimeType(): string | undefined {
  const MR = (window as any).MediaRecorder;
  if (!MR?.isTypeSupported) return undefined;

  const candidates = [
    // Si algún browser soporta MP4/H264, genial (mucho mejor para compartir).
    // OJO: muchos Chrome/Firefox NO soportan MediaRecorder -> MP4.
    // Safari tends to recognize the avc1/mp4a codec string better than "h264".
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs="avc1.42E01E"',
    "video/mp4;codecs=h264",
    "video/mp4",

    // WebM suele ser lo más compatible en desktop browsers
    "video/webm;codecs=vp8",
    "video/webm",
    // VP9 is often less compatible with sharing targets (e.g. WhatsApp previews)
    "video/webm;codecs=vp9",
  ];

  return candidates.find((t) => MR.isTypeSupported(t));
}

function extFromMime(mime: string): "mp4" | "webm" {
  return mime.includes("mp4") ? "mp4" : "webm";
}

export function downloadRecording(recording: CanvasRecording, filenameBase = "pasalacabra") {
  const a = document.createElement("a");
  a.href = recording.url;
  a.download = `${filenameBase}.${recording.ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function createCanvasRecorder(canvas: HTMLCanvasElement, fps = 20) {
  const stream = canvas.captureStream(fps);
  const mimeType = pickMimeType(); // undefined => que el browser elija
  const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  const chunks: BlobPart[] = [];
  let pumpTimer: number | null = null;

  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // (Opcional) asegurar que al menos un frame haya pasado antes de empezar
  async function start(timesliceMs = 500) {
    chunks.length = 0;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    rec.start(timesliceMs);

    // Safari can fail to emit chunks unless we periodically flush.
    // This also helps reduce "0-byte" or unplayable files.
    if (pumpTimer) window.clearInterval(pumpTimer);
    pumpTimer = window.setInterval(() => {
      try {
        rec.requestData?.();
      } catch {
        // ignore
      }
    }, 500);
  }

  function stop(): Promise<CanvasRecording> {
    return new Promise((resolve, reject) => {
      const finalize = () => {
        if (pumpTimer) {
          window.clearInterval(pumpTimer);
          pumpTimer = null;
        }

        const finalMime = rec.mimeType || mimeType || "video/webm";
        const blob = new Blob(chunks, { type: finalMime });

        // Si grabaste “negro”, a veces es que no entró ningún chunk.
        // Esto te ayuda a detectarlo rápido.
        if (!blob.size) {
          // Aun así devolvemos algo, pero lo normal es que aquí haya un bug en el dibujo/tiempos.
          console.warn("[canvasRecorder] blob.size = 0 (no data recorded)");
        }

        const url = URL.createObjectURL(blob);
        const ext = extFromMime(finalMime);

        // Liberar tracks del stream
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }

        resolve({ blob, url, mimeType: finalMime, ext });
      };

      rec.onstop = finalize;

      rec.onerror = (ev: Event) => {
        const anyEv = ev as any;
        reject(anyEv?.error ?? new Error("MediaRecorder error"));
      };

      try {
        // Pedir el último trozo antes de parar (mejora “último frame”/flush)
        rec.requestData?.();
      } catch {
        // ignore
      }

      try {
        rec.stop();
      } catch (e) {
        reject(e);
      }
    });
  }

  return { rec, start, stop };
}

export async function shareOrDownloadRecording(
  recording: CanvasRecording,
  filenameBase = "pasalacabra"
) {
  const file = new File([recording.blob], `${filenameBase}.${recording.ext}`, {
    type: recording.mimeType,
  });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: "Pasalacabra",
      text: "¡Mira mis resultados!",
      files: [file],
    });
    return;
  }

  // fallback: download (ideal para desktop)
  downloadRecording(recording, filenameBase);
}