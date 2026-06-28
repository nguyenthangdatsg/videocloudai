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
    dbRun(
      `INSERT INTO drama_projects (id, title, description, genre, tone, art_style, aspect_ratio, language, episode_format, duration_target, status, current_stage, episode_count, story_input, input_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'setup', ?, ?, ?, ?, ?)`,
      [id, input.title, input.description ?? '', input.genre, input.tone, input.artStyle, input.aspectRatio, input.language, input.episodeFormat, input.durationTarget, input.episodeCount ?? 1, input.storyInput ?? '', input.inputMode ?? 'idea', now, now]
    );

    // Create initial episode(s)
    const epCount = input.episodeFormat === 'series' ? (input.episodeCount ?? 1) : 1;
    for (let i = 1; i <= epCount; i++) {
      const epId = crypto.randomUUID();
      dbRun(
        `INSERT INTO drama_episodes (id, project_id, episode_number, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [epId, id, i, `Episode ${i}`, now, now]
      );
    }

    return this.getProject(id)!;
  }

  getProject(id: string): DramaProject | undefined {
    const row = dbGet<Record<string, unknown>>(
      'SELECT * FROM drama_projects WHERE id = ?', [id]
    );
    return row ? this.mapProject(row) : undefined;
  }

  listProjects(): DramaProject[] {
    const rows = dbAll<Record<string, unknown>>(
      'SELECT * FROM drama_projects ORDER BY updated_at DESC'
    );
    return rows.map(r => this.mapProject(r));
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

  async generateOutline(projectId: string, episodeId: string): Promise<DramaEpisode> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new Error('Episode not found');

    // Get story input from project
    const row = dbGet<{ story_input: string; input_mode: string }>('SELECT story_input, input_mode FROM drama_projects WHERE id = ?', [projectId]);
    const storyInput = row?.story_input || project.title;

    const response = await llmComplete({
      systemPrompt: `You are a professional screenwriter specializing in short-form vertical drama for TikTok/YouTube Shorts.
You create compelling beat sheets for ${project.durationTarget}-second episodes.

Genre: ${project.genre}
Tone: ${project.tone}
Format: Vertical video (${project.aspectRatio})

Output ONLY valid JSON array of beats. Each beat has:
- id: unique string
- type: one of "hook", "setup", "inciting-incident", "rising-action", "midpoint", "escalation", "climax", "resolution", "cliffhanger"
- description: vivid 1-2 sentence description of what happens
- emotionTag: the dominant emotion (e.g. "shock", "tension", "sadness", "rage", "hope")
- durationEstimate: seconds this beat takes (total must roughly equal ${project.durationTarget})
- sortOrder: integer starting from 0

Create 5-8 beats with a strong hook and compelling cliffhanger ending. Make it dramatic and binge-worthy.${langInstruction(project.language)}`,
      userMessage: `Create a beat sheet for this story:\n\n${storyInput}`,
      temperature: 0.85,
      maxTokens: 2000,
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
    const synopsisResponse = await llmComplete({
      systemPrompt: `You are a screenwriter. Write a 2-3 sentence synopsis for this episode based on the beat sheet. Be dramatic and engaging. Output ONLY the synopsis text, no JSON.${langInstruction(project.language)}`,
      userMessage: `Story: ${storyInput}\n\nBeats: ${JSON.stringify(beats)}`,
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

  async generateScript(projectId: string, episodeId: string): Promise<DramaEpisode> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new Error('Episode not found');
    const characters = this.listCharacters(projectId);

    const charDescriptions = characters.length > 0
      ? characters.map(c => `${c.name} (${c.role}): ${c.physicalDescription}. Personality: ${c.personality}`).join('\n')
      : 'Characters will be auto-detected from the script.';

    const response = await llmComplete({
      systemPrompt: `You are a professional drama screenwriter for short-form vertical content.
Genre: ${project.genre} | Tone: ${project.tone} | Duration: ~${project.durationTarget}s

Known characters:
${charDescriptions}

Write a complete scene-by-scene script in standard screenplay format:
- Use SCENE headers: "SCENE 1 — INT. LOCATION — TIME"
- Include dialogue with character names in ALL CAPS followed by their line
- Include action/direction lines in brackets
- Include camera suggestions in [Camera: ...] tags
- Include mood/music notes in [Music: ...] tags
- Write punchy, natural dialogue — no exposition dumps
- Start with a strong visual hook
- End with a cliffhanger or emotional punch
${langInstruction(project.language)}
Output ONLY the script text, formatted for readability.`,
      userMessage: `Beat sheet:\n${JSON.stringify(episode.beats, null, 2)}\n\nSynopsis: ${episode.synopsis}`,
      temperature: 0.85,
      maxTokens: 4000,
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

    const response = await llmComplete({
      systemPrompt: `You are a professional storyboard artist and cinematographer for short-form vertical drama.
Break the script into scenes and shots for a ${project.durationTarget}-second ${project.aspectRatio} video.
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
          "dialogueLine": "dialogue if any",
          "duration": 4,
          "transitionOut": "cut|fade|dissolve"
        }
      ]
    }
  ]
}

