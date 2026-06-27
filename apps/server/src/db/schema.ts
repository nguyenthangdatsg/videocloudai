export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA cache_size = -32000;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'custom',
  tags TEXT NOT NULL DEFAULT '[]',
  mood TEXT NOT NULL,
  style TEXT NOT NULL,
  camera_type TEXT,
  atmosphere TEXT,
  duration REAL NOT NULL DEFAULT 4,
  reuse_keywords TEXT NOT NULL DEFAULT '[]',
  usage_count INTEGER NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  original_prompt TEXT NOT NULL,
  enhanced_prompt TEXT NOT NULL,
  style TEXT,
  mood TEXT,
  checksum TEXT NOT NULL UNIQUE,
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  scene_id TEXT REFERENCES scenes(id),
  generation_id TEXT REFERENCES generations(id),
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  url TEXT,
  width INTEGER,
  height INTEGER,
  duration REAL,
  filesize INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT NOT NULL DEFAULT '[]',
  mood TEXT,
  style TEXT,
  camera_type TEXT,
  atmosphere TEXT,
  reuse_keywords TEXT NOT NULL DEFAULT '[]',
  usage_count INTEGER NOT NULL DEFAULT 0,
  quality_score REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reusable_clips (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  moods TEXT NOT NULL DEFAULT '[]',
  styles TEXT NOT NULL DEFAULT '[]',
  reuse_contexts TEXT NOT NULL DEFAULT '[]',
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  script TEXT,
  scenes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  format TEXT NOT NULL DEFAULT 'tiktok',
  duration INTEGER NOT NULL DEFAULT 30,
  resolution TEXT NOT NULL DEFAULT '1080x1920',
  fps INTEGER NOT NULL DEFAULT 24,
  narration_enabled INTEGER NOT NULL DEFAULT 1,
  subtitles_enabled INTEGER NOT NULL DEFAULT 1,
  music_enabled INTEGER NOT NULL DEFAULT 0,
  output_path TEXT,
  thumbnail_path TEXT,
  total_duration REAL,
  scene_count INTEGER,
  generated_scene_count INTEGER NOT NULL DEFAULT 0,
  reused_scene_count INTEGER NOT NULL DEFAULT 0,
  render_time_ms INTEGER,
  filesize INTEGER,
  narration_voice TEXT,
  music_track TEXT,
  -- Repo / library taxonomy: category (single) + content tags (JSON array) +
  -- optional reference to a parent / source video so variations of the same source group together.
  category TEXT,
  content_tags TEXT NOT NULL DEFAULT '[]',
  source_video_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- NOTE: indexes on the new repo columns are created from the column-migration list in
-- src/db/index.ts so they only run AFTER the ALTER TABLE statements have added the columns
-- on existing databases. Adding them here would crash startup on pre-migration DBs.

CREATE TABLE IF NOT EXISTS video_clips (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  position INTEGER NOT NULL,
  start_time REAL NOT NULL,
  duration REAL NOT NULL,
  transition TEXT DEFAULT 'cut',
  motion_effect TEXT DEFAULT 'slow-zoom',
  subtitle_text TEXT,
  volume REAL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  prompt_id TEXT REFERENCES prompts(id),
  prompt TEXT NOT NULL,
  enhanced_prompt TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'video',
  duration REAL,
  aspect_ratio TEXT,
  style TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'queued',
  result_asset_id TEXT REFERENCES assets(id),
  error_message TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority TEXT NOT NULL DEFAULT 'normal',
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error_message TEXT,
  error_stack TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  progress INTEGER NOT NULL DEFAULT 0,
  progress_message TEXT,
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY,
  template_video_id TEXT NOT NULL REFERENCES videos(id),
  variation_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  output_video_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT,
  url TEXT,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS distributions (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  export_path TEXT,
  published_at TEXT,
  platform_url TEXT,
  note TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(video_id, channel_id)
);

CREATE TABLE IF NOT EXISTS image_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'uncategorized',
  tags TEXT NOT NULL DEFAULT '[]',
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  filesize INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  prompt TEXT,
  provider TEXT,
  aspect_ratio TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_image_library_category ON image_library(category);
CREATE INDEX IF NOT EXISTS idx_image_library_name ON image_library(name);
CREATE INDEX IF NOT EXISTS idx_assets_scene_id ON assets(scene_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_mood ON assets(mood);
CREATE INDEX IF NOT EXISTS idx_assets_style ON assets(style);
CREATE INDEX IF NOT EXISTS idx_generations_status ON generations(status);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_scenes_mood ON scenes(mood);
CREATE INDEX IF NOT EXISTS idx_scenes_style ON scenes(style);
CREATE INDEX IF NOT EXISTS idx_reusable_clips_asset_id ON reusable_clips(asset_id);
CREATE INDEX IF NOT EXISTS idx_distributions_video_id ON distributions(video_id);
CREATE INDEX IF NOT EXISTS idx_distributions_channel_id ON distributions(channel_id);
CREATE INDEX IF NOT EXISTS idx_distributions_status ON distributions(status);

CREATE TABLE IF NOT EXISTS storyboard_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  niche TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  template_text TEXT NOT NULL DEFAULT '',
  custom_prompts TEXT NOT NULL DEFAULT '{}',
  stage_prompts TEXT NOT NULL DEFAULT '{}',
  stage_parts TEXT NOT NULL DEFAULT '{}',
  color TEXT NOT NULL DEFAULT '#7c6af5',
  youtube_url TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  niche_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_storyboard_templates_niche ON storyboard_templates(niche);

CREATE TABLE IF NOT EXISTS storyboards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_id TEXT,
  current_step TEXT NOT NULL DEFAULT 'topics',
  topic TEXT,
  script TEXT,
  script_duration INTEGER NOT NULL DEFAULT 600,
  voice TEXT,
  audio_filename TEXT,
  audio_duration REAL,
  transcript_entries TEXT NOT NULL DEFAULT '[]',
  prompts TEXT NOT NULL DEFAULT '[]',
  generated_images TEXT NOT NULL DEFAULT '[]',
  segments TEXT NOT NULL DEFAULT '[]',
  metadata_title TEXT,
  metadata_desc TEXT,
  metadata_tags TEXT NOT NULL DEFAULT '[]',
  result_filename TEXT,
  result_url TEXT,
  result_size_kb INTEGER,
  topics_prompt TEXT,
  script_prompt TEXT,
  image_prompt_prompt TEXT,
  metadata_prompt TEXT,
  stage_parts TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storyboards_status ON storyboards(status);
CREATE INDEX IF NOT EXISTS idx_storyboards_updated ON storyboards(updated_at);

-- Drama Studio tables
CREATE TABLE IF NOT EXISTS drama_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT 'romance',
  tone TEXT NOT NULL DEFAULT 'dramatic',
  art_style TEXT NOT NULL DEFAULT 'cinematic',
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  language TEXT NOT NULL DEFAULT 'en',
  episode_format TEXT NOT NULL DEFAULT 'single',
  duration_target INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'draft',
  current_stage TEXT NOT NULL DEFAULT 'setup',
  episode_count INTEGER NOT NULL DEFAULT 1,
  story_input TEXT NOT NULL DEFAULT '',
  input_mode TEXT NOT NULL DEFAULT 'idea',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_drama_projects_status ON drama_projects(status);

CREATE TABLE IF NOT EXISTS drama_episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  synopsis TEXT NOT NULL DEFAULT '',
  beats TEXT NOT NULL DEFAULT '[]',
  script TEXT NOT NULL DEFAULT '',
  script_version INTEGER NOT NULL DEFAULT 1,
  duration_estimate REAL,
  status TEXT NOT NULL DEFAULT 'outline',
  stage TEXT NOT NULL DEFAULT 'story',
  review_score REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_drama_episodes_project ON drama_episodes(project_id);

CREATE TABLE IF NOT EXISTS drama_characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'supporting',
  age TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  physical_description TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  wardrobe_default TEXT NOT NULL DEFAULT '',
  backstory TEXT NOT NULL DEFAULT '',
  reference_prompt TEXT NOT NULL DEFAULT '',
  reference_images TEXT NOT NULL DEFAULT '[]',
  voice_id TEXT NOT NULL DEFAULT '',
  voice_settings TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_drama_characters_project ON drama_characters(project_id);

CREATE TABLE IF NOT EXISTS drama_locations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'interior',
  description TEXT NOT NULL DEFAULT '',
  lighting TEXT NOT NULL DEFAULT '',
  time_of_day TEXT NOT NULL DEFAULT 'day',
  weather TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  props TEXT NOT NULL DEFAULT '[]',
  reference_images TEXT NOT NULL DEFAULT '[]',
  reference_prompt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_drama_locations_project ON drama_locations(project_id);

CREATE TABLE IF NOT EXISTS drama_scenes (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES drama_episodes(id) ON DELETE CASCADE,
  scene_number INTEGER NOT NULL DEFAULT 1,
  heading TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  dialogue TEXT NOT NULL DEFAULT '[]',
  action_lines TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  music_mood TEXT NOT NULL DEFAULT '',
  duration_estimate REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_drama_scenes_episode ON drama_scenes(episode_id);

CREATE TABLE IF NOT EXISTS drama_shots (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES drama_scenes(id) ON DELETE CASCADE,
  shot_number INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  camera_angle TEXT NOT NULL DEFAULT 'medium',
  camera_movement TEXT NOT NULL DEFAULT 'static',
  character_ids TEXT NOT NULL DEFAULT '[]',
  action TEXT NOT NULL DEFAULT '',
  expression TEXT NOT NULL DEFAULT '',
  dialogue_line TEXT NOT NULL DEFAULT '',
  duration REAL NOT NULL DEFAULT 4.0,
  transition_in TEXT NOT NULL DEFAULT 'cut',
  transition_out TEXT NOT NULL DEFAULT 'cut',
  sort_order INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  keyframe_path TEXT,
  video_path TEXT,
  generation_status TEXT NOT NULL DEFAULT 'pending',
  consistency_score REAL,
  generation_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_drama_shots_scene ON drama_shots(scene_id);
`;
