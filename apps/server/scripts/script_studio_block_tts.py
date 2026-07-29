#!/usr/bin/env python3
"""
script_studio_block_tts.py
Usage: python script_studio_block_tts.py <text_file> <voice> <rate> <mp3_out> <words_json_out>

Generates edge-tts audio for a single script block.
Captures WordBoundary events for per-word timings (no Whisper needed).
Output words_json: [{word, offset_ms, duration_ms}, ...]
"""
import sys
import json
import asyncio

try:
    import edge_tts
except ImportError:
    print(json.dumps({"error": "edge-tts not installed. Run: pip install edge-tts"}))
    sys.exit(1)


def format_rate(rate: str) -> str:
    """Convert rate string like '0', '-10', '+10' to edge-tts format '+0%'."""
    rate = rate.strip()
    if rate.endswith('%'):
        return rate if rate.startswith('+') or rate.startswith('-') else f'+{rate}'
    try:
        val = int(rate)
        return f'+{val}%' if val >= 0 else f'{val}%'
    except ValueError:
        return rate or '+0%'


async def main():
    if len(sys.argv) < 6:
        print(json.dumps({"error": "Usage: script_studio_block_tts.py <text_file> <voice> <rate> <mp3_out> <words_json_out>"}))
        sys.exit(1)

    text_file, voice, rate, mp3_out, words_json_out = sys.argv[1:6]

    with open(text_file, 'r', encoding='utf-8') as f:
        text = f.read().strip()

    if not text:
        print(json.dumps({"error": "Empty text"}))
        sys.exit(1)

    rate_str = format_rate(rate)
    words = []

    communicate = edge_tts.Communicate(text, voice, rate=rate_str)

    with open(mp3_out, 'wb') as audio_file:
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                audio_file.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                # offset and duration are in 100-nanosecond units
                offset_ms = chunk['offset'] // 10000
                duration_ms = chunk['duration'] // 10000
                words.append({
                    'word': chunk['text'],
                    'offset_ms': offset_ms,
                    'duration_ms': duration_ms
                })

    with open(words_json_out, 'w', encoding='utf-8') as f:
        json.dump(words, f)

    # Total duration = end of last word
    total_ms = 0
    if words:
        last = words[-1]
        total_ms = last['offset_ms'] + last['duration_ms']

    print(json.dumps({"ok": True, "words": len(words), "total_ms": total_ms}))


asyncio.run(main())