Rules:
- Each scene should have 2-5 shots
- Vary camera angles for visual interest (don't repeat same angle consecutively)
- Use close-ups for emotional beats, wide shots for establishing
- Total duration of all shots should roughly equal ${project.durationTarget}s
- Match character and location IDs from the provided lists when possible${langInstruction(project.language)}`,
      userMessage: `Generate storyboard from this script:\n\n${episode.script}`,
      temperature: 0.7,
      maxTokens: 6000,
    });

    let storyboardData: { scenes: Array<{
      sceneNumber: number; heading: string; locationId?: string; description?: string;
      mood?: string; musicMood?: string; durationEstimate?: number;
      shots: Array<{
        shotNumber: number; description: string; cameraAngle?: string; cameraMovement?: string;
        characterIds?: string[]; action?: string; expression?: string; dialogueLine?: string;
        duration?: number; transitionOut?: string;
      }>;
    }> };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      storyboardData = jsonMatch ? JSON.parse(jsonMatch[0]) : { scenes: [] };
    } catch {
      storyboardData = { scenes: [] };
    }

    // Delete existing scenes for this episode
    const existingScenes = this.listScenes(episodeId);
    for (const s of existingScenes) {
      this.deleteScene(s.id);
    }

    // Create scenes and shots
    const results: DramaScene[] = [];
    for (const sceneData of storyboardData.scenes) {
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

    const response = await llmComplete({
      systemPrompt: `You are an expert AI image generation prompt engineer for ${project.artStyle} style vertical video frames.
Create a detailed, optimized prompt for generating a single video frame/image.

Output ONLY valid JSON:
{
  "prompt": "detailed positive prompt",
  "negativePrompt": "things to avoid"
}

Rules:
- Start with the art style: ${project.artStyle}
- Include character descriptions for consistency
- Specify camera angle, lighting, mood
- Add quality tags: cinematic lighting, detailed, high quality, 8k
- Negative prompt should include: deformed, blurry, bad anatomy, extra limbs, watermark, text, low quality
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

Output ONLY valid JSON:
{
  "score": 0-100,
  "feedback": "overall assessment in 2-3 sentences",
  "issues": [
    {
      "area": "story|script|pacing|characters|visual",
      "severity": "critical|warning|suggestion",
      "detail": "specific issue description",
      "fix": "concrete, actionable step to resolve this (REQUIRED for every issue)"
    }
  ]
}

IMPORTANT: Every issue MUST include a "fix" field with a specific, actionable recommendation.

Evaluate:
- Hook strength (first 5 seconds)
- Dialogue naturalness (no exposition dumps)
- Pacing (appropriate for ${project.durationTarget}s)
- Character consistency
- Emotional arc completion
- Cliffhanger/ending impact
- Shot variety and visual interest${langInstruction(project.language)}`,
      userMessage: `Review this ${project.genre} drama episode:

Synopsis: ${episode.synopsis}
Beats: ${JSON.stringify(episode.beats)}
Script: ${episode.script}
Scenes: ${scenes.length} scenes with ${scenes.reduce((sum, s) => sum + s.shots.length, 0)} total shots
Characters: ${characters.map(c => `${c.name} (${c.role})`).join(', ')}
Target duration: ${project.durationTarget}s`,
      temperature: 0.5,
      maxTokens: 1500,
    });

    let review: { score: number; feedback: string; issues: Array<{ area: string; severity: string; detail: string; fix?: string }> };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      review = jsonMatch ? JSON.parse(jsonMatch[0]) : { score: 0, feedback: 'Review failed', issues: [] };
    } catch {
      review = { score: 0, feedback: 'Review failed to parse', issues: [] };
    }

    // Save score to episode
    this.updateEpisode(episodeId, { reviewScore: review.score });

    return review;
  }

  // ── Stats ──

  getStats(): { totalProjects: number; inProgress: number; completed: number; totalEpisodes: number; totalCharacters: number } {
    const totalProjects = dbGet<{ c: number }>("SELECT COUNT(*) as c FROM drama_projects")?.c ?? 0;
    const inProgress = dbGet<{ c: number }>("SELECT COUNT(*) as c FROM drama_projects WHERE status = 'in_progress'")?.c ?? 0;
    const completed = dbGet<{ c: number }>("SELECT COUNT(*) as c FROM drama_projects WHERE status = 'completed'")?.c ?? 0;
    const totalEpisodes = dbGet<{ c: number }>("SELECT COUNT(*) as c FROM drama_episodes")?.c ?? 0;
    const totalCharacters = dbGet<{ c: number }>("SELECT COUNT(*) as c FROM drama_characters")?.c ?? 0;
    return { totalProjects, inProgress, completed, totalEpisodes, totalCharacters };
  }
}
