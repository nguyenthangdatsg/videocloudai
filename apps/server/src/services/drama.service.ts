import { dbGet, dbAll, dbRun, dbTransaction } from '../db';
import { llmComplete } from './llm.service';
import type {
  DramaProject,
  DramaEpisode,
  DramaCharacter,
  DramaLocation,
  DramaScene,
  DramaShot,
  DramaBeat,
  CreateDramaProjectInput,
} from '@videocloudai/shared';

const LANG_NAMES: Record<string, string> = {
  en: 'English', vi: 'Vietnamese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', th: 'Thai',
  id: 'Indonesian', hi: 'Hindi', ar: 'Arabic', ru: 'Russian',
};

function langInstruction(code: string): string {
  const name = LANG_NAMES[code] || code;
  if (code === 'en') return '';
  return `

=== LANGUAGE REQUIREMENT (MANDATORY) ===
You MUST write ALL content in ${name} language.
- All dialogue lines: in ${name}
- All descriptions, synopsis, action lines: in ${name}
- All emotion tags, mood words, personality traits: in ${name}
- Character names may stay in their original form
- JSON object keys (like "description", "type", "mood") must remain in English
- But ALL JSON string VALUES must be written in ${name}
DO NOT write in English. The output language is ${name}.
=========================================`;
}

export class DramaService {

  // ── Projects ──

