// src/game/snapshotComposer.ts

export type LetterStatus = "idle" | "correct" | "wrong" | "passed";

export type StatusByLetter = Record<string, LetterStatus | undefined>;

export type SnapshotFit = "cover" | "contain";

export interface RingStyle {
  ringStroke?: string;
  ringStrokeWidth?: number;

  letterFont?: string; // e.g. "700 18px system-ui"
  letterColor?: string;

  dotRadius?: number;
  dotStrokeWidth?: number;
  dotStroke?: string;

  statusFill?: Partial<Record<LetterStatus, string>>; // CSS colors
  idleFill?: string;
  
  // Background color (the blue game background)
  backgroundColor?: string;
}

export interface RingOptions {
  letters: string[];
  statusByLetter?: StatusByLetter;
  currentIndex?: number; // For positioning the goat

  // Ring geometry (relative to output canvas)
  centerX?: number; // default: w/2
  centerY?: number; // default: h/2
  radius?: number;  // default: min(w,h)*0.38
  dotRadius?: number; // default: style.dotRadius or min(w,h)*0.045

  // Start angle places letter[0] at top by default
  startAngleRad?: number; // default: -Math.PI/2
  clockwise?: boolean;     // default: true

  style?: RingStyle;
}

export interface SnapshotOptions {
  outWidth?: number;  // default: video.videoWidth
  outHeight?: number; // default: video.videoHeight
  fit?: SnapshotFit;  // default: "cover"
  ring: RingOptions;

  // Export
  mimeType?: "image/webp" | "image/png" | "image/jpeg";
  quality?: number; // for webp/jpeg
}

/**
 * Check if video has actual frame data by trying to draw it to a test canvas.
 * Returns true if we can draw non-black pixels from the video.
 */
function hasVideoFrameData(video: HTMLVideoElement): boolean {
  if (video.videoWidth === 0 || video.videoHeight === 0) return false;
  if (video.readyState < 2) return false;
  
  try {
    // Try to draw a small area from the center of the video
    const testCanvas = document.createElement("canvas");
    testCanvas.width = 8;
    testCanvas.height = 8;
    const testCtx = testCanvas.getContext("2d");
    if (!testCtx) return false;
    
    // Sample from center of video (more likely to have content)
    const sx = video.videoWidth / 2 - 4;
    const sy = video.videoHeight / 2 - 4;
    testCtx.drawImage(video, sx, sy, 8, 8, 0, 0, 8, 8);
    const pixels = testCtx.getImageData(0, 0, 8, 8).data;
    
    // Check if we have any non-black, non-transparent pixels
    // This helps detect if we have actual camera content vs blank frame
    let hasContent = false;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      
      // If we have any pixel that's not fully transparent and not pure black
      if (a > 0 && (r > 10 || g > 10 || b > 10)) {
        hasContent = true;
        break;
      }
    }
    
    return hasContent;
  } catch (e) {
    console.warn("hasVideoFrameData check failed:", e);
    return false;
  }
}

/**
 * Wait until the <video> has dimensions and actual frame data available.
 * This is important for the first capture - we need to wait for the camera
 * to actually render a frame, not just report dimensions.
 */
export async function waitForVideoReady(video: HTMLVideoElement, timeoutMs = 5000) {
  console.log("[waitForVideoReady] Starting, videoWidth:", video.videoWidth, "readyState:", video.readyState);
  
  const startTime = Date.now();
  let hasLoggedWaiting = false;
  
  // Poll until video has actual frame data
  while (Date.now() - startTime < timeoutMs) {
    // Check if we have actual video frame content
    if (hasVideoFrameData(video)) {
      console.log("[waitForVideoReady] Video has frame data after", Date.now() - startTime, "ms");
      // Additional delay to ensure frame is stable
      await new Promise(resolve => setTimeout(resolve, 150));
      return;
    }
    
    if (!hasLoggedWaiting && Date.now() - startTime > 500) {
      console.log("[waitForVideoReady] Still waiting for video frame data...");
      hasLoggedWaiting = true;
    }
    
    // Wait before checking again
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Timeout - if we have dimensions, proceed anyway but log warning
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    console.warn("[waitForVideoReady] Timeout after", timeoutMs, "ms, proceeding with available data");
    // Give one more delay
    await new Promise(resolve => setTimeout(resolve, 200));
    return;
  }
  
  throw new Error("Video not ready (no dimensions after " + timeoutMs + "ms). Did metadata load?");
}

/**
 * Main entry: capture a composite snapshot with the full game UI
 * (blue background, circular video, letter ring, goat emoji).
 * 
 * Uses the same proportions as the game:
 * - Ring radius: 178 / 400 = 0.445 of canvas size
 * - Node radius: 18 / 400 = 0.045 of canvas size
 * - Video fits inside the ring (ringR * 0.89 from CSS: width: 89%)
 */
