#!/usr/bin/env python3
"""
forced_align.py
Usage: python forced_align.py <audio_path> <text_path> <output_path> [--language en]

Performs forced alignment of known text against audio using stable-ts
(which builds on openai-whisper). This is NOT open transcription — it
aligns the provided text to the audio to produce word-level timestamps.

Output JSON:
  { "words": [{ "word": str, "offset_ms": int, "duration_ms": int }],
    "total_ms": int, "method": "stable-ts" }
"""
import sys
import json
import argparse


def main():
    parser = argparse.ArgumentParser(description="Forced alignment via stable-ts")
    parser.add_argument("audio_path", help="Path to the audio file (mp3/wav)")
    parser.add_argument("text_path", help="Path to a text file with the transcript")
    parser.add_argument("output_path", help="Path to write the output JSON")
    parser.add_argument("--language", default="en", help="Language code (default: en)")
    args = parser.parse_args()

    try:
        import stable_whisper
    except ImportError:
        err = {
            "error": "stable-ts not installed. Run: pip install stable-ts",
            "words": 0,
            "total_ms": 0,
        }
        print(json.dumps(err))
        sys.exit(1)

    # Read the transcript text
    with open(args.text_path, "r", encoding="utf-8") as f:
        text = f.read().strip()

    if not text:
        err = {"error": "Empty text file", "words": 0, "total_ms": 0}
        print(json.dumps(err))
        sys.exit(1)

    try:
        # Load whisper tiny model via stable-ts
        model = stable_whisper.load_model("tiny")

        # Forced alignment — aligns known text to audio
        result = model.align(args.audio_path, text, language=args.language)

        words = []
        for segment in result.segments:
            for word_obj in segment.words:
                offset_ms = int(word_obj.start * 1000)
                end_ms = int(word_obj.end * 1000)
                duration_ms = end_ms - offset_ms
                words.append({
                    "word": word_obj.word.strip(),
                    "offset_ms": offset_ms,
                    "duration_ms": duration_ms,
                })

        # Total duration from the last word
        total_ms = 0
        if words:
            last = words[-1]
            total_ms = last["offset_ms"] + last["duration_ms"]

        output = {
            "words": words,
            "total_ms": total_ms,
            "method": "stable-ts",
        }

        # Write full result to output file
        with open(args.output_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False)

        # Print summary to stdout
        print(json.dumps({
            "total_ms": total_ms,
            "words": len(words),
            "method": "stable-ts",
        }))

    except Exception as e:
        err = {"error": str(e), "words": 0, "total_ms": 0}
        print(json.dumps(err))
        sys.exit(1)


if __name__ == "__main__":
    main()
