/**
 * Seed the scene library with common cinematic scene categories.
 * Run: npx ts-node scripts/seed-library.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { getDb, dbRun } from '../apps/server/src/db';
import { v4 as uuidv4 } from 'uuid';

const SEED_SCENES = [
  {
    title: 'Rainy Neon City',
    description: 'Cyberpunk city at night, rain, neon reflections',
    category: 'rainy-city',
    tags: ['rain', 'city', 'neon', 'night', 'cyberpunk'],
    mood: 'melancholic',
    style: 'cyberpunk',
    camera_type: 'handheld',
    atmosphere: 'rainy',
    duration: 5,
    reuse_keywords: ['rain', 'city', 'night', 'neon', 'wet', 'urban'],
    quality_score: 0.9,
  },
  {
    title: 'Emotional Closeup',
    description: 'Extreme closeup of eyes reflecting emotion',
    category: 'emotional-closeup',
    tags: ['closeup', 'eyes', 'emotion', 'dramatic'],
    mood: 'dramatic',
    style: 'emotional-storytelling',
    camera_type: 'closeup',
    atmosphere: 'overcast',
    duration: 3,
    reuse_keywords: ['face', 'eyes', 'emotion', 'closeup', 'reaction'],
    quality_score: 0.85,
  },
  {
    title: 'Aerial City Skyline',
    description: 'Sweeping aerial view of city at golden hour',
    category: 'aerial-skyline',
    tags: ['aerial', 'city', 'skyline', 'golden-hour'],
    mood: 'hopeful',
    style: 'documentary',
    camera_type: 'aerial',
    atmosphere: 'golden-hour',
    duration: 5,
    reuse_keywords: ['city', 'aerial', 'skyline', 'above', 'overview'],
    quality_score: 0.9,
  },
  {
    title: 'Person Walking Alone',
    description: 'Silhouette walking alone at night on empty street',
    category: 'person-alone',
    tags: ['person', 'alone', 'walking', 'night', 'silhouette'],
    mood: 'sad',
    style: 'emotional-storytelling',
    camera_type: 'tracking',
    atmosphere: 'night',
    duration: 4,
    reuse_keywords: ['alone', 'walk', 'person', 'street', 'night', 'solitude'],
    quality_score: 0.8,
  },
  {
    title: 'Dramatic Sunset',
    description: 'Wide shot of dramatic sunset over landscape',
    category: 'dramatic-sunset',
    tags: ['sunset', 'dramatic', 'wide', 'landscape', 'golden'],
    mood: 'dramatic',
    style: 'documentary',
    camera_type: 'wide-shot',
    atmosphere: 'golden-hour',
    duration: 5,
    reuse_keywords: ['sunset', 'horizon', 'end', 'golden', 'dramatic', 'sky'],
    quality_score: 0.88,
  },
  {
    title: 'Anime City Night',
    description: 'Anime-style cityscape at night with glowing lights',
    category: 'anime-city-night',
    tags: ['anime', 'city', 'night', 'neon', 'stylized'],
    mood: 'mysterious',
    style: 'anime-cinematic',
    camera_type: 'static',
    atmosphere: 'night',
    duration: 4,
    reuse_keywords: ['anime', 'city', 'night', 'stylized', 'glowing', 'urban'],
    quality_score: 0.87,
  },
  {
    title: 'Crowd Timelapse',
    description: 'High-speed timelapse of crowd in busy city',
    category: 'crowd-timelapse',
    tags: ['crowd', 'timelapse', 'busy', 'city', 'rush'],
    mood: 'energetic',
    style: 'documentary',
    camera_type: 'static',
    atmosphere: 'clear',
    duration: 6,
    reuse_keywords: ['crowd', 'people', 'busy', 'rush', 'timelapse', 'motion'],
    quality_score: 0.82,
  },
  {
    title: 'Rainy Window Reflection',
    description: 'Person looking out rain-covered window, bokeh lights',
    category: 'rainy-city',
    tags: ['window', 'rain', 'reflection', 'interior', 'contemplative'],
    mood: 'melancholic',
    style: 'emotional-storytelling',
    camera_type: 'closeup',
    atmosphere: 'rainy',
    duration: 4,
    reuse_keywords: ['window', 'rain', 'inside', 'reflection', 'think', 'alone'],
    quality_score: 0.86,
  },
];

async function seed() {
  getDb();
  const now = new Date().toISOString();

  for (const scene of SEED_SCENES) {
    const existing = getDb().prepare('SELECT id FROM scenes WHERE title = ?').get(scene.title);
    if (existing) {
      console.log(`  Skip (exists): ${scene.title}`);
      continue;
    }

    const id = uuidv4();
    dbRun(
      `INSERT INTO scenes (id, title, description, category, tags, mood, style, camera_type, atmosphere,
       duration, reuse_keywords, usage_count, quality_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        id,
        scene.title,
        scene.description,
        scene.category,
        JSON.stringify(scene.tags),
        scene.mood,
        scene.style,
        scene.camera_type,
        scene.atmosphere,
        scene.duration,
        JSON.stringify(scene.reuse_keywords),
        scene.quality_score,
        now,
        now,
      ]
    );
    console.log(`  + ${scene.title}`);
  }

  console.log('\nScene library seeded!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