export async function captureSnapshotWithRing(
  video: HTMLVideoElement,
  opts: SnapshotOptions
): Promise<Blob> {
  await waitForVideoReady(video);

  const outW = opts.outWidth ?? video.videoWidth;
  const outH = opts.outHeight ?? video.videoHeight;
  const size = Math.min(outW, outH);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas not available");

  const style = withDefaultStyle(opts.ring.style);

  // Use exact same ratios as LetterRing.tsx, with 20% size reduction
  const SIZE_SCALE = 0.80;
  const RING_RATIO = (178 / 400) * SIZE_SCALE;
  const NODE_RATIO = (18 / 400) * SIZE_SCALE;

  // 1) Draw background color (the blue game background)
  ctx.fillStyle = style.backgroundColor!;
  ctx.fillRect(0, 0, outW, outH);

  // 2) Draw the video frame in a circular clip (like the game)
  const cx = opts.ring.centerX ?? outW / 2;
  const cy = opts.ring.centerY ?? outH / 2;
  const ringRadius = opts.ring.radius ?? size * RING_RATIO;
  const dotR = opts.ring.dotRadius ?? (style.dotRadius && style.dotRadius > 0 ? style.dotRadius : size * NODE_RATIO);
  
  // Video circle should intersect the middle of the bubbles (at ringRadius)
  // This matches the game UI where the camera circle goes through the center of the letter bubbles
  const videoCircleRadius = ringRadius;
  
  drawCircularVideo(ctx, video, cx, cy, videoCircleRadius);

  // 3) Draw ring overlay (letters in circles)
  drawRing(ctx, outW, outH, opts.ring);

  // 4) Export
  const mime = opts.mimeType ?? "image/webp";
  const quality = opts.quality ?? 0.92;

  const blob = await canvasToBlob(canvas, mime, quality);
  return blob;
}

/**
 * Convenience: returns a blob URL you can use directly in <img src="...">
 */
export async function captureSnapshotUrlWithRing(
  video: HTMLVideoElement,
  opts: SnapshotOptions
): Promise<string> {
  const blob = await captureSnapshotWithRing(video, opts);
  return URL.createObjectURL(blob);
}

/* ---------------------------- Drawing helpers ---------------------------- */

/**
 * Draw the video inside a circular clip, scaled and mirrored like the game UI.
 */
function drawCircularVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  cx: number,
  cy: number,
  radius: number
) {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  
  if (srcW === 0 || srcH === 0) return;

  ctx.save();
  
  // Create circular clip
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  
  // The game scales video by 1.7x and mirrors it horizontally (scaleX(-1))
  // We need to replicate this behavior
  const diameter = radius * 2;
  const scaleFactor = 1.7;
  const drawSize = diameter * scaleFactor;
  
  // Calculate source crop for "cover" fit
  const targetAspect = 1; // Circle is 1:1
  const srcAspect = srcW / srcH;
  
  let cropW: number, cropH: number, sx: number, sy: number;
  if (srcAspect > targetAspect) {
    // Video is wider - crop sides
    cropH = srcH;
    cropW = srcH * targetAspect;
    sx = (srcW - cropW) / 2;
    sy = 0;
  } else {
    // Video is taller - crop top/bottom
    cropW = srcW;
    cropH = srcW / targetAspect;
    sx = 0;
    sy = (srcH - cropH) / 2;
  }
  
  // Mirror horizontally (like scaleX(-1) in CSS)
  ctx.translate(cx, cy);
  ctx.scale(-1, 1);
  ctx.translate(-cx, -cy);
  
  // Draw the video centered and scaled
  const drawX = cx - drawSize / 2;
  const drawY = cy - drawSize / 2;
  
  ctx.drawImage(
    video,
    sx, sy, cropW, cropH,
    drawX, drawY, drawSize, drawSize
  );
  
  ctx.restore();
}

/**
 * Draw the letter ring matching the exact proportions from LetterRing.tsx:
 * - SVG size: 400x400
 * - Ring radius: 178 (ratio: 0.445)
 * - Node radius: 18 (ratio: 0.045)
 * - Emoji size: 56 (ratio: 0.14)
 * - Goat offset: nodeR + emojiSize/2 - 8
 * - Text y-offset: +6 in SVG coords
 */
