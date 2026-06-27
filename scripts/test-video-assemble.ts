/**
 * Quick test: assemble 3 video clips into a final video.
 * Usage: npx ts-node scripts/test-video-assemble.ts
 * Requires: server running on localhost:3001
 */

const API = process.env.API_URL || 'http://localhost:3002/api';

async function readNDJSON(response: Response): Promise<any[]> {
  const text = await response.text();
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function main() {
  console.log('=== Test: Assemble 3 video clips ===\n');

  // 1. Check that test video files are servable
  for (const f of ['test_vid_001.mp4', 'test_vid_002.mp4', 'test_vid_003.mp4']) {
    const r = await fetch(`${API}/image/video/file/${f}`, { method: 'HEAD' });
    console.log(`  [${r.status}] /api/image/video/file/${f}`);
    if (!r.ok) {
      console.error(`  ERROR: test video not found. Run the generate script first.`);
      process.exit(1);
    }
  }

  // 2. Pick an existing audio file
  const narrationDir = './cache/narration';
  const fs = await import('fs');
  const audioFiles = fs.readdirSync(narrationDir).filter((f: string) => f.endsWith('.mp3') && !f.startsWith('_'));
  if (!audioFiles.length) {
    console.error('No narration audio files found in cache/narration/. Generate one via the UI first.');
    process.exit(1);
  }
  const audioFilename = audioFiles[0];
  console.log(`\n  Using audio: ${audioFilename}`);

  // 3. Build segments with video clips
  const segments = [
    {
      imageUrl: '/api/image/file/placeholder.jpg',
      imageFilename: 'placeholder.jpg',
      videoUrl: '/api/image/video/file/test_vid_001.mp4',
      videoFilename: 'test_vid_001.mp4',
      mediaType: 'video' as const,
      startTime: 0,
      endTime: 3,
      text: 'Scene one - blue',
    },
    {
      imageUrl: '/api/image/file/placeholder.jpg',
      imageFilename: 'placeholder.jpg',
      videoUrl: '/api/image/video/file/test_vid_002.mp4',
      videoFilename: 'test_vid_002.mp4',
      mediaType: 'video' as const,
      startTime: 3,
      endTime: 7,
      text: 'Scene two - green',
    },
    {
      imageUrl: '/api/image/file/placeholder.jpg',
      imageFilename: 'placeholder.jpg',
      videoUrl: '/api/image/video/file/test_vid_003.mp4',
      videoFilename: 'test_vid_003.mp4',
      mediaType: 'video' as const,
      startTime: 7,
      endTime: 10,
      text: 'Scene three - red',
    },
  ];

  console.log(`\n  Assembling ${segments.length} video segments...`);

  // 4. Call assemble
  const res = await fetch(`${API}/storyboard/assemble`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments, audioFilename, aspectRatio: '16:9' }),
  });

  const lines = await readNDJSON(res);
  for (const line of lines) {
    if (line.error) {
      console.error(`\n  ERROR: ${line.error}`);
      process.exit(1);
    }
    if (line.progress) {
      console.log(`  [${line.step}] ${line.detail || ''}`);
    }
    if (line.done) {
      console.log(`\n  SUCCESS!`);
      console.log(`  Output: ${line.filename}`);
      console.log(`  URL: ${line.url}`);
      console.log(`  Size: ${line.sizeKB} KB`);
      console.log(`  Duration: ${line.duration}s`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
