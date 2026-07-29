export type ExportQuality = 'hd' | '2k' | '4k';

/** Long-edge target pixels and matching video bitrate per quality preset */
const QUALITY_PRESETS: Record<ExportQuality, { longEdge: number; bps: number }> = {
  hd:   { longEdge: 1920, bps: 8_000_000  },
  '2k': { longEdge: 2560, bps: 18_000_000 },
  '4k': { longEdge: 3840, bps: 40_000_000 },
};

/** Scale (w, h) so the long edge equals targetLongEdge; ensure even pixel dimensions. */
function scaleToLongEdge(w: number, h: number, targetLongEdge: number): [number, number] {
  const scale = targetLongEdge / Math.max(w, h);
  return [Math.round((w * scale) / 2) * 2, Math.round((h * scale) / 2) * 2];
}

export interface VideoExportOptions {
  quality?: ExportQuality;
  signal?: AbortSignal;
}

/**
 * Re-encode a video at a target quality/resolution in the browser.
 *
 * Pipeline per frame
 *   video → outCanvas (target res) → MediaRecorder
 *
 * Audio is captured via WebAudio MediaElementSource → MediaStreamDestination.
 * Everything is muxed by MediaRecorder into the best available container (MP4 or WebM).
 */
export async function reencodeVideoUrl(
  videoUrl: string,
  onProgress: (pct: number) => void,
  { quality = 'hd', signal }: VideoExportOptions = {},
): Promise<{ blob: Blob; mimeType: string }> {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
    throw new Error(
      'requestVideoFrameCallback is not supported. Please use Chrome 83+ or Edge 83+.',
    );
  }

  // ── 1. Load video ────────────────────────────────────────────────
  const video = document.createElement('video');
  // Do NOT set crossOrigin — the video URL is same-origin (Vite proxy). Setting it
  // taints the canvas and blocks drawImage.
  // Do NOT set muted=true before playback — Chrome skips audio decoding for muted
  // elements, causing WebAudio to receive silence. WebAudio takes over audio routing
  // via createMediaElementSource, so speaker output is already suppressed.
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
  document.body.appendChild(video);

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
      video.src = videoUrl;
    });

    const { videoWidth: srcW, videoHeight: srcH, duration } = video;
    if (!srcW || !srcH || !duration) throw new Error('Invalid video (missing dimensions or duration)');

    // ── 2. Resolve output dimensions ──────────────────────────────────
    const { longEdge, bps } = QUALITY_PRESETS[quality];
    const [outW, outH] = scaleToLongEdge(srcW, srcH, longEdge);

    // ── 3. Output canvas — MediaRecorder captures this ────────────────
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d')!;

    // ── 4. WebAudio: re-route audio through graph (no speaker output) ─
    const audioCtx = new AudioContext();
    const audioSrc = audioCtx.createMediaElementSource(video);
    const audioDest = audioCtx.createMediaStreamDestination();
    audioSrc.connect(audioDest);

    // ── 5. MediaRecorder ──────────────────────────────────────────────
    const mimeType = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

    const combined = new MediaStream([
      ...outCanvas.captureStream(30).getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: bps });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    if (signal?.aborted) throw new Error('Aborted');

    // ── 6. Frame-by-frame loop ────────────────────────────────────────
    return new Promise<{ blob: Blob; mimeType: string }>((resolve, reject) => {
      let ended = false;
      let safetyTimer: ReturnType<typeof setTimeout>;

      const stop = () => {
        if (ended) return;
        ended = true;
        clearTimeout(safetyTimer);
        try { recorder.stop(); } catch { /* already stopped */ }
        video.pause();
      };

      recorder.onstop = () => {
        audioCtx.close();
        resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
      };

      signal?.addEventListener('abort', () => { stop(); reject(new Error('Aborted')); });

      video.addEventListener('ended', stop, { once: true });

      // Safety net: hard stop after duration + 15s to prevent infinite hang.
      safetyTimer = setTimeout(stop, (duration + 15) * 1000);

      const processFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (ended) return;
        if (signal?.aborted) { stop(); return; }

        outCtx.drawImage(video, 0, 0, outW, outH);

        const pct = Math.min(meta.mediaTime / duration, 1);
        onProgress(pct);

        if (pct >= 0.95 || meta.mediaTime >= duration - 0.5) {
          stop();
        } else {
          video.requestVideoFrameCallback(processFrame);
        }
      };

      recorder.start(200);
      video.currentTime = 0;
      video.addEventListener(
        'seeked',
        () => {
          video.requestVideoFrameCallback(processFrame);
          video.play().catch(reject);
        },
        { once: true },
      );
    });
  } finally {
    document.body.removeChild(video);
  }
}