export function drawRing(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ring: RingOptions
) {
  const style = withDefaultStyle(ring.style);
  const size = Math.min(w, h);
  
  // Use exact same ratios as LetterRing.tsx (based on 400x400 SVG)
  // ringR = 178, nodeR = 18, emojiSize = 56 in a 400x400 space
  // Apply 20% size reduction for snapshot
  const SIZE_SCALE = 0.80; // 20% smaller
  const RING_RATIO = (178 / 400) * SIZE_SCALE;   // 0.356
  const NODE_RATIO = (18 / 400) * SIZE_SCALE;    // 0.036
  const EMOJI_RATIO = (56 / 400) * SIZE_SCALE;   // 0.112
  // Move letters up 4px for better centering (in 800px canvas, -2/400 = -4px)
  const TEXT_OFFSET_RATIO = -2 / 400;

  const cx = ring.centerX ?? w / 2;
  const cy = ring.centerY ?? h / 2;
  const radius = ring.radius ?? size * RING_RATIO;
  // Calculate dotR: use provided value, or calculate from canvas size (18/400 ratio)
  const dotR = ring.dotRadius ?? (style.dotRadius && style.dotRadius > 0 ? style.dotRadius : size * NODE_RATIO);
  const emojiSize = size * EMOJI_RATIO;
  const textYOffset = size * TEXT_OFFSET_RATIO;

  const letters = ring.letters;
  
  console.log("[drawRing] size:", size, "radius:", radius, "dotR:", dotR, "letters:", letters.length);
  const step = (Math.PI * 2) / Math.max(letters.length, 1);
  const start = ring.startAngleRad ?? -Math.PI / 2;
  const dir = ring.clockwise === false ? -1 : 1;

  // draw letter dots
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i];
    const angle = start + dir * i * step;

    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    const status = ring.statusByLetter?.[letter] ?? "idle";
    const fill = statusFill(style, status);
    const isCurrent = ring.currentIndex !== undefined && i === ring.currentIndex;

    // Draw dark circle behind for contrast/shadow effect
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.beginPath();
    ctx.arc(x + 1, y + 2, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Draw the colored bubble fill
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Draw border/stroke (white for current, semi-transparent for others)
    ctx.save();
    ctx.strokeStyle = isCurrent ? "rgb(255,255,255)" : style.dotStroke!;
    ctx.lineWidth = style.dotStrokeWidth!;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Letter text (with y-offset like the game: y + 6)
    ctx.save();
    ctx.fillStyle = style.letterColor!;
    ctx.font = style.letterFont!;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, x, y + textYOffset);
    ctx.restore();
  }

  // Draw the goat emoji at the current letter position
  const currentIndex = ring.currentIndex;
  if (currentIndex !== undefined && currentIndex >= 0 && currentIndex < letters.length) {
    const currentAngle = start + dir * currentIndex * step;
    const currentX = cx + radius * Math.cos(currentAngle);
    const currentY = cy + radius * Math.sin(currentAngle);
    
    // Match game's goat positioning: goatOffset = nodeR + emojiRadius - 8
    // In 400x400: goatOffset = 18 + 28 - 8 = 38
    const emojiRadius = emojiSize / 2;
    const goatOffsetBase = 8 / 400 * size; // The -8 adjustment
    const goatOffset = dotR + emojiRadius - goatOffsetBase;
    const goatX = currentX + goatOffset * Math.cos(currentAngle);
    const goatY = currentY + goatOffset * Math.sin(currentAngle);
    
    // Calculate rotation (goat faces direction of movement)
    // From game: goatRotation = (currentAngle - Math.PI / 2) * 180 / Math.PI (in degrees)
    const goatRotation = currentAngle - Math.PI / 2;
    
    ctx.save();
    ctx.translate(goatX, goatY);
    ctx.rotate(goatRotation);
    ctx.scale(1, -1); // Flip vertically like the game's scale(1, -1)
    ctx.font = `${emojiSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🐐", 0, 0);
    ctx.restore();
  }
}

function withDefaultStyle(style?: RingStyle): Required<RingStyle> {
  return {
    ringStroke: style?.ringStroke ?? "rgba(255,255,255,0.7)",
    ringStrokeWidth: style?.ringStrokeWidth ?? 6,

    letterFont: style?.letterFont ?? "700 18px system-ui, -apple-system, Segoe UI, Roboto",
    letterColor: style?.letterColor ?? "rgba(255,255,255,0.98)",

    // Use undefined to signal "calculate from canvas size"
    dotRadius: style?.dotRadius,
    dotStrokeWidth: style?.dotStrokeWidth ?? 2,
    dotStroke: style?.dotStroke ?? "rgba(255,255,255,0.35)",

    statusFill: style?.statusFill ?? {},
    idleFill: style?.idleFill ?? "#4f8dff", // Match --letter-default
    
    // The blue game background color
    backgroundColor: style?.backgroundColor ?? "#4f8dff",
  } as Required<RingStyle>;
}

function statusFill(style: Required<RingStyle>, status: LetterStatus): string {
  const override = style.statusFill?.[status];
  if (override) return override;

  // Defaults matching the game's CSS variables
  switch (status) {
    case "correct":
      return "#2bb673"; // --letter-correct (green)
    case "wrong":
      return "#ff4d4d"; // --letter-wrong (red)
    case "passed":
      return "#4f8dff"; // --letter-passed (blue)
    case "idle":
    default:
      return style.idleFill;
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, quality)
  );
  if (!blob) throw new Error("Failed to export canvas to Blob");
  return blob;
}