  createProject(input: CreateDramaProjectInput): DramaProject {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const mode = input.mode || 'video';
    console.log('[DramaService] createProject id=%s title=%s mode=%s genre=%s lang=%s', id, input.title, mode, input.genre, input.language);
    console.log('[DramaService] INSERT params:', JSON.stringify([id, input.title, input.description ?? '', input.genre, input.tone, input.artStyle, input.aspectRatio, input.language, input.episodeFormat, input.durationTarget, input.episodeCount ?? 1, input.storyInput ?? '', input.inputMode ?? 'idea', mode, now, now]));
    dbRun(
      `INSERT INTO drama_projects (id, title, description, genre, tone, art_style, aspect_ratio, language, episode_format, duration_target, status, current_stage, episode_count, story_input, input_mode, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'setup', ?, ?, ?, ?, ?, ?)`,
      [id, input.title, input.description ?? '', input.genre, input.tone, input.artStyle, input.aspectRatio, input.language, input.episodeFormat, input.durationTarget, input.episodeCount ?? 1, input.storyInput ?? '', input.inputMode ?? 'idea', mode, now, now]
    );
    console.log('[DramaService] Project row inserted OK');

    // Create initial episode(s)
    const epCount = input.episodeFormat === 'series' ? (input.episodeCount ?? 1) : 1;
    console.log('[DramaService] Creating %d episode(s)', epCount);
    for (let i = 1; i <= epCount; i++) {
      const epId = crypto.randomUUID();
      dbRun(
        `INSERT INTO drama_episodes (id, project_id, episode_number, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [epId, id, i, `Episode ${i}`, now, now]
      );
      console.log('[DramaService] Episode %d created id=%s', i, epId);
    }

    const project = this.getProject(id);
    console.log('[DramaService] getProject result:', project ? 'found' : 'NOT FOUND');
    return project!;
  }

  getProject(id: string): DramaProject | undefined {
    const row = dbGet<Record<string, unknown>>(
      'SELECT * FROM drama_projects WHERE id = ?', [id]
    );
    return row ? this.mapProject(row) : undefined;
  }

  listProjects(mode?: 'video' | 'image'): DramaProject[] {
    if (mode) {
      const rows = dbAll<Record<string, unknown>>(
        'SELECT * FROM drama_projects WHERE mode = ? ORDER BY updated_at DESC',
        [mode]
      );
      return rows.map(r => this.mapProject(r));
    } else {
      const rows = dbAll<Record<string, unknown>>(
        'SELECT * FROM drama_projects ORDER BY updated_at DESC'
      );
      return rows.map(r => this.mapProject(r));
    }
  }

  updateProject(id: string, data: Partial<DramaProject>): DramaProject | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];
    // Only allow safe fields
    const allowed: Record<string, string> = {
      title: 'title', description: 'description', genre: 'genre', tone: 'tone',
      artStyle: 'art_style', aspectRatio: 'aspect_ratio', language: 'language',
      episodeFormat: 'episode_format', durationTarget: 'duration_target',
      status: 'status', currentStage: 'current_stage', episodeCount: 'episode_count',
      aiLongSceneMode: 'ai_long_scene_mode',
      pacing: 'pacing',
    };
    for (const [jsKey, dbCol] of Object.entries(allowed)) {
      if ((data as Record<string, unknown>)[jsKey] !== undefined) {
        fields.push(`${dbCol} = ?`);
        values.push((data as Record<string, unknown>)[jsKey]);
      }
    }
    if (fields.length === 0) return this.getProject(id);
    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    dbRun(`UPDATE drama_projects SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getProject(id);
  }

  deleteProject(id: string): boolean {
    const { changes } = dbRun('DELETE FROM drama_projects WHERE id = ?', [id]);
    return changes > 0;
  }

  private mapProject(row: Record<string, unknown>): DramaProject {
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      genre: row.genre as DramaProject['genre'],
      tone: row.tone as DramaProject['tone'],
      artStyle: row.art_style as DramaProject['artStyle'],
      aspectRatio: row.aspect_ratio as DramaProject['aspectRatio'],
      language: row.language as string,
      episodeFormat: row.episode_format as DramaProject['episodeFormat'],
      durationTarget: row.duration_target as number,
      status: row.status as DramaProject['status'],
      currentStage: row.current_stage as DramaProject['currentStage'],
      episodeCount: row.episode_count as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      mode: (row.mode || 'video') as 'video' | 'image',
      aiLongSceneMode: (row.ai_long_scene_mode || 'freeze_hold') as 'freeze_hold' | 'multi_generate',
      pacing: (row.pacing || 'normal') as 'normal' | 'fast',
    };
  }

  // ── Episodes ──

  listEpisodes(projectId: string): DramaEpisode[] {
    const rows = dbAll<Record<string, unknown>>(
      'SELECT * FROM drama_episodes WHERE project_id = ? ORDER BY episode_number', [projectId]
    );
    return rows.map(r => this.mapEpisode(r));
  }

  getEpisode(id: string): DramaEpisode | undefined {
    const row = dbGet<Record<string, unknown>>(
      'SELECT * FROM drama_episodes WHERE id = ?', [id]
    );
    return row ? this.mapEpisode(row) : undefined;
  }

  updateEpisode(id: string, data: Partial<DramaEpisode>): DramaEpisode | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];
    const allowed: Record<string, string> = {
      title: 'title', synopsis: 'synopsis', script: 'script',
      scriptVersion: 'script_version', durationEstimate: 'duration_estimate',
      status: 'status', stage: 'stage', reviewScore: 'review_score',
      audioFilename: 'audio_filename', audioDuration: 'audio_duration',
      srtFilename: 'srt_filename', videoFilename: 'video_filename',
    };
    for (const [jsKey, dbCol] of Object.entries(allowed)) {
      if ((data as Record<string, unknown>)[jsKey] !== undefined) {
        fields.push(`${dbCol} = ?`);
        values.push((data as Record<string, unknown>)[jsKey]);
      }
    }
    if (data.beats) {
      fields.push('beats = ?');
      values.push(JSON.stringify(data.beats));
    }
    if (fields.length === 0) return this.getEpisode(id);
    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    dbRun(`UPDATE drama_episodes SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getEpisode(id);
  }

  private mapEpisode(row: Record<string, unknown>): DramaEpisode {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      episodeNumber: row.episode_number as number,
      title: row.title as string,
      synopsis: row.synopsis as string,
      beats: JSON.parse((row.beats as string) || '[]'),
      script: row.script as string,
      scriptVersion: row.script_version as number,
      durationEstimate: row.duration_estimate as number,
      status: row.status as DramaEpisode['status'],
      stage: row.stage as DramaEpisode['stage'],
      reviewScore: row.review_score as number | null,
      audioFilename: row.audio_filename as string | null,
      audioDuration: row.audio_duration as number | null,
      srtFilename: row.srt_filename as string | null,
      videoFilename: row.video_filename as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ── Characters ──

  createCharacter(projectId: string, data: { name: string; role?: string; physicalDescription?: string; personality?: string }): DramaCharacter {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const maxOrder = dbGet<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) as m FROM drama_characters WHERE project_id = ?', [projectId]);
    dbRun(
      `INSERT INTO drama_characters (id, project_id, name, role, physical_description, personality, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, data.name, data.role ?? 'supporting', data.physicalDescription ?? '', data.personality ?? '', (maxOrder?.m ?? -1) + 1, now, now]
    );
    return this.getCharacter(id)!;
  }

  listCharacters(projectId: string): DramaCharacter[] {
    const rows = dbAll<Record<string, unknown>>(
      'SELECT * FROM drama_characters WHERE project_id = ? ORDER BY sort_order', [projectId]
    );
    return rows.map(r => this.mapCharacter(r));
  }

  getCharacter(id: string): DramaCharacter | undefined {
    const row = dbGet<Record<string, unknown>>('SELECT * FROM drama_characters WHERE id = ?', [id]);
    return row ? this.mapCharacter(row) : undefined;
  }

  updateCharacter(id: string, data: Partial<DramaCharacter>): DramaCharacter | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];
    const allowed: Record<string, string> = {
      name: 'name', role: 'role', age: 'age', gender: 'gender',
      physicalDescription: 'physical_description', personality: 'personality',
      wardrobeDefault: 'wardrobe_default', backstory: 'backstory',
      referencePrompt: 'reference_prompt', voiceId: 'voice_id', sortOrder: 'sort_order',
    };
    for (const [jsKey, dbCol] of Object.entries(allowed)) {
      if ((data as Record<string, unknown>)[jsKey] !== undefined) {
        fields.push(`${dbCol} = ?`);
        values.push((data as Record<string, unknown>)[jsKey]);
      }
    }
    if (data.referenceImages) {
      fields.push('reference_images = ?');
      values.push(JSON.stringify(data.referenceImages));
    }
    if (data.voiceSettings) {
      fields.push('voice_settings = ?');
      values.push(JSON.stringify(data.voiceSettings));
    }
    if (fields.length === 0) return this.getCharacter(id);
    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    dbRun(`UPDATE drama_characters SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getCharacter(id);
  }

  deleteCharacter(id: string): boolean {
    const { changes } = dbRun('DELETE FROM drama_characters WHERE id = ?', [id]);
    return changes > 0;
  }

  private mapCharacter(row: Record<string, unknown>): DramaCharacter {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      role: row.role as DramaCharacter['role'],
      age: row.age as string,
      gender: row.gender as string,
      physicalDescription: row.physical_description as string,
      personality: row.personality as string,
      wardrobeDefault: row.wardrobe_default as string,
      backstory: row.backstory as string,
      referencePrompt: row.reference_prompt as string,
      referenceImages: JSON.parse((row.reference_images as string) || '[]'),
      voiceId: row.voice_id as string,
      voiceSettings: JSON.parse((row.voice_settings as string) || '{}'),
      sortOrder: row.sort_order as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ── Locations ──

  createLocation(projectId: string, data: { name: string; type?: string; description?: string }): DramaLocation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const maxOrder = dbGet<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) as m FROM drama_locations WHERE project_id = ?', [projectId]);
    dbRun(
      `INSERT INTO drama_locations (id, project_id, name, type, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, data.name, data.type ?? 'interior', data.description ?? '', (maxOrder?.m ?? -1) + 1, now, now]
    );
    return this.getLocation(id)!;
  }

  listLocations(projectId: string): DramaLocation[] {
    const rows = dbAll<Record<string, unknown>>(
      'SELECT * FROM drama_locations WHERE project_id = ? ORDER BY sort_order', [projectId]
    );
    return rows.map(r => this.mapLocation(r));
  }

  getLocation(id: string): DramaLocation | undefined {
    const row = dbGet<Record<string, unknown>>('SELECT * FROM drama_locations WHERE id = ?', [id]);
    return row ? this.mapLocation(row) : undefined;
  }

  updateLocation(id: string, data: Partial<DramaLocation>): DramaLocation | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];
    const allowed: Record<string, string> = {
      name: 'name', type: 'type', description: 'description',
      lighting: 'lighting', timeOfDay: 'time_of_day', weather: 'weather',
      mood: 'mood', referencePrompt: 'reference_prompt', sortOrder: 'sort_order',
    };
    for (const [jsKey, dbCol] of Object.entries(allowed)) {
      if ((data as Record<string, unknown>)[jsKey] !== undefined) {
        fields.push(`${dbCol} = ?`);
        values.push((data as Record<string, unknown>)[jsKey]);
      }
    }
    if (data.props) {
      fields.push('props = ?');
      values.push(JSON.stringify(data.props));
    }
    if (data.referenceImages) {
      fields.push('reference_images = ?');
      values.push(JSON.stringify(data.referenceImages));
    }
    if (fields.length === 0) return this.getLocation(id);
    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    dbRun(`UPDATE drama_locations SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getLocation(id);
  }

  deleteLocation(id: string): boolean {
    const { changes } = dbRun('DELETE FROM drama_locations WHERE id = ?', [id]);
    return changes > 0;
  }

  private mapLocation(row: Record<string, unknown>): DramaLocation {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      type: row.type as 'interior' | 'exterior',
      description: row.description as string,
      lighting: row.lighting as string,
      timeOfDay: row.time_of_day as string,
      weather: row.weather as string,
      mood: row.mood as string,
      props: JSON.parse((row.props as string) || '[]'),
      referenceImages: JSON.parse((row.reference_images as string) || '[]'),
      referencePrompt: row.reference_prompt as string,
      sortOrder: row.sort_order as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ── Scenes ──

  listScenes(episodeId: string): DramaScene[] {
    const rows = dbAll<Record<string, unknown>>(
      'SELECT * FROM drama_scenes WHERE episode_id = ? ORDER BY sort_order', [episodeId]
    );
    return rows.map(r => {
      const scene = this.mapScene(r);
      scene.shots = this.listShots(scene.id);
      return scene;
    });
  }

  private mapScene(row: Record<string, unknown>): DramaScene {
    return {
      id: row.id as string,
      episodeId: row.episode_id as string,
      sceneNumber: row.scene_number as number,
      heading: row.heading as string,
      locationId: row.location_id as string,
      description: row.description as string,
      dialogue: JSON.parse((row.dialogue as string) || '[]'),
      actionLines: row.action_lines as string,
      mood: row.mood as string,
      musicMood: row.music_mood as string,
      durationEstimate: row.duration_estimate as number,
      sortOrder: row.sort_order as number,
      shots: [],
      createdAt: row.created_at as string,
    };
  }

  // ── Shots ──

  listShots(sceneId: string): import('@videocloudai/shared').DramaShot[] {
    const rows = dbAll<Record<string, unknown>>(
      'SELECT * FROM drama_shots WHERE scene_id = ? ORDER BY sort_order', [sceneId]
    );
    return rows.map(r => this.mapShot(r));
  }

  private mapShot(row: Record<string, unknown>): import('@videocloudai/shared').DramaShot {
    return {
      id: row.id as string,
      sceneId: row.scene_id as string,
      shotNumber: row.shot_number as number,
      description: row.description as string,
      cameraAngle: row.camera_angle as import('@videocloudai/shared').CameraAngle,
      cameraMovement: row.camera_movement as import('@videocloudai/shared').CameraMovement,
      characterIds: JSON.parse((row.character_ids as string) || '[]'),
      action: row.action as string,
      expression: row.expression as string,
      dialogueLine: row.dialogue_line as string,
      duration: row.duration as number,
      transitionIn: row.transition_in as import('@videocloudai/shared').ShotTransition,
      transitionOut: row.transition_out as import('@videocloudai/shared').ShotTransition,
      sortOrder: row.sort_order as number,
      prompt: row.prompt as string,
      negativePrompt: row.negative_prompt as string,
      keyframeUrl: row.keyframe_path as string ?? '',
      videoUrl: row.video_path as string ?? '',
      generationStatus: row.generation_status as 'pending' | 'generating' | 'completed' | 'failed',
      consistencyScore: row.consistency_score as number | null,
      createdAt: row.created_at as string,
    };
  }

  // ── AI Generation ──

  async generateOutline(projectId: string, episodeId: string, writerTier: 'top' | 'professional' | 'assistant' = 'professional'): Promise<DramaEpisode> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new Error('Episode not found');

    // Get story input from project
    const row = dbGet<{ story_input: string; input_mode: string }>('SELECT story_input, input_mode FROM drama_projects WHERE id = ?', [projectId]);
    const storyInput = row?.story_input || project.title;

    // Build previous episodes context for story continuity
    const allEpisodes = this.listEpisodes(projectId);
    const previousEpisodes = allEpisodes.filter(ep => ep.episodeNumber < episode.episodeNumber);
    let previousContext = '';
    if (previousEpisodes.length > 0) {
      const summaries = previousEpisodes.map(ep => {
        return `EPISODE ${ep.episodeNumber}: "${ep.title}"
Synopsis: ${ep.synopsis || 'N/A'}
Beats: ${JSON.stringify(ep.beats || [])}`;
      }).join('\n\n');
      previousContext = `\n\n=== PREVIOUS EPISODES (for story continuity) ===
${summaries}
=== END PREVIOUS EPISODES ===

IMPORTANT: This is Episode ${episode.episodeNumber}. The beat sheet MUST continue the story from where Episode ${episode.episodeNumber - 1} left off. Build on existing character arcs, conflicts, and plot threads. Do NOT restart or repeat the story.`;
    }

    // Writer tier settings for outline
    const tierConfig = {
      top:          { temperature: 0.9,  maxTokens: 4000, prefix: 'Write like an award-winning screenwriter with rich, layered storytelling.\n\n' },
      professional: { temperature: 0.85, maxTokens: 2000, prefix: '' },
      assistant:    { temperature: 0.6,  maxTokens: 1500, prefix: 'Keep it concise and efficient.\n\n' },
    }[writerTier];

    const isFast = project.pacing === 'fast';
    const pacingInstruction = isFast
      ? `\n\nPACING: FAST — This is a speed-paced short video. Keep beats extremely tight and punchy. Each beat should be 8-15 seconds max. Cut filler, go straight to action. Total duration MUST be 90-120 seconds. Rapid emotional shifts, no slow build-ups.`
      : '';

    const response = await llmComplete({
      systemPrompt: `${tierConfig.prefix}You are a professional screenwriter specializing in short-form vertical drama for TikTok/YouTube Shorts.
You create compelling beat sheets for ${isFast ? '90-120' : project.durationTarget}-second episodes.

Genre: ${project.genre}
Tone: ${project.tone}
Format: Vertical video (${project.aspectRatio})${previousContext}

Output ONLY valid JSON array of beats. Each beat has:
- id: unique string
- type: one of "hook", "setup", "inciting-incident", "rising-action", "midpoint", "escalation", "climax", "resolution", "cliffhanger"
- description: vivid 1-2 sentence description of what happens
- emotionTag: the dominant emotion (e.g. "shock", "tension", "sadness", "rage", "hope")
- durationEstimate: seconds this beat takes (total must roughly equal ${isFast ? '90-120' : project.durationTarget})
- sortOrder: integer starting from 0

Create 5-8 beats${previousEpisodes.length > 0 ? ' that continue the story naturally' : ''} with a strong hook and compelling cliffhanger ending. Make it dramatic and binge-worthy.${pacingInstruction}${langInstruction(project.language)}`,
      userMessage: `Create a beat sheet for Episode ${episode.episodeNumber}${previousEpisodes.length > 0 ? ' (continuing from previous episodes)' : ''}:\n\n${storyInput}`,
      temperature: tierConfig.temperature,
      maxTokens: tierConfig.maxTokens,
    });

    // Parse beats from response
    let beats: DramaBeat[];
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      beats = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      beats = [];
    }

    // Generate synopsis
    const prevSynopses = previousEpisodes.length > 0
      ? `\nPrevious episodes:\n${previousEpisodes.map(ep => `Ep${ep.episodeNumber}: ${ep.synopsis || 'N/A'}`).join('\n')}\n`
      : '';
    const synopsisResponse = await llmComplete({
      systemPrompt: `You are a screenwriter. Write a 2-3 sentence synopsis for Episode ${episode.episodeNumber} based on the beat sheet. Be dramatic and engaging. ${previousEpisodes.length > 0 ? 'Show how this episode continues from the previous one(s). ' : ''}Output ONLY the synopsis text, no JSON.${langInstruction(project.language)}`,
      userMessage: `Story: ${storyInput}\n${prevSynopses}\nEpisode ${episode.episodeNumber} Beats: ${JSON.stringify(beats)}`,
      temperature: 0.7,
      maxTokens: 300,
    });

    // Update episode
    return this.updateEpisode(episodeId, {
      beats,
      synopsis: synopsisResponse,
      stage: 'story' as DramaEpisode['stage'],
      status: 'outline' as DramaEpisode['status'],
      durationEstimate: beats.reduce((sum, b) => sum + (b.durationEstimate || 0), 0),
    })!;
  }

  async generateScript(projectId: string, episodeId: string, writerTier: 'top' | 'professional' | 'assistant' = 'professional'): Promise<DramaEpisode> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new Error('Episode not found');
    const characters = this.listCharacters(projectId);

    const charDescriptions = characters.length > 0
      ? characters.map(c => `${c.name} (${c.role}): ${c.physicalDescription}. Personality: ${c.personality}`).join('\n')
      : 'Characters will be auto-detected from the script.';

    // Build previous episodes context for story continuity
    const allEpisodes = this.listEpisodes(projectId);
    const previousEpisodes = allEpisodes.filter(ep => ep.episodeNumber < episode.episodeNumber);
    let previousContext = '';
    if (previousEpisodes.length > 0) {
      const summaries = previousEpisodes.map(ep => {
        const scriptSummary = ep.script
          ? `\n--- Script (shortened) ---\n${ep.script.substring(0, 1500)}${ep.script.length > 1500 ? '\n[...truncated]' : ''}`
          : '';
        return `EPISODE ${ep.episodeNumber}: "${ep.title}"
Synopsis: ${ep.synopsis || 'N/A'}
Beats: ${JSON.stringify(ep.beats || [])}${scriptSummary}`;
      }).join('\n\n');
      previousContext = `\n\n=== PREVIOUS EPISODES (for story continuity) ===
${summaries}
=== END PREVIOUS EPISODES ===

IMPORTANT: This is Episode ${episode.episodeNumber}. The script MUST continue the story naturally from where the previous episode(s) left off. Maintain character arcs, ongoing conflicts, and plot threads. Do NOT repeat or restart the story.`;
    }

    // Writer tier settings for script
    const tierConfig = {
      top:          { temperature: 0.9,  maxTokens: 6000, prefix: 'Write like an award-winning screenwriter with rich, layered storytelling.\n\n' },
      professional: { temperature: 0.85, maxTokens: 4000, prefix: '' },
      assistant:    { temperature: 0.6,  maxTokens: 3000, prefix: 'Keep it concise and efficient.\n\n' },
    }[writerTier];

    const isFast = project.pacing === 'fast';
    const fastScriptNote = isFast
      ? `\n\nPACING: FAST — Write for a 90-120 second speed-paced video. Every line must earn its place. Short, punchy dialogue (1-2 sentences max per character). Minimal action descriptions. Rapid scene transitions. No pauses, no lingering — cut to the next beat immediately. Think TikTok attention span.`
      : '';

    const response = await llmComplete({
      systemPrompt: `${tierConfig.prefix}You are a professional drama screenwriter for short-form vertical content.
Genre: ${project.genre} | Tone: ${project.tone} | Duration: ~${isFast ? '90-120' : project.durationTarget}s

Known characters:
${charDescriptions}${previousContext}

Write a complete scene-by-scene script for Episode ${episode.episodeNumber} in standard screenplay format:
- Use SCENE headers: "SCENE 1 — INT. LOCATION — TIME"
- Include dialogue with character names in ALL CAPS followed by their line
- Include action/direction lines in brackets
- Include camera suggestions in [Camera: ...] tags
- Include mood/music notes in [Music: ...] tags
- Write punchy, natural dialogue — no exposition dumps
- Start with a strong visual hook
- End with a cliffhanger or emotional punch${fastScriptNote}
${previousEpisodes.length > 0 ? '- Continue seamlessly from the previous episode — reference earlier events naturally\n- Develop character arcs and relationships further\n- Build on established conflicts and introduce new twists\n' : ''}${langInstruction(project.language)}
Output ONLY the script text, formatted for readability.`,
      userMessage: `Episode ${episode.episodeNumber} — Beat sheet:\n${JSON.stringify(episode.beats, null, 2)}\n\nSynopsis: ${episode.synopsis}`,
      temperature: tierConfig.temperature,
      maxTokens: tierConfig.maxTokens,
    });

    return this.updateEpisode(episodeId, {
      script: response,
      scriptVersion: episode.scriptVersion + 1,
      stage: 'script' as DramaEpisode['stage'],
      status: 'scripted' as DramaEpisode['status'],
    })!;
  }

  async extractCharacters(projectId: string, episodeId: string): Promise<DramaCharacter[]> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const episode = this.getEpisode(episodeId);
    if (!episode || !episode.script) throw new Error('No script to extract characters from');

    const response = await llmComplete({
      systemPrompt: `You are a casting director analyzing a screenplay. Extract all characters mentioned.
Output ONLY valid JSON array. Each character has:
- name: string (character name as it appears in script)
- role: "protagonist" | "antagonist" | "supporting" | "extra"
- age: string estimate (e.g., "late 20s", "50s")
- gender: string
- physicalDescription: string (2-3 sentences, be specific about appearance)
- personality: string (2-3 key traits and speech style)
- wardrobeDefault: string (default outfit description)${langInstruction(project.language)}`,
      userMessage: `Extract characters from this script:\n\n${episode.script}`,
      temperature: 0.5,
      maxTokens: 2000,
    });

    let charData: Array<{
      name: string; role?: string; age?: string; gender?: string;
      physicalDescription?: string; personality?: string; wardrobeDefault?: string;
    }>;
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      charData = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      charData = [];
    }

    const results: DramaCharacter[] = [];
    for (const c of charData) {
      // Check if character already exists
      const existing = dbGet<{ id: string }>(
        'SELECT id FROM drama_characters WHERE project_id = ? AND name = ?',
        [projectId, c.name]
      );
      if (existing) {
        const updated = this.updateCharacter(existing.id, {
          role: c.role as DramaCharacter['role'],
          age: c.age ?? '',
          gender: c.gender ?? '',
          physicalDescription: c.physicalDescription ?? '',
          personality: c.personality ?? '',
          wardrobeDefault: c.wardrobeDefault ?? '',
        });
        if (updated) results.push(updated);
      } else {
        const created = this.createCharacter(projectId, {
          name: c.name,
          role: c.role,
          physicalDescription: c.physicalDescription ?? '',
          personality: c.personality ?? '',
        });
        // Update extra fields
        const updated = this.updateCharacter(created.id, {
          age: c.age ?? '',
          gender: c.gender ?? '',
          wardrobeDefault: c.wardrobeDefault ?? '',
        });
        results.push(updated ?? created);
      }
    }

    // Update project stage
    this.updateProject(projectId, { currentStage: 'characters' as DramaProject['currentStage'] });

    return results;
  }

  async extractLocations(projectId: string, episodeId: string): Promise<DramaLocation[]> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const episode = this.getEpisode(episodeId);
    if (!episode || !episode.script) throw new Error('No script to extract locations from');

    const response = await llmComplete({
      systemPrompt: `You are a production designer analyzing a screenplay. Extract all locations mentioned.
Output ONLY valid JSON array. Each location has:
- name: string (location name, e.g., "Maya's Apartment", "CEO Office")
- type: "interior" | "exterior"
- description: string (2-3 sentences visual description)
- lighting: string (e.g., "warm ambient", "harsh fluorescent", "moonlight")
- timeOfDay: string (e.g., "morning", "night", "golden hour")
- mood: string (e.g., "tense", "cozy", "sterile")
- props: string[] (key visible objects)${langInstruction(project.language)}`,
      userMessage: `Extract locations from this script:\n\n${episode.script}`,
      temperature: 0.5,
      maxTokens: 2000,
    });

    let locData: Array<{
      name: string; type?: string; description?: string; lighting?: string;
      timeOfDay?: string; mood?: string; props?: string[];
    }>;
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      locData = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      locData = [];
    }

    const results: DramaLocation[] = [];
    for (const loc of locData) {
      const existing = dbGet<{ id: string }>(
        'SELECT id FROM drama_locations WHERE project_id = ? AND name = ?',
        [projectId, loc.name]
      );
      if (existing) {
        const updated = this.updateLocation(existing.id, {
          type: (loc.type ?? 'interior') as 'interior' | 'exterior',
          description: loc.description ?? '',
          lighting: loc.lighting ?? '',
          timeOfDay: loc.timeOfDay ?? '',
          mood: loc.mood ?? '',
          props: loc.props ?? [],
        });
        if (updated) results.push(updated);
      } else {
        const created = this.createLocation(projectId, {
          name: loc.name,
          type: loc.type ?? 'interior',
          description: loc.description ?? '',
        });
        const updated = this.updateLocation(created.id, {
          lighting: loc.lighting ?? '',
          timeOfDay: loc.timeOfDay ?? '',
          mood: loc.mood ?? '',
          props: loc.props ?? [],
        });
        results.push(updated ?? created);
      }
    }

    this.updateProject(projectId, { currentStage: 'locations' as DramaProject['currentStage'] });

    return results;
  }

  // ── Scene CRUD ──

  createScene(episodeId: string, data: { sceneNumber: number; heading: string; locationId?: string; description?: string; mood?: string; musicMood?: string; durationEstimate?: number }): DramaScene {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const maxOrder = dbGet<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) as m FROM drama_scenes WHERE episode_id = ?', [episodeId]);
    dbRun(
      `INSERT INTO drama_scenes (id, episode_id, scene_number, heading, location_id, description, dialogue, action_lines, mood, music_mood, duration_estimate, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', '', ?, ?, ?, ?, ?)`,
      [id, episodeId, data.sceneNumber, data.heading, data.locationId ?? '', data.description ?? '', data.mood ?? '', data.musicMood ?? '', data.durationEstimate ?? 0, (maxOrder?.m ?? -1) + 1, now]
    );
    const scene = this.mapScene(dbGet<Record<string, unknown>>('SELECT * FROM drama_scenes WHERE id = ?', [id])!);
    scene.shots = [];
    return scene;
  }

  getScene(id: string): DramaScene | undefined {
    const row = dbGet<Record<string, unknown>>('SELECT * FROM drama_scenes WHERE id = ?', [id]);
    if (!row) return undefined;
    const scene = this.mapScene(row);
    scene.shots = this.listShots(scene.id);
    return scene;
  }

  updateScene(id: string, data: Partial<DramaScene>): DramaScene | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];
    const allowed: Record<string, string> = {
      sceneNumber: 'scene_number', heading: 'heading', locationId: 'location_id',
      description: 'description', actionLines: 'action_lines', mood: 'mood',
      musicMood: 'music_mood', durationEstimate: 'duration_estimate', sortOrder: 'sort_order',
    };
    for (const [jsKey, dbCol] of Object.entries(allowed)) {
      if ((data as Record<string, unknown>)[jsKey] !== undefined) {
        fields.push(`${dbCol} = ?`);
        values.push((data as Record<string, unknown>)[jsKey]);
      }
    }
    if (data.dialogue) {
      fields.push('dialogue = ?');
      values.push(JSON.stringify(data.dialogue));
    }
    if (fields.length === 0) return this.getScene(id);
    values.push(id);
    dbRun(`UPDATE drama_scenes SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getScene(id);
  }

  deleteScene(id: string): boolean {
    const { changes } = dbRun('DELETE FROM drama_scenes WHERE id = ?', [id]);
    return changes > 0;
  }

  // ── Shot CRUD ──

  createShot(sceneId: string, data: { shotNumber: number; description: string; cameraAngle?: string; cameraMovement?: string; duration?: number; action?: string; expression?: string; dialogueLine?: string }): DramaShot {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const maxOrder = dbGet<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) as m FROM drama_shots WHERE scene_id = ?', [sceneId]);
    dbRun(
      `INSERT INTO drama_shots (id, scene_id, shot_number, description, camera_angle, camera_movement, character_ids, action, expression, dialogue_line, duration, transition_in, transition_out, sort_order, prompt, negative_prompt, keyframe_path, video_path, generation_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 'cut', 'cut', ?, '', '', '', '', 'pending', ?)`,
      [id, sceneId, data.shotNumber, data.description, data.cameraAngle ?? 'medium', data.cameraMovement ?? 'static', data.action ?? '', data.expression ?? '', data.dialogueLine ?? '', data.duration ?? 4, (maxOrder?.m ?? -1) + 1, now]
    );
    return this.mapShot(dbGet<Record<string, unknown>>('SELECT * FROM drama_shots WHERE id = ?', [id])!);
  }

  getShot(id: string): DramaShot | undefined {
    const row = dbGet<Record<string, unknown>>('SELECT * FROM drama_shots WHERE id = ?', [id]);
    return row ? this.mapShot(row) : undefined;
  }

  updateShot(id: string, data: Partial<DramaShot>): DramaShot | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];
    const allowed: Record<string, string> = {
      shotNumber: 'shot_number', description: 'description', cameraAngle: 'camera_angle',
      cameraMovement: 'camera_movement', action: 'action', expression: 'expression',
      dialogueLine: 'dialogue_line', duration: 'duration', transitionIn: 'transition_in',
      transitionOut: 'transition_out', sortOrder: 'sort_order', prompt: 'prompt',
      negativePrompt: 'negative_prompt', keyframeUrl: 'keyframe_path', videoUrl: 'video_path',
      generationStatus: 'generation_status',
    };
    for (const [jsKey, dbCol] of Object.entries(allowed)) {
      if ((data as Record<string, unknown>)[jsKey] !== undefined) {
        fields.push(`${dbCol} = ?`);
        values.push((data as Record<string, unknown>)[jsKey]);
      }
    }
    if (data.characterIds) {
      fields.push('character_ids = ?');
      values.push(JSON.stringify(data.characterIds));
    }
    if (fields.length === 0) return this.getShot(id);
    values.push(id);
    dbRun(`UPDATE drama_shots SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getShot(id);
  }

  clearEpisodeImages(episodeId: string): number {
    const scenes = this.listScenes(episodeId);
    const sceneIds = scenes.map(s => s.id);
    if (sceneIds.length === 0) return 0;
    const placeholders = sceneIds.map(() => '?').join(',');
    const { changes } = dbRun(
      `UPDATE drama_shots SET keyframe_path = NULL, generation_status = 'pending' WHERE scene_id IN (${placeholders}) AND keyframe_path IS NOT NULL`,
      sceneIds
    );
    return changes;
  }

  deleteShot(id: string): boolean {
    const { changes } = dbRun('DELETE FROM drama_shots WHERE id = ?', [id]);
    return changes > 0;
  }

  // ── AI: Storyboard, Shot Prompt, Review ──

  async generateStoryboard(projectId: string, episodeId: string): Promise<DramaScene[]> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const episode = this.getEpisode(episodeId);
    if (!episode || !episode.script) throw new Error('No script to generate storyboard from');
    const characters = this.listCharacters(projectId);
    const locations = this.listLocations(projectId);

    const charList = characters.map(c => `${c.name} (${c.id})`).join(', ');
    const locList = locations.map(l => `${l.name} (${l.id})`).join(', ');

    const isFastPace = project.pacing === 'fast';
    const targetDuration = isFastPace ? '90-120' : String(project.durationTarget);
    const fastStoryboardNote = isFastPace
      ? `\n- FAST PACING: Each shot should be 1.5-3 seconds. Use rapid cuts. More shots per scene, shorter duration each. Think music-video pacing — constant visual movement. No shot longer than 3 seconds.`
      : '';

    const response = await llmComplete({
      systemPrompt: `You are a professional storyboard artist and cinematographer for short-form vertical drama.
Break the script into scenes and shots for a ${targetDuration}-second ${project.aspectRatio} video.
Genre: ${project.genre} | Tone: ${project.tone} | Art Style: ${project.artStyle}

Available characters: ${charList || 'None defined'}
Available locations: ${locList || 'None defined'}

Output ONLY valid JSON with this structure:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "heading": "INT. LOCATION - TIME",
      "locationId": "location_id_if_matched or empty string",
      "description": "scene description",
      "mood": "tense/romantic/comedic/etc",
      "musicMood": "suspenseful strings/upbeat pop/etc",
      "durationEstimate": 15,
      "shots": [
        {
          "shotNumber": 1,
          "description": "visual description of what we see",
          "cameraAngle": "close-up|medium|wide|extreme-close-up|over-the-shoulder|low-angle|high-angle|dutch-angle|pov|two-shot|establishing",
          "cameraMovement": "static|pan-left|pan-right|tilt-up|tilt-down|zoom-in|zoom-out|dolly-in|dolly-out|tracking",
          "characterIds": ["character_id"],
          "action": "what character does",
          "expression": "facial expression",
          "dialogueLine": "character dialogue OR narrator voiceover text — EVERY shot MUST have audio",
          "duration": ${isFastPace ? 2 : 4},
          "transitionOut": "cut|fade|dissolve"
        }
      ]
    }
  ]
}

Rules:
- CRITICAL: Every single shot MUST have a dialogueLine — either character dialogue or narrator voiceover describing the action. No shot should be silent.
- For shots without character dialogue, write a narrator voiceover that describes the visual action (e.g. "The camera reveals the abandoned garden, overgrown and forgotten.")
- Each scene should have ${isFastPace ? '3-8' : '2-5'} shots
- Vary camera angles for visual interest (don't repeat same angle consecutively)
- Use close-ups for emotional beats, wide shots for establishing
- Total duration of all shots should roughly equal ${targetDuration}s
- Match character and location IDs from the provided lists when possible${fastStoryboardNote}${langInstruction(project.language)}`,
      userMessage: `Generate storyboard from this script:\n\n${episode.script}`,
      temperature: 0.7,
      maxTokens: 6000,
    });

    type StoryboardScene = {
      sceneNumber: number; heading: string; locationId?: string; description?: string;
      mood?: string; musicMood?: string; durationEstimate?: number;
      shots: Array<{
        shotNumber: number; description: string; cameraAngle?: string; cameraMovement?: string;
        characterIds?: string[]; action?: string; expression?: string; dialogueLine?: string;
        duration?: number; transitionOut?: string;
      }>;
    };

    const parseStoryboard = (text: string): StoryboardScene[] => {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.scenes?.length > 0) return parsed.scenes;
        }
      } catch { /* ignore */ }
      try {
        // Try parsing as array directly
        const arrMatch = text.match(/\[[\s\S]*\]/);
        if (arrMatch) {
          const parsed = JSON.parse(arrMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].shots) return parsed;
        }
      } catch { /* ignore */ }
      return [];
    };

    let scenes = parseStoryboard(response);

    // Retry once if parsing failed
    if (scenes.length === 0) {
      console.warn('[drama] Storyboard parse failed, retrying LLM call...');
      const retry = await llmComplete({
        systemPrompt: 'You are a JSON generator. Convert the following storyboard description into valid JSON with structure: {"scenes":[...]}. Output ONLY the JSON, no markdown.',
        userMessage: response || `Generate a storyboard for: ${episode.script?.slice(0, 500)}`,
        temperature: 0.3,
        maxTokens: 6000,
      });
      scenes = parseStoryboard(retry);
    }

    if (scenes.length === 0) {
      throw new Error('Failed to generate storyboard: LLM returned unparseable response');
    }

    // Scale shot durations to match target
    const targetDur = isFastPace ? 105 : project.durationTarget; // 105 = midpoint of 90-120
    const totalGenerated = scenes.reduce((sum, s) => sum + (s.shots || []).reduce((ss, sh) => ss + (sh.duration || 2), 0), 0);
    if (totalGenerated > 0 && Math.abs(totalGenerated - targetDur) > 5) {
      const scale = targetDur / totalGenerated;
      for (const s of scenes) {
        for (const sh of (s.shots || [])) {
          sh.duration = Math.round((sh.duration || 2) * scale * 2) / 2; // round to 0.5s
          if (sh.duration < 0.5) sh.duration = 0.5;
        }
        s.durationEstimate = (s.shots || []).reduce((sum, sh) => sum + (sh.duration || 2), 0);
      }
    }

    // Delete existing scenes for this episode
    const existingScenes = this.listScenes(episodeId);
    for (const s of existingScenes) {
      this.deleteScene(s.id);
    }

    // Create scenes and shots
    const results: DramaScene[] = [];
    for (const sceneData of scenes) {
      const scene = this.createScene(episodeId, {
        sceneNumber: sceneData.sceneNumber,
        heading: sceneData.heading,
        locationId: sceneData.locationId,
        description: sceneData.description,
        mood: sceneData.mood,
        musicMood: sceneData.musicMood,
        durationEstimate: sceneData.durationEstimate,
      });

      for (const shotData of (sceneData.shots || [])) {
        const shot = this.createShot(scene.id, {
          shotNumber: shotData.shotNumber,
          description: shotData.description,
          cameraAngle: shotData.cameraAngle,
          cameraMovement: shotData.cameraMovement,
          duration: shotData.duration,
          action: shotData.action,
          expression: shotData.expression,
          dialogueLine: shotData.dialogueLine,
        });
        if (shotData.characterIds?.length) {
          this.updateShot(shot.id, { characterIds: shotData.characterIds } as Partial<DramaShot>);
        }
        if (shotData.transitionOut) {
          this.updateShot(shot.id, { transitionOut: shotData.transitionOut } as Partial<DramaShot>);
        }
      }

      results.push(this.getScene(scene.id)!);
    }

    // Update project stage
    this.updateProject(projectId, { currentStage: 'storyboard' as DramaProject['currentStage'] });
    this.updateEpisode(episodeId, { stage: 'storyboard' as DramaEpisode['stage'], status: 'storyboarded' as DramaEpisode['status'] });

    return results;
  }

  async generateShotPrompt(projectId: string, shotId: string): Promise<DramaShot> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const shot = this.getShot(shotId);
    if (!shot) throw new Error('Shot not found');

    const characters = this.listCharacters(projectId);
    const shotCharacters = characters.filter(c => shot.characterIds.includes(c.id));
    const charDescriptions = shotCharacters.map(c => `${c.name}: ${c.physicalDescription}. Wearing: ${c.wardrobeDefault}`).join('\n');

    const scene = this.getScene(shot.sceneId);
    const locations = this.listLocations(projectId);
    const sceneLocation = scene?.locationId ? locations.find(l => l.id === scene.locationId) : null;

    // Build visual consistency bible — canonical descriptions for ALL characters and locations
    const allCharBible = characters.map(c => {
      const ref = c.referencePrompt ? `\nCanonical prompt: ${c.referencePrompt}` : '';
      return `CHARACTER "${c.name}": ${c.physicalDescription}. Wardrobe: ${c.wardrobeDefault}. Age: ${c.age}, Gender: ${c.gender}.${ref}`;
    }).join('\n');

    const allLocBible = locations.map(l => {
      const ref = l.referencePrompt ? `\nCanonical prompt: ${l.referencePrompt}` : '';
      return `LOCATION "${l.name}": ${l.description}. Lighting: ${l.lighting || 'natural'}. Time: ${l.timeOfDay || 'day'}.${ref}`;
    }).join('\n');

    const response = await llmComplete({
      systemPrompt: `You are an expert AI image generation prompt engineer for ${project.artStyle} style vertical video frames.
Create a detailed, optimized prompt for generating a single video frame/image.

Output ONLY valid JSON:
{
  "prompt": "detailed positive prompt",
  "negativePrompt": "things to avoid"
}

=== VISUAL CONSISTENCY BIBLE ===
CRITICAL: You MUST use the EXACT same visual descriptions every time a character or location appears. Never invent new details — use ONLY what is defined below. This ensures the same person/place looks identical across all frames.

${allCharBible || 'No characters defined.'}

${allLocBible || 'No locations defined.'}
=== END BIBLE ===

Rules:
- Start with the art style: ${project.artStyle}
- ALWAYS copy character appearance details word-for-word from the bible above — same hair color, same outfit, same features
- ALWAYS copy location details word-for-word from the bible above — same architecture, same colors, same props
- If a canonical prompt exists, incorporate its key visual descriptors verbatim
- Specify camera angle, lighting, mood
- Add quality tags: cinematic lighting, detailed, high quality, 8k
- Negative prompt should include: deformed, blurry, bad anatomy, extra limbs, watermark, text, low quality, inconsistent character design
- For ${project.aspectRatio} aspect ratio vertical video`,
      userMessage: `Generate prompt for this shot:
Description: ${shot.description}
Camera: ${shot.cameraAngle}, ${shot.cameraMovement}
Action: ${shot.action}
Expression: ${shot.expression}
Dialogue: ${shot.dialogueLine}
Characters in shot: ${charDescriptions || 'None specified'}
Location: ${sceneLocation ? `${sceneLocation.name} - ${sceneLocation.description}. Lighting: ${sceneLocation.lighting}. Time: ${sceneLocation.timeOfDay}` : scene?.heading || 'Unknown'}
Scene mood: ${scene?.mood || 'neutral'}`,
      temperature: 0.7,
      maxTokens: 1000,
    });

    let promptData: { prompt: string; negativePrompt: string };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      promptData = jsonMatch ? JSON.parse(jsonMatch[0]) : { prompt: shot.description, negativePrompt: '' };
    } catch {
      promptData = { prompt: shot.description, negativePrompt: '' };
    }

    return this.updateShot(shotId, {
      prompt: promptData.prompt,
      negativePrompt: promptData.negativePrompt,
    })!;
  }

  async generateCharacterPrompt(projectId: string, characterId: string): Promise<DramaCharacter> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const character = this.getCharacter(characterId);
    if (!character) throw new Error('Character not found');

    const response = await llmComplete({
      systemPrompt: `You are an expert AI image generation prompt engineer.
Generate a character portrait prompt suitable for AI image generation in the "${project.artStyle}" art style.

The prompt should describe a single character portrait that captures their physical appearance, wardrobe, personality vibe, and age/gender.
Include quality tags and negative prompt guidance.

Output ONLY valid JSON:
{
  "prompt": "detailed positive prompt for character portrait"
}

Rules:
- Start with the art style: ${project.artStyle}
- Include specific physical features, hair, eyes, skin tone, build
- Include their default wardrobe/outfit
- Convey personality through pose, expression, body language
- Add quality tags: cinematic lighting, detailed, high quality, 8k, portrait
- Ensure the prompt works well for ${project.aspectRatio} aspect ratio`,
      userMessage: `Generate an AI image prompt for this character:
Name: ${character.name}
Role: ${character.role}
Age: ${character.age}
Gender: ${character.gender}
Physical Description: ${character.physicalDescription}
Personality: ${character.personality}
Wardrobe: ${character.wardrobeDefault}
Backstory: ${character.backstory || 'N/A'}`,
      temperature: 0.7,
      maxTokens: 1000,
    });

    let promptData: { prompt: string };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      promptData = jsonMatch ? JSON.parse(jsonMatch[0]) : { prompt: `${project.artStyle} portrait of ${character.name}, ${character.physicalDescription}` };
    } catch {
      promptData = { prompt: `${project.artStyle} portrait of ${character.name}, ${character.physicalDescription}` };
    }

    return this.updateCharacter(characterId, {
      referencePrompt: promptData.prompt,
    })!;
  }

  async generateLocationPrompt(projectId: string, locationId: string): Promise<DramaLocation> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const location = this.getLocation(locationId);
    if (!location) throw new Error('Location not found');

    const response = await llmComplete({
      systemPrompt: `You are an expert AI image generation prompt engineer.
Generate a location/environment prompt suitable for AI image generation in the "${project.artStyle}" art style.

The prompt should describe the environment, atmosphere, lighting, and mood of the location.
Include quality tags and negative prompt guidance.

Output ONLY valid JSON:
{
  "prompt": "detailed positive prompt for location/environment"
}

Rules:
- Start with the art style: ${project.artStyle}
- Include architectural details, materials, colors
- Describe lighting conditions and atmosphere
- Include time of day, weather, and mood elements
- Mention notable props or set pieces
- Add quality tags: cinematic lighting, detailed, high quality, 8k, environment art
- Ensure the prompt works well for ${project.aspectRatio} aspect ratio`,
      userMessage: `Generate an AI image prompt for this location:
Name: ${location.name}
Type: ${location.type}
Description: ${location.description}
Lighting: ${location.lighting || 'Not specified'}
Time of Day: ${location.timeOfDay || 'Not specified'}
Weather: ${location.weather || 'Not specified'}
Mood: ${location.mood || 'Not specified'}
Props: ${location.props?.length ? location.props.join(', ') : 'None specified'}`,
      temperature: 0.7,
      maxTokens: 1000,
    });

    let promptData: { prompt: string };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      promptData = jsonMatch ? JSON.parse(jsonMatch[0]) : { prompt: `${project.artStyle} environment of ${location.name}, ${location.description}` };
    } catch {
      promptData = { prompt: `${project.artStyle} environment of ${location.name}, ${location.description}` };
    }

    return this.updateLocation(locationId, {
      referencePrompt: promptData.prompt,
    })!;
  }

  async autoGenerate(
    projectId: string,
    episodeId: string,
    writerTier: 'top' | 'professional' | 'assistant' = 'professional',
    onProgress?: (step: string, detail?: string) => void
  ): Promise<void> {
    // Step 1: Generate outline
    onProgress?.('outline', 'Generating episode outline...');
    await this.generateOutline(projectId, episodeId, writerTier);

    // Step 2: Generate script
    onProgress?.('script', 'Writing full script...');
    await this.generateScript(projectId, episodeId, writerTier);

    // Step 3: Extract characters
    onProgress?.('characters', 'Extracting characters from script...');
    await this.extractCharacters(projectId, episodeId);

    // Step 4: Extract locations
    onProgress?.('locations', 'Extracting locations from script...');
    await this.extractLocations(projectId, episodeId);

    // Step 5: Generate storyboard
    onProgress?.('storyboard', 'Generating storyboard scenes and shots...');
    await this.generateStoryboard(projectId, episodeId);

    // Step 6: Generate all shot prompts
    onProgress?.('shot-prompts', 'Generating image prompts for all shots...');
    const scenes = this.listScenes(episodeId);
    const allShots = scenes.flatMap(s => s.shots).filter(sh => !sh.prompt);
    for (let i = 0; i < allShots.length; i++) {
      onProgress?.('shot-prompts', `Generating prompt for shot ${i + 1}/${allShots.length}...`);
      await this.generateShotPrompt(projectId, allShots[i].id);
    }

    onProgress?.('done', 'Auto-generation pipeline complete.');
  }

  async reviewEpisode(projectId: string, episodeId: string): Promise<{ score: number; feedback: string; issues: Array<{ area: string; severity: string; detail: string; fix?: string }> }> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new Error('Episode not found');
    const scenes = this.listScenes(episodeId);
    const characters = this.listCharacters(projectId);

    const response = await llmComplete({
      systemPrompt: `You are a senior drama producer reviewing a short-form vertical drama episode.
Score the episode quality and identify specific issues.

Output ONLY valid JSON (keep it compact, max 5 issues):
{
  "score": 0-100,
  "feedback": "overall assessment in 1-2 sentences",
  "issues": [
    {
      "area": "story|script|pacing|characters|visual",
      "severity": "critical|warning|suggestion",
      "detail": "brief issue description",
      "fix": "concrete fix step"
    }
  ]
}

Rules:
- Every issue MUST include a "fix" field
- Keep detail and fix fields SHORT (under 50 words each)
- Maximum 5 issues, prioritize by severity
- Output MUST be valid, complete JSON — do NOT truncate

Evaluate: hook strength, dialogue naturalness, pacing (${project.durationTarget}s target), character consistency, emotional arc, ending impact, visual variety${langInstruction(project.language)}`,
      userMessage: `Review this ${project.genre} drama episode:

Synopsis: ${episode.synopsis}
Script: ${episode.script}
Scenes: ${scenes.length} scenes, ${scenes.reduce((sum, s) => sum + s.shots.length, 0)} shots
Characters: ${characters.map(c => `${c.name} (${c.role})`).join(', ')}`,
      temperature: 0.5,
      maxTokens: 2000,
    });

    let review: { score: number; feedback: string; issues: Array<{ area: string; severity: string; detail: string; fix?: string }> };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      let jsonStr = jsonMatch[0];
      // Attempt to repair truncated JSON by closing open brackets
      try { JSON.parse(jsonStr); } catch {
        // Truncated — try to salvage by closing arrays/objects
        jsonStr = jsonStr.replace(/,\s*$/, ''); // remove trailing comma
        const opens = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
        const braces = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
        jsonStr += ']'.repeat(Math.max(0, opens)) + '}'.repeat(Math.max(0, braces));
      }
      review = JSON.parse(jsonStr);
      if (typeof review.score !== 'number' || !review.feedback) throw new Error('Invalid review format');
      if (!Array.isArray(review.issues)) review.issues = [];
    } catch (parseErr) {
      console.error('[Drama] Review parse error:', (parseErr as Error).message, '\nRaw response:', response.substring(0, 500));
      review = { score: 0, feedback: `Review failed: ${(parseErr as Error).message}`, issues: [] };
    }

    // Save score to episode
    this.updateEpisode(episodeId, { reviewScore: review.score });

    return review;
  }

  async applyReviewFixes(
    projectId: string,
    episodeId: string,
    issues: Array<{ area: string; severity: string; detail: string; fix?: string }>
  ): Promise<DramaEpisode> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const episode = this.getEpisode(episodeId);
    if (!episode || !episode.script) throw new Error('No script to fix');
    const characters = this.listCharacters(projectId);

    const charDescriptions = characters.length > 0
      ? characters.map(c => `${c.name} (${c.role}): ${c.physicalDescription}. Personality: ${c.personality}`).join('\n')
      : 'Characters are defined in the script.';

    const fixInstructions = issues
      .map((issue, i) => `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.area}: ${issue.detail}\n   Fix: ${issue.fix || 'Address this issue'}`)
      .join('\n');

    const response = await llmComplete({
      systemPrompt: `You are a professional drama screenwriter revising a short-form vertical drama episode.
Genre: ${project.genre} | Tone: ${project.tone} | Duration: ~${project.durationTarget}s

Known characters:
${charDescriptions}

You are given the current script and a list of review issues with fix recommendations.
Apply ALL the fixes while preserving the overall story, characters, and structure.
Keep the same screenplay format:
- SCENE headers: "SCENE 1 — INT. LOCATION — TIME"
- Dialogue with character names in ALL CAPS
- Action/direction in brackets
- Camera suggestions in [Camera: ...] tags
- Music notes in [Music: ...] tags
${langInstruction(project.language)}
Output ONLY the revised script text, formatted for readability.`,
      userMessage: `Current script:\n${episode.script}\n\nIssues to fix:\n${fixInstructions}`,
      temperature: 0.7,
      maxTokens: 4000,
    });

    return this.updateEpisode(episodeId, {
      script: response,
      scriptVersion: episode.scriptVersion + 1,
    })!;
  }

  // ── Stats ──

  getStats(mode?: 'video' | 'image'): { totalProjects: number; inProgress: number; completed: number; totalEpisodes: number; totalCharacters: number } {
    const pWhere = mode ? `WHERE mode = '${mode}'` : '';
    const eWhere = mode ? `WHERE project_id IN (SELECT id FROM drama_projects WHERE mode = '${mode}')` : '';
    const cWhere = mode ? `WHERE project_id IN (SELECT id FROM drama_projects WHERE mode = '${mode}')` : '';

    const totalProjects = dbGet<{ c: number }>(`SELECT COUNT(*) as c FROM drama_projects ${pWhere}`)?.c ?? 0;
    const inProgress = dbGet<{ c: number }>(`SELECT COUNT(*) as c FROM drama_projects ${mode ? `WHERE status = 'in_progress' AND mode = '${mode}'` : "WHERE status = 'in_progress'"}`)?.c ?? 0;
    const completed = dbGet<{ c: number }>(`SELECT COUNT(*) as c FROM drama_projects ${mode ? `WHERE status = 'completed' AND mode = '${mode}'` : "WHERE status = 'completed'"}`)?.c ?? 0;
    const totalEpisodes = dbGet<{ c: number }>(`SELECT COUNT(*) as c FROM drama_episodes ${eWhere}`)?.c ?? 0;
    const totalCharacters = dbGet<{ c: number }>(`SELECT COUNT(*) as c FROM drama_characters ${cWhere}`)?.c ?? 0;
    return { totalProjects, inProgress, completed, totalEpisodes, totalCharacters };
  }
}
