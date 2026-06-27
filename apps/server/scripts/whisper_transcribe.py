"""Whisper transcription wrapper that injects ffmpeg into PATH before running."""
import sys
import os
import json

def main():
    # Args: audio_path, output_dir, model, language, ffmpeg_dir
    if len(sys.argv) < 5:
        print(json.dumps({"error": "Usage: whisper_transcribe.py <audio> <output_dir> <model> <language> [ffmpeg_dir]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    output_dir = sys.argv[2]
    model_name = sys.argv[3]
    language = sys.argv[4]
    ffmpeg_dir = sys.argv[5] if len(sys.argv) > 5 else None

    # Inject ffmpeg into PATH before whisper imports it
    if ffmpeg_dir and os.path.isdir(ffmpeg_dir):
        os.environ['PATH'] = ffmpeg_dir + os.pathsep + os.environ.get('PATH', '')

    import whisper

    print(json.dumps({"progress": True, "step": "load_model", "detail": f"Loading whisper model '{model_name}'..."}), flush=True)
    model = whisper.load_model(model_name, device="cpu")

    print(json.dumps({"progress": True, "step": "transcribe", "detail": "Transcribing audio..."}), flush=True)
    result = model.transcribe(audio_path, language=language, fp16=False)

    # Write SRT
    os.makedirs(output_dir, exist_ok=True)
    audio_base = os.path.splitext(os.path.basename(audio_path))[0]
    srt_path = os.path.join(output_dir, audio_base + ".srt")

    segments = result.get("segments", [])
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(segments, 1):
            start = format_ts(seg["start"])
            end = format_ts(seg["end"])
            text = seg["text"].strip()
            f.write(f"{i}\n{start} --> {end}\n{text}\n\n")

    print(json.dumps({
        "done": True,
        "srt_path": srt_path,
        "segments": len(segments),
        "text": result.get("text", ""),
    }), flush=True)


def format_ts(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


if __name__ == "__main__":
    main()
