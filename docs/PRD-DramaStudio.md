# Product Requirements Document: AI Drama Studio
## Reverse-Engineering & Improving Topview Drama Studio

**Version:** 1.0
**Date:** 2026-06-21
**Status:** Draft

---

## Table of Contents

1. [Phase 1: Product Analysis](#phase-1-product-analysis)
2. [Phase 2: User Workflow](#phase-2-user-workflow)
3. [Phase 3: Feature Specification](#phase-3-feature-specification)
4. [Phase 4: AI Agents](#phase-4-ai-agents)
5. [Phase 5: Database Design](#phase-5-database-design)
6. [Phase 6: UI/UX Design](#phase-6-uiux-design)
7. [Phase 7: Scalability](#phase-7-scalability)
8. [Phase 8: Improvements](#phase-8-improvements)

---

# PHASE 1: PRODUCT ANALYSIS

## 1.1 What Problem Does This Product Solve?

Creating short-form drama video content (TikTok, YouTube Shorts, Reels) currently requires:
- A **writer** to develop scripts, dialogue, and story structure
- A **director** to plan shots, camera angles, pacing, and emotional beats
- **Actors** to perform scenes
- A **cinematographer** for framing and lighting
- A **video editor** for assembly, transitions, and timing
- A **voice actor** for narration/dialogue
- A **sound designer** for music and SFX
- A **subtitle editor** for captions

**Topview Drama Studio collapses this entire 8-person pipeline into a single AI-driven workflow** that one person can operate. The core problem: creating serialized, character-consistent, story-driven video content is too expensive, too slow, and requires too many specialized skills for solo creators.

## 1.2 Target Users

| Segment | Description | Pain Point |
|---------|-------------|------------|
| **Solo Content Creators** | TikTok/YouTube Shorts creators who want drama content but can't act or film | No production team, no budget |
| **Writers & Novelists** | Authors who want to visualize their stories as video | Can write but can't produce video |
| **Social Media Agencies** | Teams managing multiple brand accounts needing volume | Need 10-50 videos/week per client |
| **Micro-Drama Publishers** | Companies producing serialized short drama for platforms like ReelShort, ShortTV | Need episode consistency at scale |
| **Language Localization Teams** | Companies adapting drama content for multiple markets | Need same story in 10+ languages |
| **Indie Filmmakers** | Filmmakers who want to pre-visualize or prototype stories cheaply | Traditional pre-production is expensive |

## 1.3 Why Would Users Pay?

1. **Time compression**: What takes a team 2-4 weeks compresses to 1-2 hours
2. **Cost elimination**: No actors, no studio, no equipment ($0.35-0.57/video vs $500-5000/video traditional)
3. **Character consistency**: The #1 problem with AI video (faces/outfits change between shots) is specifically addressed
4. **Serialization support**: Multi-episode series with persistent characters, locations, and visual style
5. **End-to-end pipeline**: Script → storyboard → video → voice → captions → export in one tool
6. **Platform-native output**: Vertical 9:16 format, optimized for mobile-first consumption

## 1.4 What Makes It Different From Normal AI Video Generators?

| Feature | Generic AI Video (Runway, Pika) | Topview Drama Studio |
|---------|-------------------------------|---------------------|
| Input | Single prompt per clip | Full story/script/novel chapter |
| Structure | Isolated clips | Structured scenes with narrative arc |
| Characters | Random per generation | Persistent references across shots |
| Audio | None or basic TTS | Dialogue voiceover + music + SFX |
| Output | Raw clips needing editing | Complete, publish-ready episodes |
| Continuity | None | Cross-episode character/location consistency |
| Workflow | Prompt → single clip | Idea → outline → script → storyboard → characters → video → audio → export |

## 1.5 Complete Feature Breakdown

### Inputs
- One-line story idea / logline
- Plot outline / synopsis
- Full drama script with dialogue
- Novel chapter / prose text
- Serialized story concept (multi-episode)
- Character descriptions (text + reference images)
- Scene/location descriptions

### Outputs
- Structured story outline with beat sheet
- Character profiles with visual references
- Shot-by-shot storyboard with camera directions
- AI-generated video scenes (4-15 seconds each)
- AI voiceover (dialogue + narration)
- Background music + sound effects
- Auto-generated subtitles/captions
- Final assembled vertical video (9:16)
- Multi-episode series packages

### User Expectations
- Visual consistency across all shots in an episode
- Character faces, outfits, and body types remain stable
- Location/environment continuity between scenes
- Emotional performance matching dialogue tone
- Professional pacing with hooks and cliffhangers
- Mobile-optimized viewing experience

### AI Operations Behind the Scenes
1. **NLP Story Analysis**: Parse input text, identify characters, locations, conflict, emotional arc
2. **Beat Sheet Generation**: Structure narrative into dramatic beats (inciting incident, rising action, climax, cliffhanger)
3. **Script Expansion**: Transform outline into scene-by-scene dialogue with stage directions
4. **Character Design**: Generate consistent character reference images from descriptions
5. **Scene Composition**: Plan shot types, camera angles, character positions per scene
6. **Storyboard Generation**: Create key frame images for each shot using character/scene references
7. **Video Generation**: Convert storyboard frames to video clips (Seedance 2.0)
8. **Voice Synthesis**: Generate character-specific voices for dialogue lines
9. **Audio Mixing**: Layer voice, music, and SFX with proper timing
10. **Subtitle Generation**: Sync captions to audio with word-level timing
11. **Assembly**: Stitch scenes into final episode with transitions

---

# PHASE 2: USER WORKFLOW

## 2.1 Complete Workflow Map

```
IDEA / INPUT
    │
    ▼
┌─────────────────────┐
│  1. PROJECT SETUP   │  User selects: art style, episode count, duration, language, aspect ratio
│                     │  AI: validates input, sets production parameters
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  2. STORY INPUT     │  User: pastes idea/outline/script/novel OR writes from scratch
│                     │  AI: parses text, extracts entities (characters, locations, themes)
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  3. OUTLINE / BEATS │  AI: generates structured beat sheet with dramatic arc
│                     │  User: reviews, reorders beats, adjusts pacing, approves
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  4. SCRIPT          │  AI: expands beats into scene-by-scene script with dialogue
│                     │  User: edits dialogue, adjusts tone, adds/removes scenes
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  5. CHARACTERS      │  AI: extracts character profiles from script
│                     │  User: refines descriptions, generates reference images
│                     │  AI: creates consistent visual references (face, outfit, body)
│                     │  User: approves or regenerates until satisfied
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  6. SCENES / LOCS   │  AI: extracts locations/environments from script
│                     │  User: refines descriptions, generates reference images
│                     │  AI: creates environment references (lighting, props, mood)
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  7. STORYBOARD      │  AI: breaks script into shots with camera directions
│                     │  Each shot: camera angle, character action, expression, framing
│                     │  AI: generates key frame images using character+scene refs
│                     │  User: reviews, reorders, regenerates individual frames
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  8. VIDEO GEN       │  AI: converts each storyboard frame → video clip (4-15s)
│                     │  Uses character references for consistency
│                     │  User: reviews clips, regenerates unsatisfactory ones
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  9. VOICE & AUDIO   │  AI: generates voiceover from script dialogue
│                     │  AI: selects/generates background music matching mood
│                     │  AI: adds sound effects at appropriate moments
│                     │  User: adjusts voice selection, music volume, SFX timing
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  10. SUBTITLES      │  AI: generates word-level synced captions from voiceover
│                     │  User: reviews, edits text, adjusts timing/style
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  11. ASSEMBLY       │  AI: stitches all clips with transitions, audio mix, captions
│                     │  User: previews full episode, makes final adjustments
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  12. EXPORT         │  User: selects platform format and quality
│                     │  AI: renders final video with platform-specific optimizations
│                     │  Output: downloadable video file
└─────────────────────┘
```

## 2.2 Step-by-Step Detail

### Step 1: Project Setup

| Aspect | Detail |
|--------|--------|
| **User Actions** | Select art style (realistic, anime, cinematic, illustrated), episode format (single/series), episode duration target, video language, aspect ratio (9:16, 16:9, 1:1, etc.) |
| **AI Actions** | Initialize project with production parameters, set default voice/music profiles for language |
| **Required Data** | User preferences |
| **Produced Data** | `Project` record with configuration |

**Art Style Options:**
- Photorealistic / Cinematic
- Anime / Manga
- Illustrated / Storybook
- 3D Rendered
- Watercolor / Painterly
- Noir / Black & White
- Comic Book
- Custom (user-provided style reference)

**Episode Format:**
- Single Episode (standalone story)
- Multi-Episode Series (2-20 episodes, shared characters/world)

**Duration Targets:**
- Short (30-60 seconds) — TikTok/Reels
- Medium (1-3 minutes) — YouTube Shorts
- Long (3-10 minutes) — YouTube/Platform drama

### Step 2: Story Input

| Aspect | Detail |
|--------|--------|
| **User Actions** | Type/paste story input OR select "generate from scratch" with genre + theme keywords |
| **AI Actions** | Parse input text; extract characters, locations, themes, conflict type; classify genre |
| **Required Data** | Raw text input OR genre + theme selection |
| **Produced Data** | Parsed story entities, genre classification, tone profile |

**Input Modes:**
1. **Idea Mode**: One-line logline (e.g., "A billionaire's lost daughter returns for revenge")
2. **Outline Mode**: Multi-paragraph synopsis with key plot points
3. **Script Mode**: Full script with dialogue, stage directions, scene breaks
4. **Novel Mode**: Prose chapter that needs adaptation to screenplay format
5. **Generate Mode**: Pick genre + theme + character archetypes → AI writes from scratch

**Supported Genres:**
Romance, Fantasy, Mystery/Thriller, Revenge Drama, Billionaire/CEO, Workplace, Family Conflict, Horror, Comedy, Sci-Fi, Historical, Supernatural, Crime, Coming-of-Age

### Step 3: Outline & Beat Sheet

| Aspect | Detail |
|--------|--------|
| **User Actions** | Review AI-generated outline; drag-reorder beats; edit beat descriptions; add/remove beats; toggle "Auto Review & Optimize" |
| **AI Actions** | Generate beat sheet following dramatic structure (Setup → Conflict → Escalation → Climax → Cliffhanger); apply genre-specific pacing rules |
| **Required Data** | Parsed story entities from Step 2 |
| **Produced Data** | Ordered beat list with emotional tags, scene count estimate, pacing map |

**Beat Structure (per episode):**
1. **Hook** (0-5s): Attention-grabbing opening moment
2. **Setup** (5-15s): Establish character and situation
3. **Inciting Incident** (15-25s): The event that disrupts status quo
4. **Rising Action** (25-45s): Escalating conflict and tension
5. **Climax** (45-55s): Peak dramatic moment
6. **Cliffhanger/Resolution** (55-60s): Episode-ending hook or resolution

### Step 4: Script Generation

| Aspect | Detail |
|--------|--------|
| **User Actions** | Edit dialogue lines, adjust character voice/tone, add/remove scenes, insert stage directions, mark emotional beats |
| **AI Actions** | Expand beats into full scenes with dialogue, action lines, and camera suggestions; apply genre conventions (e.g., dramatic pauses in revenge drama, witty banter in comedy) |
| **Required Data** | Beat sheet, character profiles, genre classification |
| **Produced Data** | Scene-by-scene script with dialogue, action lines, emotional tags, estimated duration per scene |

**Script Format per Scene:**
```
SCENE 3 — INT. OFFICE — NIGHT
[Mood: Tense] [Duration: ~8s]

MAYA enters the CEO's office. The room is dark except for a desk lamp.

MAYA: (cold) "You thought you could erase me?"

DANIEL turns slowly. His expression shifts from surprise to fear.

DANIEL: (defensive) "Maya... how did you get in here?"

[Camera: Close-up on Maya's eyes → Pull back to reveal Daniel's reaction]
[Music: Low tension strings building]
```

### Step 5: Character Creation

| Aspect | Detail |
|--------|--------|
| **User Actions** | Review AI-extracted character profiles; edit physical descriptions, personality traits, wardrobe; generate reference images; select preferred version; upload custom reference images |
| **AI Actions** | Extract character descriptions from script; generate multiple visual reference options per character; create front/side/3-quarter reference views; establish character "embedding" for consistency |
| **Required Data** | Script with character descriptions |
| **Produced Data** | Character profiles with: name, description, visual references (3+ angles), voice profile, personality tags |

**Character Profile Structure:**
- **Identity**: Name, age, role (protagonist/antagonist/supporting)
- **Physical**: Height, build, hair, eyes, skin tone, distinguishing features
- **Wardrobe**: Default outfit, alternate outfits per scene
- **Personality**: Traits, speech patterns, emotional range
- **Visual References**: AI-generated images (front, 3/4, profile views)
- **Voice Profile**: Pitch, speed, accent, emotional range
- **Relationships**: Connections to other characters

### Step 6: Scene & Location Design

| Aspect | Detail |
|--------|--------|
| **User Actions** | Review AI-extracted locations; edit descriptions; generate environment reference images; define lighting, time of day, weather, props |
| **AI Actions** | Extract locations from script; generate consistent environment images; define visual mood per location |
| **Required Data** | Script with scene headers (INT/EXT, location, time) |
| **Produced Data** | Location profiles with reference images, lighting presets, prop lists |

**Location Profile Structure:**
- **Name**: "Maya's Apartment", "CEO Office", "Hospital Room"
- **Type**: Interior/Exterior
- **Description**: Detailed visual description
- **Lighting**: Natural/artificial, warm/cold, time of day
- **Props**: Key objects visible in scene
- **Mood**: Atmosphere keywords (cozy, sterile, threatening)
- **Reference Images**: 2-3 angles of the environment

### Step 7: Storyboard Generation

| Aspect | Detail |
|--------|--------|
| **User Actions** | Review shot-by-shot storyboard; reorder shots; regenerate individual frames; adjust camera angles; edit shot descriptions |
| **AI Actions** | Break each scene into individual shots; determine camera angle, framing, character position, action, expression for each shot; generate key frame image using character + scene references |
| **Required Data** | Script, character references, location references |
| **Produced Data** | Ordered shot list with key frame images, camera directions, timing estimates |

**Shot Specification:**
```
Shot 3.2 — Close-up
Character: Maya
Action: Eyes narrow, slight smirk
Camera: Eye-level close-up, shallow DOF
Location: CEO Office (dark, desk lamp)
Duration: 3s
Transition: Cut to Shot 3.3
Audio: Tension sting
Dialogue: "You thought you could erase me?"
```

**Camera Angle Options:**
- Wide/Establishing Shot
- Medium Shot
- Close-up
- Extreme Close-up
- Over-the-shoulder
- Low Angle (power)
- High Angle (vulnerability)
- Dutch Angle (unease)
- POV Shot
- Two-shot

### Step 8: Video Generation

| Aspect | Detail |
|--------|--------|
| **User Actions** | Initiate generation per shot or batch; review generated clips; regenerate unsatisfactory shots; trim/adjust timing |
| **AI Actions** | Convert storyboard key frame → video clip using image-to-video model (Seedance 2.0 / equivalent); apply character reference embeddings for consistency; generate motion matching camera direction |
| **Required Data** | Storyboard key frames, character references, camera directions, duration targets |
| **Produced Data** | Video clips per shot (4-15 seconds each) |

### Step 9: Voice & Audio

| Aspect | Detail |
|--------|--------|
| **User Actions** | Assign voice to each character; preview and select from voice options; adjust speed/pitch/emotion; select background music track; set volume levels; add/position SFX |
| **AI Actions** | Generate dialogue audio per character with emotional inflection; select/generate mood-appropriate background music; suggest SFX placements; mix audio layers |
| **Required Data** | Script dialogue, character voice profiles, scene mood tags |
| **Produced Data** | Per-character dialogue audio, background music track, SFX track, mixed audio timeline |

### Step 10: Subtitle Generation

| Aspect | Detail |
|--------|--------|
| **User Actions** | Review auto-generated captions; edit text for accuracy; adjust timing; select caption style (font, size, position, animation) |
| **AI Actions** | Generate word-level timestamps from audio; create SRT/VTT subtitle file; apply platform-specific styling |
| **Required Data** | Mixed audio, script text |
| **Produced Data** | Subtitle file (SRT/VTT) with word-level timing |

### Step 11: Assembly & Preview

| Aspect | Detail |
|--------|--------|
| **User Actions** | Preview full assembled episode; adjust scene transitions; trim/extend clips; fine-tune audio mix; make final edits |
| **AI Actions** | Stitch video clips in order; apply transitions; overlay audio mix; burn in subtitles; generate preview render |
| **Required Data** | All video clips, mixed audio, subtitle file, transition settings |
| **Produced Data** | Preview render of complete episode |

### Step 12: Export

| Aspect | Detail |
|--------|--------|
| **User Actions** | Select export format (platform preset or custom); choose quality; initiate render; download |
| **AI Actions** | Render final video with selected settings; optimize for target platform; generate thumbnail suggestion |
| **Required Data** | Assembled timeline, export settings |
| **Produced Data** | Final video file (MP4), thumbnail image, metadata (title, description, hashtags) |

**Export Presets:**
- TikTok (9:16, 1080x1920, <3min)
- YouTube Shorts (9:16, 1080x1920, <60s)
- Instagram Reels (9:16, 1080x1920, <90s)
- YouTube (16:9, 1920x1080, unlimited)
- Custom (any aspect ratio/resolution)

---

# PHASE 3: FEATURE SPECIFICATION

## Module 1: Story Generator

**Purpose:** Transform any text input into a structured dramatic narrative

**Inputs:**
- Raw text (idea, outline, script, novel chapter)
- Genre selection
- Tone/mood preferences
- Episode count (for series)
- Target duration per episode

**Outputs:**
- Structured beat sheet
- Character extraction list
- Location extraction list
- Conflict identification
- Emotional arc map
- Episode breakdown (for series)

**Internal Workflow:**
1. Parse input text with NLP to extract entities (characters, locations, objects, relationships)
2. Classify genre and tone
3. Apply dramatic structure template (3-act, 5-act, or episodic)
4. Generate beat sheet with emotional tags per beat
5. For series: distribute story arc across episodes with per-episode cliffhangers
6. Run "Auto Review & Optimize" pass — check for plot holes, pacing issues, weak hooks

**UI Requirements:**
- Text input area with word count
- Genre/tone selector chips
- Drag-and-drop beat reordering
- Beat cards with emotional tags (color-coded)
- Episode tabs for series mode
- "Optimize" button for AI review pass
- Side panel showing extracted characters/locations

---

## Module 2: Script Generator

**Purpose:** Expand story outline into production-ready screenplay format

**Inputs:**
- Beat sheet from Story Generator
- Character profiles
- Genre conventions
- Target duration constraints

**Outputs:**
- Scene-by-scene script with dialogue
- Action/stage directions
- Camera suggestions per scene
- Estimated duration per scene
- Emotional intensity curve

**Internal Workflow:**
1. For each beat, generate 1-3 scenes
2. Write dialogue matching character personality and speech patterns
3. Insert action lines describing physical performance
4. Add camera direction suggestions
5. Estimate scene duration based on dialogue length + action
6. Validate total duration against target
7. Add opening hook and closing cliffhanger
8. Run dialogue quality check (natural language, avoid exposition dumps)

**UI Requirements:**
- Screenplay-formatted text editor (scene headers, dialogue blocks, action lines)
- Character color-coding in dialogue
- Scene duration indicators (sidebar timeline)
- Total duration calculator
- Inline AI editing: select text → "Rewrite", "Make more dramatic", "Shorten", "Add subtext"
- Scene navigator sidebar
- Emotion intensity graph alongside scenes

---

## Module 3: Character Manager

**Purpose:** Create, store, and manage persistent character identities across episodes

**Inputs:**
- Character descriptions (text)
- Optional: user-uploaded reference images
- Personality keywords
- Voice preferences

**Outputs:**
- Character profile card
- Visual reference images (multiple angles)
- Character embedding (for AI consistency)
- Voice profile assignment
- Relationship map

**Internal Workflow:**
1. Parse character description into structured attributes (physical, personality, wardrobe)
2. Generate initial reference images (3-5 variations)
3. User selects preferred version
4. Generate additional angles (front, 3/4, profile) from selected version
5. Create character embedding/reference token for image and video generation
6. Assign or generate voice profile
7. Store in project's character library for reuse across episodes

**UI Requirements:**
- Character card grid with thumbnails
- Detailed edit panel: physical attributes, personality, wardrobe
- Image generation gallery with "regenerate" and "variations" buttons
- Multi-angle reference view (front/side/3-quarter)
- Voice preview player with emotion samples
- Drag-and-drop wardrobe changes per scene
- Character relationship graph (visual node map)

---

## Module 4: Character Consistency System

**Purpose:** Maintain visual identity of characters across all generated images and videos

**Is the hardest technical challenge in the entire system.**

**Inputs:**
- Approved character reference images
- Character physical description
- Scene context (lighting, angle, emotion)

**Outputs:**
- Consistent character appearance in every storyboard frame and video clip
- Confidence score per generation (how closely it matches reference)

**Internal Workflow:**
1. Extract face embedding from approved reference images
2. Create character LoRA or IP-Adapter embedding
3. For each new generation, inject character embedding into the generation pipeline
4. Post-generation: run face similarity check against reference
5. If similarity score < threshold, flag for review/regeneration
6. For video: use reference frame + character embedding as conditioning
7. Cross-episode: persist embeddings in character library

**UI Requirements:**
- Consistency score badge on each generated frame (green/yellow/red)
- Side-by-side comparison: reference vs generated
- "Lock" button to approve a frame as additional reference
- Batch regeneration for low-consistency frames
- Character reference panel always visible during storyboard/video generation

---

## Module 5: Storyboard Generator

**Purpose:** Convert script into visual shot-by-shot plan with key frame images

**Inputs:**
- Script with scene/dialogue/action
- Character references
- Location references
- Camera direction preferences

**Outputs:**
- Ordered shot list
- Key frame image per shot
- Camera angle + movement notation
- Shot duration estimate
- Transition type between shots

**Internal Workflow:**
1. Parse script into individual shots (1 shot per significant action/dialogue beat)
2. Determine optimal camera angle for each shot based on dramatic intent
3. Compose shot: place characters in location, set pose/expression/action
4. Generate key frame image using character + location references
5. Assign duration based on dialogue length and action complexity
6. Suggest transitions (cut, fade, dissolve) between shots
7. Calculate total episode duration from shot durations

**UI Requirements:**
- Horizontal scrollable strip of shot cards (thumbnail + metadata)
- Shot detail panel: camera angle selector, character position editor, expression selector
- Drag-and-drop reordering
- "Regenerate frame" button per shot
- Duration adjustment slider per shot
- Transition type dropdown between shots
- Full storyboard grid view (print-friendly)
- Timeline ruler showing cumulative duration

---

## Module 6: Scene Builder

**Purpose:** Define and manage reusable environments/locations

**Inputs:**
- Location descriptions from script
- Lighting/time-of-day preferences
- Mood keywords
- Optional: user reference images

**Outputs:**
- Location profile with reference images
- Lighting presets
- Prop inventory
- Mood/atmosphere tags

**Internal Workflow:**
1. Extract location descriptions from scene headers
2. Expand descriptions with genre-appropriate details
3. Generate reference images (2-3 angles)
4. Define lighting setup (time of day, light sources, color temperature)
5. List key props visible in scene
6. Tag mood/atmosphere for music/SFX matching
7. Store in project location library

**UI Requirements:**
- Location card grid with thumbnails
- Detail editor: description, lighting, props, mood
- Reference image gallery with regeneration
- Time-of-day slider affecting lighting preview
- Weather/atmosphere toggles
- Prop checklist with toggle visibility

---

## Module 7: Prompt Builder

**Purpose:** Translate storyboard shots into optimized AI generation prompts

**Inputs:**
- Shot specification (camera, action, expression, composition)
- Character reference embedding
- Location reference embedding
- Art style settings
- Quality parameters

**Outputs:**
- Optimized image generation prompt
- Optimized video generation prompt
- Negative prompt (what to avoid)
- Generation parameters (steps, CFG, seed)

**Internal Workflow:**
1. Construct base prompt from shot description
2. Inject character identity tokens
3. Add location/environment descriptors
4. Apply art style modifiers (cinematic, anime, etc.)
5. Add technical quality tags (lighting, DOF, resolution)
6. Generate negative prompt (deformed, inconsistent, blurry, etc.)
7. Set generation parameters based on quality/speed preference
8. Cache prompt for regeneration with seed variation

**UI Requirements:**
- Auto-generated prompt (editable)
- Negative prompt field
- Style modifier chips (toggleable)
- Quality preset selector (Draft / Standard / High)
- Advanced parameters panel (collapsible)
- Prompt history with undo
- "Copy prompt" button for external use

---

## Module 8: Voice Generator

**Purpose:** Generate character-specific dialogue audio with emotional performance

**Inputs:**
- Script dialogue lines per character
- Character voice profile (pitch, speed, accent, gender)
- Emotional context per line (angry, sad, sarcastic, tender)
- Language setting

**Outputs:**
- Audio file per dialogue line
- Full scene audio with character voices
- Timing metadata (word-level timestamps)

**Internal Workflow:**
1. Segment script into individual dialogue lines with speaker attribution
2. Load character voice profile (or assign from voice library)
3. Apply emotional modifiers based on scene/line context
4. Generate audio per line
5. Add natural pauses between lines
6. Generate timing metadata (word-level timestamps for subtitle sync)
7. Export per-line audio + assembled scene audio

**UI Requirements:**
- Script view with speaker color-coding
- Voice selector per character (preview samples)
- Emotion selector per line (dropdown or auto-detect)
- Play/pause per line and per scene
- Speed/pitch adjustment sliders
- Waveform visualization
- Re-record individual lines
- Manual timing adjustment

---

## Module 9: Subtitle Generator

**Purpose:** Create synchronized, styled captions from dialogue audio

**Inputs:**
- Generated dialogue audio
- Script text
- Timing metadata from voice generator
- Style preferences (font, size, position, animation)

**Outputs:**
- SRT/VTT subtitle file
- Styled caption overlay (for burn-in)
- Word-level highlight animation data

**Internal Workflow:**
1. Align script text to audio using forced alignment (or use timing from voice generator)
2. Segment into display-friendly caption groups (max 2 lines, ~10 words)
3. Generate SRT/VTT with timestamps
4. Apply styling: font, color, outline, shadow, position
5. Generate word-level highlight animation (karaoke-style for TikTok)
6. Preview overlay on video

**UI Requirements:**
- Caption list with timestamp editor
- Live preview over video
- Style panel: font picker, size, color, outline, shadow, position
- Animation style selector (static, fade-in, word-highlight, karaoke)
- Manual timing drag on timeline
- Bulk style application

---

## Module 10: Audio Mixer

**Purpose:** Layer background music and sound effects with dialogue

**Inputs:**
- Dialogue audio tracks
- Scene mood tags
- Duration per scene
- User music preferences

**Outputs:**
- Background music track (selected or generated)
- SFX placements
- Mixed audio master

**Internal Workflow:**
1. Analyze scene mood tags to select appropriate music genre/mood
2. Select from music library OR generate mood-appropriate music
3. Apply ducking (reduce music volume during dialogue)
4. Suggest SFX placements based on action lines (door slam, footsteps, glass break)
5. Mix all audio layers with appropriate levels
6. Apply normalization and limiting

**UI Requirements:**
- Multi-track timeline (dialogue, music, SFX)
- Music browser/search with mood filters
- Volume automation curves
- SFX library with drag-to-timeline
- Ducking toggle and threshold
- Master volume meter
- Solo/mute per track

---

## Module 11: Timeline Editor

**Purpose:** Assemble all generated assets into final video with fine-grained control

**Inputs:**
- Generated video clips
- Mixed audio
- Subtitle file
- Transition settings

**Outputs:**
- Assembled episode timeline
- Preview render
- Export-ready project

**Internal Workflow:**
1. Arrange video clips in script order
2. Apply transitions between clips (cut, dissolve, fade)
3. Sync audio to video timeline
4. Overlay subtitles
5. Apply color grading / LUT (consistent across episode)
6. Generate preview render (lower quality for speed)
7. Allow frame-precise trimming and repositioning

**UI Requirements:**
- Multi-track timeline: video, audio, subtitle, SFX
- Clip thumbnails on timeline
- Drag-and-drop clip reordering
- Trim handles on clips
- Transition selector between clips
- Playback controls with frame stepping
- Full-screen preview
- Split/join clip tools
- Undo/redo stack

---

## Module 12: Export Manager

**Purpose:** Render final video and prepare platform-specific deliverables

**Inputs:**
- Assembled timeline
- Export preset (platform)
- Quality settings
- Metadata (title, description, hashtags)

**Outputs:**
- Final video file (MP4/MOV)
- Thumbnail image (auto-generated or selected)
- Platform metadata package
- Separate subtitle file (optional)

**Internal Workflow:**
1. Apply export preset (resolution, codec, bitrate, duration limits)
2. Render final video
3. Generate thumbnail candidates from key moments
4. Create metadata package (title, description, hashtags, tags)
5. Validate against platform requirements (file size, duration, format)
6. Package for download

**UI Requirements:**
- Platform preset cards (TikTok, YouTube Shorts, Reels, YouTube, Custom)
- Quality selector (720p, 1080p, 2K, 4K)
- Thumbnail selector/editor
- Metadata editor (title, description, hashtags)
- Render progress bar
- Download button
- Batch export (all episodes in series)
- Export history

---

## Module 13: Project Manager

**Purpose:** Organize, track, and manage all drama projects and series

**Inputs:**
- User projects and episodes
- Collaboration settings
- Project status

**Outputs:**
- Project dashboard
- Series management view
- Asset usage analytics
- Project duplication and templates

**Internal Workflow:**
1. CRUD operations for projects, series, episodes
2. Track project stage (which step in workflow)
3. Asset reference counting (which characters/locations are used where)
4. Credit usage tracking
5. Project duplication for templates
6. Archive/delete with asset cleanup

**UI Requirements:**
- Project grid/list view with thumbnails and status
- Series view with episode cards
- Project stage progress indicator
- Search and filter (by genre, status, date)
- Duplicate project button
- Archive/delete with confirmation
- Credit usage display
- Recent projects section

---

# PHASE 4: AI AGENTS

## 4.1 Multi-Agent Architecture

```
                    ┌─────────────┐
                    │  DIRECTOR   │  Orchestrates all agents, enforces creative vision
                    │   AGENT     │  and consistency across the entire production
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
    │ WRITER    │   │ VISUAL    │   │ AUDIO     │
    │ CLUSTER   │   │ CLUSTER   │   │ CLUSTER   │
    └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
          │               │               │
    ┌─────┤         ┌─────┤         ┌─────┤
    │     │         │     │         │     │
    ▼     ▼         ▼     ▼         ▼     ▼
  Story  Script  Character Storyboard Voice  Music
  Agent  Agent   Agent    Agent     Agent  Agent
                    │
              Prompt Agent
              (shared)

    ┌───────────┐   ┌───────────┐
    │ REVIEWER  │   │ EDITOR    │
    │ AGENT     │   │ AGENT     │
    └───────────┘   └───────────┘
```

## 4.2 Agent Specifications

### Director Agent (Orchestrator)

**Role:** The master conductor — maintains creative vision and coordinates all other agents.

**Responsibilities:**
- Receive user input and determine which agents to activate
- Maintain a "Creative Brief" document that all agents reference
- Enforce consistency: tone, pacing, visual style, character behavior
- Resolve conflicts between agents (e.g., script pacing vs visual feasibility)
- Make final creative decisions when agents disagree
- Track production progress and manage agent handoffs

**Communication:**
- Sends structured task requests to each agent cluster
- Receives results with confidence scores
- Maintains shared context object accessible to all agents
- Can override any agent's output with creative direction

**Context Window:**
```json
{
  "project_id": "...",
  "creative_brief": {
    "genre": "revenge drama",
    "tone": "dark, suspenseful",
    "target_audience": "18-35",
    "visual_style": "cinematic photorealistic",
    "pacing": "fast with tension beats",
    "episode_count": 5,
    "duration_target": "60s per episode"
  },
  "current_stage": "storyboard",
  "approved_assets": {
    "characters": [...],
    "locations": [...],
    "script_version": 3
  }
}
```

---

### Screenwriter Agent (Story Agent)

**Role:** Develops story structure, dramatic arc, and beat sheet.

**Responsibilities:**
- Analyze input text for narrative potential
- Generate dramatic beat sheets
- Ensure proper story structure (hook, rising action, climax, cliffhanger)
- For series: plan multi-episode arcs with per-episode hooks
- Apply genre-specific conventions and tropes
- Optimize for short-form attention spans (front-load hooks, minimize setup)

**Inputs:** Raw text input, genre, tone, duration target
**Outputs:** Structured beat sheet, character list, location list, emotional arc map

**Communication:**
- Receives creative brief from Director
- Sends beat sheet to Script Agent
- Receives feedback from Reviewer Agent on pacing/structure issues

---

### Script Agent

**Role:** Transforms beat sheet into production-ready screenplay.

**Responsibilities:**
- Write dialogue matching character personalities
- Create action lines with visual direction
- Suggest camera angles per scene
- Ensure dialogue feels natural (not expository)
- Match line length to target duration
- Write for vertical video (close-ups, limited wide shots)

**Inputs:** Beat sheet, character profiles, genre conventions
**Outputs:** Scene-by-scene script with dialogue, actions, camera suggestions

**Communication:**
- Receives beat sheet from Story Agent
- Sends script to Character Agent (for extraction) and Storyboard Agent
- Receives edits from Director Agent based on user feedback

---

### Character Agent

**Role:** Creates and maintains persistent character identities.

**Responsibilities:**
- Extract character descriptions from script
- Generate detailed character profiles
- Create visual reference generation prompts
- Maintain character consistency database
- Track wardrobe changes per scene
- Define voice characteristics per character

**Inputs:** Script, user-provided descriptions, reference images
**Outputs:** Character profiles, reference image prompts, character embeddings, voice profiles

**Communication:**
- Receives script from Script Agent
- Sends character references to Storyboard Agent and Prompt Agent
- Receives consistency feedback from Reviewer Agent

---

### Storyboard Agent

**Role:** Plans visual composition for every shot.

**Responsibilities:**
- Break script into individual shots
- Determine camera angle, framing, character position for each shot
- Plan shot transitions and pacing
- Sequence shots for maximum dramatic impact
- Ensure visual variety (don't repeat same angle)
- Estimate duration per shot

**Inputs:** Script, character references, location references, camera preferences
**Outputs:** Shot list with specifications, key frame generation requests

**Communication:**
- Receives script from Script Agent + character/location refs from Character Agent
- Sends shot specifications to Prompt Agent
- Receives generated frames for approval routing

---

### Prompt Agent

**Role:** Translates shot specifications into optimized AI generation prompts.

**Responsibilities:**
- Construct precise image/video generation prompts
- Inject character consistency tokens/embeddings
- Apply art style modifiers
- Create negative prompts to avoid common AI artifacts
- Optimize prompt structure for each AI model's strengths
- Manage seed values for reproducibility

**Inputs:** Shot specifications, character embeddings, location refs, art style, quality settings
**Outputs:** Structured prompt object (positive prompt, negative prompt, parameters, references)

**Communication:**
- Receives specifications from Storyboard Agent
- Sends prompts to image/video generation APIs
- Reports generation results back to Storyboard Agent

---

### Narrator / Voice Agent

**Role:** Generates character-specific dialogue audio with emotional performance.

**Responsibilities:**
- Assign voices to characters from voice library
- Apply emotional modifiers per dialogue line
- Generate natural pauses and breathing
- Ensure lip-sync compatibility timing
- Handle narration vs dialogue differentiation
- Generate word-level timestamps for subtitle sync

**Inputs:** Script dialogue, character voice profiles, emotional context
**Outputs:** Per-line audio, assembled scene audio, timing metadata

**Communication:**
- Receives script from Script Agent + voice profiles from Character Agent
- Sends audio to Music Agent for mixing
- Sends timing data to Editor Agent for subtitle sync

---

### Music Agent

**Role:** Selects and manages background music and sound effects.

**Responsibilities:**
- Analyze scene mood/emotion tags
- Select or generate appropriate background music
- Suggest SFX placements based on action lines
- Mix audio layers (dialogue, music, SFX)
- Apply ducking and normalization
- Ensure audio continuity across scene transitions

**Inputs:** Scene mood tags, dialogue audio, action descriptions, duration
**Outputs:** Music track, SFX placements, mixed audio master

**Communication:**
- Receives scene data from Director + audio from Voice Agent
- Sends mixed audio to Editor Agent

---

### Reviewer Agent

**Role:** Quality control across all production stages.

**Responsibilities:**
- Review story for plot holes, pacing issues, weak hooks
- Check script for unnatural dialogue, exposition dumps
- Validate character consistency in generated frames
- Check video clips for artifacts, temporal coherence
- Verify audio sync and quality
- Score overall episode quality and flag issues
- Suggest specific improvements with reasoning

**Inputs:** Any production asset at any stage
**Outputs:** Review report with scores, issues, and improvement suggestions

**Communication:**
- Can be invoked by any agent or by Director
- Reports findings to Director Agent
- Director decides whether to accept, regenerate, or override

**Review Criteria by Stage:**
| Stage | Check | Score Weight |
|-------|-------|-------------|
| Story | Hook strength, arc completeness, cliffhanger impact | 20% |
| Script | Dialogue naturalness, pacing, emotional beats | 20% |
| Characters | Visual consistency, personality alignment | 15% |
| Storyboard | Shot variety, composition, continuity | 15% |
| Video | Temporal coherence, artifact-free, character match | 15% |
| Audio | Voice quality, music fit, mix balance | 10% |
| Final | Overall engagement prediction, platform fit | 5% |

---

### Editor Agent

**Role:** Assembles all assets into final video with professional polish.

**Responsibilities:**
- Arrange clips in script order
- Select and apply transitions
- Sync audio to video
- Overlay subtitles with styling
- Apply color grading for consistency
- Generate preview renders
- Apply platform-specific optimizations
- Ensure total duration meets target

**Inputs:** Video clips, mixed audio, subtitles, transition preferences, export settings
**Outputs:** Assembled timeline, preview render, final export

**Communication:**
- Receives video clips from generation pipeline
- Receives audio from Music Agent
- Receives subtitles from Voice Agent
- Reports final assembly to Director for approval

---

## 4.3 Agent Communication Protocol

```
Message Format:
{
  "from": "storyboard_agent",
  "to": "prompt_agent",
  "type": "task_request",
  "priority": "normal",
  "context": {
    "project_id": "...",
    "episode_id": "...",
    "shot_id": "shot_3_2"
  },
  "payload": {
    "shot_spec": { ... },
    "character_refs": [ ... ],
    "location_ref": { ... }
  },
  "constraints": {
    "art_style": "cinematic",
    "quality": "standard",
    "max_attempts": 3
  }
}

Response Format:
{
  "from": "prompt_agent",
  "to": "storyboard_agent",
  "type": "task_result",
  "status": "success",
  "payload": {
    "prompt": "...",
    "negative_prompt": "...",
    "generated_image_url": "...",
    "consistency_score": 0.87
  }
}
```

---

# PHASE 5: DATABASE DESIGN

## 5.1 Entity Relationship Diagram

```
User ──┬──< Project ──┬──< Episode ──< Scene ──< Shot
       │              │                  │         │
       │              ├──< Character ────┘    ShotAsset
       │              │      │                    │
       │              ├──< Location ──────────────┘
       │              │
       │              ├──< Asset
       │              │
       │              └──< Export
       │
       └──< CreditTransaction
```

## 5.2 Complete Entity Definitions

### User
```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  avatar_url    TEXT,
  plan          TEXT DEFAULT 'free',        -- free, pro, business, ultra, enterprise
  credits       INTEGER DEFAULT 10,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  settings      TEXT                         -- JSON: preferences, defaults
);
```

### Project
```sql
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT,
  genre         TEXT,                        -- romance, thriller, revenge, etc.
  tone          TEXT,                        -- dark, comedic, suspenseful, etc.
  art_style     TEXT DEFAULT 'cinematic',   -- cinematic, anime, illustrated, etc.
  aspect_ratio  TEXT DEFAULT '9:16',
  language      TEXT DEFAULT 'en',
  episode_format TEXT DEFAULT 'single',     -- single, series
  duration_target INTEGER DEFAULT 60,       -- seconds per episode
  status        TEXT DEFAULT 'draft',       -- draft, in_progress, completed, archived
  creative_brief TEXT,                      -- JSON: full creative direction context
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Series
```sql
CREATE TABLE series (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  title         TEXT NOT NULL,
  synopsis      TEXT,
  total_episodes INTEGER DEFAULT 1,
  season_number INTEGER DEFAULT 1,
  story_arc     TEXT,                       -- JSON: multi-episode arc structure
  status        TEXT DEFAULT 'planning',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Episode
```sql
CREATE TABLE episodes (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  series_id     TEXT REFERENCES series(id),
  episode_number INTEGER NOT NULL,
  title         TEXT,
  synopsis      TEXT,
  beat_sheet    TEXT,                        -- JSON: ordered beats with emotional tags
  script        TEXT,                        -- Full screenplay text
  script_version INTEGER DEFAULT 1,
  duration_estimate REAL,                   -- seconds
  status        TEXT DEFAULT 'outline',     -- outline, scripted, storyboarded, generating, assembled, exported
  stage         TEXT DEFAULT 'story',       -- story, script, characters, locations, storyboard, video, audio, subtitles, assembly, export
  review_score  REAL,                       -- 0-100 quality score from Reviewer Agent
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Scene
```sql
CREATE TABLE scenes (
  id            TEXT PRIMARY KEY,
  episode_id    TEXT NOT NULL REFERENCES episodes(id),
  scene_number  INTEGER NOT NULL,
  heading       TEXT,                        -- INT. OFFICE - NIGHT
  location_id   TEXT REFERENCES locations(id),
  description   TEXT,
  dialogue      TEXT,                        -- JSON: array of {character_id, line, emotion}
  action_lines  TEXT,
  mood          TEXT,                        -- tense, romantic, comedic, etc.
  music_mood    TEXT,
  duration_estimate REAL,
  sort_order    INTEGER,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Shot
```sql
CREATE TABLE shots (
  id            TEXT PRIMARY KEY,
  scene_id      TEXT NOT NULL REFERENCES scenes(id),
  shot_number   INTEGER NOT NULL,
  description   TEXT NOT NULL,
  camera_angle  TEXT,                        -- close-up, wide, medium, OTS, etc.
  camera_movement TEXT,                     -- static, pan-left, zoom-in, etc.
  character_ids TEXT,                        -- JSON array of character IDs in shot
  action        TEXT,                        -- what happens in this shot
  expression    TEXT,                        -- character facial expression
  dialogue_line TEXT,                        -- which dialogue line (if any) plays
  duration      REAL DEFAULT 4.0,           -- seconds
  transition_in TEXT DEFAULT 'cut',         -- cut, fade, dissolve
  transition_out TEXT DEFAULT 'cut',
  sort_order    INTEGER,

  -- Generation fields
  prompt        TEXT,                        -- image generation prompt
  negative_prompt TEXT,
  keyframe_asset_id TEXT REFERENCES assets(id),
  video_asset_id TEXT REFERENCES assets(id),
  generation_status TEXT DEFAULT 'pending', -- pending, generating, completed, failed
  consistency_score REAL,                   -- 0-1 character consistency score
  generation_attempts INTEGER DEFAULT 0,

  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Character
```sql
CREATE TABLE characters (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  name          TEXT NOT NULL,
  role          TEXT,                        -- protagonist, antagonist, supporting, extra
  age           TEXT,
  gender        TEXT,
  physical_description TEXT,                -- detailed physical appearance
  personality   TEXT,                        -- personality traits, speech patterns
  wardrobe_default TEXT,                   -- default outfit description
  backstory     TEXT,
  relationships TEXT,                       -- JSON: [{character_id, relationship_type}]

  -- Visual reference
  reference_prompt TEXT,                    -- prompt used to generate reference
  reference_images TEXT,                    -- JSON: array of asset_ids for reference views
  embedding_data TEXT,                      -- character embedding/LoRA data path

  -- Voice
  voice_id      TEXT,                       -- voice model/profile ID
  voice_settings TEXT,                      -- JSON: {pitch, speed, accent, emotion_range}

  sort_order    INTEGER,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Character Wardrobe
```sql
CREATE TABLE character_wardrobes (
  id            TEXT PRIMARY KEY,
  character_id  TEXT NOT NULL REFERENCES characters(id),
  name          TEXT NOT NULL,              -- "Office Suit", "Casual", "Disguise"
  description   TEXT NOT NULL,
  reference_asset_id TEXT REFERENCES assets(id),
  scenes_used   TEXT,                       -- JSON: array of scene_ids where worn
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Location
```sql
CREATE TABLE locations (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  name          TEXT NOT NULL,
  type          TEXT,                        -- interior, exterior
  description   TEXT,
  lighting      TEXT,                        -- JSON: {type, color_temp, sources}
  time_of_day   TEXT,                       -- dawn, day, dusk, night
  weather       TEXT,
  mood          TEXT,
  props         TEXT,                        -- JSON: array of prop descriptions
  reference_images TEXT,                    -- JSON: array of asset_ids
  reference_prompt TEXT,
  sort_order    INTEGER,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Asset
```sql
CREATE TABLE assets (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  type          TEXT NOT NULL,              -- image, video, audio, subtitle, music, sfx, thumbnail
  category      TEXT,                       -- character_ref, location_ref, keyframe, clip, dialogue, narration, bgm
  file_path     TEXT NOT NULL,
  file_size     INTEGER,
  mime_type     TEXT,
  width         INTEGER,
  height        INTEGER,
  duration      REAL,                       -- seconds (for audio/video)

  -- Generation metadata
  prompt        TEXT,
  negative_prompt TEXT,
  model_used    TEXT,                       -- seedance-2.0, gpt-image-2, etc.
  seed          INTEGER,
  generation_params TEXT,                  -- JSON: full generation parameters
  credits_used  REAL DEFAULT 0,

  -- Relationships
  parent_asset_id TEXT REFERENCES assets(id), -- e.g., video generated from image
  character_id  TEXT REFERENCES characters(id),
  location_id   TEXT REFERENCES locations(id),
  shot_id       TEXT REFERENCES shots(id),

  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Voice Profile
```sql
CREATE TABLE voice_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT,                       -- edge-tts, elevenlabs, custom
  voice_model_id TEXT,                     -- provider-specific voice ID
  language      TEXT DEFAULT 'en',
  gender        TEXT,
  age_range     TEXT,
  accent        TEXT,
  pitch         REAL DEFAULT 1.0,
  speed         REAL DEFAULT 1.0,
  sample_asset_id TEXT REFERENCES assets(id),
  is_custom     BOOLEAN DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Subtitle
```sql
CREATE TABLE subtitles (
  id            TEXT PRIMARY KEY,
  episode_id    TEXT NOT NULL REFERENCES episodes(id),
  language      TEXT DEFAULT 'en',
  format        TEXT DEFAULT 'srt',         -- srt, vtt, ass
  content       TEXT NOT NULL,              -- full subtitle file content
  style         TEXT,                       -- JSON: {font, size, color, position, animation}
  asset_id      TEXT REFERENCES assets(id),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Export
```sql
CREATE TABLE exports (
  id            TEXT PRIMARY KEY,
  episode_id    TEXT NOT NULL REFERENCES episodes(id),
  platform      TEXT,                       -- tiktok, youtube_shorts, reels, youtube, custom
  resolution    TEXT,                       -- 720p, 1080p, 2k, 4k
  aspect_ratio  TEXT,
  file_path     TEXT,
  file_size     INTEGER,
  duration      REAL,
  thumbnail_asset_id TEXT REFERENCES assets(id),
  metadata      TEXT,                       -- JSON: {title, description, hashtags, tags}
  credits_used  REAL DEFAULT 0,
  status        TEXT DEFAULT 'pending',    -- pending, rendering, completed, failed
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Credit Transaction
```sql
CREATE TABLE credit_transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  amount        REAL NOT NULL,             -- positive = credit, negative = debit
  balance_after REAL NOT NULL,
  type          TEXT,                       -- purchase, generation, refund, bonus
  description   TEXT,
  asset_id      TEXT REFERENCES assets(id),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Agent Log
```sql
CREATE TABLE agent_logs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  episode_id    TEXT REFERENCES episodes(id),
  agent_name    TEXT NOT NULL,             -- director, screenwriter, character, storyboard, etc.
  action        TEXT NOT NULL,             -- generate, review, approve, reject, revise
  input_summary TEXT,
  output_summary TEXT,
  tokens_used   INTEGER,
  duration_ms   INTEGER,
  status        TEXT,                      -- success, failed, retry
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 5.3 Key Relationships

```
User 1──* Project         (user owns many projects)
Project 1──1 Series       (project can be a series)
Project 1──* Episode      (project has many episodes)
Project 1──* Character    (project has character library)
Project 1──* Location     (project has location library)
Project 1──* Asset        (project owns all generated assets)

Series 1──* Episode       (series contains episodes)
Episode 1──* Scene        (episode has scenes)
Scene 1──* Shot           (scene has shots)
Scene *──1 Location       (scene happens at a location)

Shot *──* Character       (shots feature characters)
Shot 1──1 Asset(keyframe) (shot has keyframe image)
Shot 1──1 Asset(video)    (shot has video clip)

Character 1──* CharacterWardrobe (character has outfits)
Character 1──* Asset(ref) (character has reference images)
Character 1──1 VoiceProfile

Location 1──* Asset(ref)  (location has reference images)

Episode 1──* Subtitle     (episode has subtitles per language)
Episode 1──* Export       (episode has exports per platform)
```

---

# PHASE 6: UI/UX DESIGN

## Design System

Based on the product type (creative tool / content studio):

**Style:** Dark-first minimal with cinematic accents
**Primary:** Violet-500 (#8B5CF6) — creative, premium
**Accent:** Emerald-400 (#34D399) — success, completion
**Surface:** Slate-900 (#0f172a) base, Slate-800 (#1e293b) elevated
**Text:** Slate-50 (#f8fafc) primary, Slate-400 (#94a3b8) secondary
**Font:** Inter (UI) + JetBrains Mono (code/technical)

---

## Screen 1: Dashboard

**Purpose:** Project overview, quick access, recent work

**Layout:**
```
┌──────────────────────────────────────────────┐
│  [Logo] Drama Studio    [Credits: 47]  [?] [U] │
├──────────────────────────────────────────────┤
│                                              │
│  Welcome back, {name}                        │
│                                              │
│  [+ New Project]  [+ New Series]             │
│                                              │
│  ── Recent Projects ──────────────────────   │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐           │
│  │ T1  │ │ T2  │ │ T3  │ │ T4  │           │
│  │thumb│ │thumb│ │thumb│ │thumb│           │
│  │title│ │title│ │title│ │title│           │
│  │stage│ │stage│ │stage│ │stage│           │
│  └─────┘ └─────┘ └─────┘ └─────┘           │
│                                              │
│  ── Series ───────────────────────────────   │
│  ┌────────────────────────────────────┐      │
│  │ Series 1 — 5 episodes  [3/5 done] │      │
│  │ EP1 ✓ | EP2 ✓ | EP3 ✓ | EP4 ◐ | EP5 ○  │
│  └────────────────────────────────────┘      │
│                                              │
│  ── Templates ────────────────────────────   │
│  [Romance] [Thriller] [Comedy] [Custom]      │
│                                              │
└──────────────────────────────────────────────┘
```

**Components:**
- Top bar: Logo, credit counter, help, user avatar
- New project CTA (prominent)
- Project cards: thumbnail, title, genre badge, stage indicator, date
- Series cards: episodic progress bar
- Template shortcuts: genre-specific starter templates

**User Interactions:**
- Click project card → Project View
- Click + New → Project Setup wizard
- Click series → Series View with episode list
- Click template → Pre-filled Project Setup

**AI Interactions:** None (static dashboard)

---

## Screen 2: Project Setup (Wizard)

**Purpose:** Configure new project parameters

**Layout:**
```
┌──────────────────────────────────────────────┐
│  ← Back                    Step 1 of 3       │
├──────────────────────────────────────────────┤
│                                              │
│  What are you creating?                      │
│                                              │
│  ┌──────────┐  ┌──────────┐                 │
│  │ 📽 Single │  │ 📺 Series│                 │
│  │ Episode  │  │ Multi-ep │                 │
│  └──────────┘  └──────────┘                 │
│                                              │
│  Art Style:                                  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐       │
│  │Cine│ │Anim│ │Illu│ │3D  │ │Cust│       │
│  └────┘ └────┘ └────┘ └────┘ └────┘       │
│                                              │
│  Language: [English ▾]                       │
│  Aspect Ratio: [9:16 ▾]                     │
│  Duration: [60s ▾]                           │
│                                              │
│                         [Continue →]         │
└──────────────────────────────────────────────┘
```

**Step 2: Story Input** — Text area + input mode selector
**Step 3: Genre & Tone** — Genre chips + tone sliders

---

## Screen 3: Project View (Main Workspace)

**Purpose:** The primary workspace — shows current stage and all production steps

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  ← Projects  │  "Revenge of the Lost Heir"  │  ⚙  Credits: 42  │
├──────────────┼───────────────────────────────────────────────┤
│              │                                               │
│  STAGES      │  ┌─ CURRENT STAGE: Script ──────────────────┐│
│              │  │                                           ││
│  ✓ Story     │  │  [Main content area changes per stage]   ││
│  ◉ Script    │  │                                           ││
│  ○ Characters│  │  Scene 1 — INT. APARTMENT — MORNING      ││
│  ○ Locations │  │                                           ││
│  ○ Storyboard│  │  MAYA enters, looking tired. She checks  ││
│  ○ Video     │  │  her phone and sees a message.            ││
│  ○ Audio     │  │                                           ││
│  ○ Subtitles │  │  MAYA: "After all these years..."         ││
│  ○ Assembly  │  │                                           ││
│  ○ Export    │  │  [Scene 2] [Scene 3] [+ Add Scene]       ││
│              │  │                                           ││
│  ────────    │  └───────────────────────────────────────────┘│
│  Characters  │                                               │
│  [Maya]      │  ┌─ AI Assistant ───────────────────────────┐│
│  [Daniel]    │  │ "Script looks good. I suggest adding a   ││
│              │  │  stronger hook in Scene 1 opening."      ││
│  Locations   │  │  [Apply] [Dismiss] [Show me]             ││
│  [Apartment] │  └───────────────────────────────────────────┘│
│  [Office]    │                                               │
│              │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

**Components:**
- Left sidebar: Stage progress (vertical stepper), Character/Location quick-access panels
- Main content: Stage-specific workspace (changes based on active stage)
- Bottom panel: AI Assistant suggestions (collapsible)
- Top bar: Project title, settings, credit counter

**User Interactions:**
- Click stage in sidebar → Navigate to that stage (if unlocked)
- Click character/location in sidebar → Open detail panel
- Interact with stage-specific content (see below)

**AI Interactions:**
- AI Assistant offers contextual suggestions per stage
- Review Agent runs in background and surfaces issues

---

## Screen 4: Story/Outline View

**Purpose:** Beat sheet editor with dramatic arc visualization

**Layout:**
```
┌────────────────────────────────────────────────┐
│  STORY OUTLINE                   [✨ Optimize] │
├────────────────────────────────────────────────┤
│                                                │
│  Emotional Arc:                                │
│  ┌──────────────────────────────────┐         │
│  │    ╱╲         ╱╲                 │  ← intensity graph
│  │   ╱  ╲       ╱  ╲    ╱╲         │
│  │  ╱    ╲     ╱    ╲  ╱  ╲        │
│  │ ╱      ╲   ╱      ╲╱    ╲       │
│  │╱        ╲_╱              ╲___   │
│  └──────────────────────────────────┘         │
│   Hook  Setup  Conflict  Climax  Cliff        │
│                                                │
│  Beat 1: HOOK                    [drag handle] │
│  ┌────────────────────────────────────┐       │
│  │ Maya receives a mysterious letter  │       │
│  │ revealing her true identity.       │       │
│  │ [Emotion: Shock] [Duration: ~5s]   │       │
│  │ [Edit] [Delete] [Split]            │       │
│  └────────────────────────────────────┘       │
│                                                │
│  Beat 2: SETUP                   [drag handle] │
│  ┌────────────────────────────────────┐       │
│  │ Flashback to Maya's childhood in   │       │
│  │ the orphanage...                   │       │
│  └────────────────────────────────────┘       │
│                                                │
│  [+ Add Beat]                                  │
│                                                │
│                    [← Back] [Generate Script →] │
└────────────────────────────────────────────────┘
```

---

## Screen 5: Script Editor

**Purpose:** Full screenplay editor with inline AI assistance

**Layout:** Screenplay-formatted editor with:
- Scene headers (auto-formatted)
- Character name blocks (color-coded)
- Dialogue blocks with emotion tags
- Action/description lines
- Scene duration sidebar
- Inline AI tools: select text → "Rewrite" / "More dramatic" / "Shorter" / "Add subtext"

---

## Screen 6: Character Library

**Purpose:** Create and manage character references

**Layout:**
```
┌──────────────────────────────────────────────────┐
│  CHARACTERS                        [+ New]       │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  [photo] │  │  [photo] │  │  [photo] │      │
│  │  Maya    │  │  Daniel  │  │  Mrs. Chen│      │
│  │  Protag  │  │  Antag   │  │  Support  │      │
│  │  8 scenes│  │  5 scenes│  │  3 scenes │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                  │
│  ═══════════════════════════════════════════════  │
│                                                  │
│  MAYA CHEN — Protagonist                         │
│  ┌────────────────┬──────────────────────────┐  │
│  │ [Front view]   │ Name: Maya Chen           │  │
│  │ [3/4 view]     │ Age: 28                   │  │
│  │ [Profile]      │ Role: Protagonist         │  │
│  │                │ Physical: 5'6", slim,     │  │
│  │ [Regenerate]   │ long black hair, sharp    │  │
│  │ [Upload own]   │ brown eyes                │  │
│  │                │ Personality: Determined,   │  │
│  │ Consistency:   │ strategic, hides emotions │  │
│  │ ████████░ 92%  │ Voice: [Preview ▶]        │  │
│  └────────────────┴──────────────────────────┘  │
│                                                  │
│  Wardrobes:                                      │
│  [Business Suit] [Casual] [Disguise] [+ Add]     │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## Screen 7: Storyboard View

**Purpose:** Visual shot-by-shot planning and key frame generation

**Layout:**
```
┌────────────────────────────────────────────────────┐
│  STORYBOARD — Episode 1              [Grid] [Strip]│
├────────────────────────────────────────────────────┤
│                                                    │
│  Scene 1: INT. APARTMENT — MORNING                 │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐             │
│  │[img] │ │[img] │ │[img] │ │[img] │             │
│  │Shot 1│ │Shot 2│ │Shot 3│ │Shot 4│             │
│  │Wide  │ │CU    │ │Med   │ │CU    │             │
│  │3s    │ │4s    │ │5s    │ │3s    │             │
│  └──────┘ └──────┘ └──────┘ └──────┘             │
│                                                    │
│  Scene 2: INT. OFFICE — NIGHT                      │
│  ┌──────┐ ┌──────┐ ┌──────┐                      │
│  │[img] │ │[img] │ │[img] │                      │
│  │Shot 1│ │Shot 2│ │Shot 3│                      │
│  │Med   │ │OTS   │ │CU    │                      │
│  │4s    │ │5s    │ │3s    │                      │
│  └──────┘ └──────┘ └──────┘                      │
│                                                    │
│  ═══ Selected Shot ════════════════════════════    │
│  ┌──────────────┬────────────────────────────┐    │
│  │  [keyframe]  │ Camera: Close-up            │    │
│  │              │ Character: Maya              │    │
│  │              │ Action: Eyes narrow           │    │
│  │              │ Expression: Determined        │    │
│  │              │ Duration: [3s ◄►]            │    │
│  │  [Regen]     │ Dialogue: "You thought..."   │    │
│  │  [Variations]│ Transition: [Cut ▾]          │    │
│  └──────────────┴────────────────────────────┘    │
│                                                    │
│  Timeline: ═══╪═══╪════╪═══╪════╪═══╪═══ 30s    │
│                                                    │
│                     [← Back] [Generate Video →]    │
└────────────────────────────────────────────────────┘
```

---

## Screen 8: Video Generation View

**Purpose:** Generate, review, and approve video clips

**Layout:**
```
┌────────────────────────────────────────────────────┐
│  VIDEO GENERATION                  Progress: 7/12  │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────────────┐     │
│  │                                          │     │
│  │         [Video Preview Player]           │     │
│  │         Currently: Shot 3.2              │     │
│  │                                          │     │
│  │  ◄  ▶  ►|   0:03 / 0:04                │     │
│  └──────────────────────────────────────────┘     │
│                                                    │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐      │
│  │ ✓  │ │ ✓  │ │ ◉  │ │ ○  │ │ ○  │ │ ○  │      │
│  │S1.1│ │S1.2│ │S2.1│ │S2.2│ │S2.3│ │S3.1│      │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘      │
│                                                    │
│  Shot 2.1 — Medium Shot                           │
│  Consistency: ████████░░ 85%                      │
│  [✓ Approve] [↻ Regenerate] [✎ Edit Prompt]      │
│                                                    │
│  Credits remaining: 38  |  Est. cost: 12 credits  │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## Screen 9: Audio Studio

**Purpose:** Voice generation, music selection, and audio mixing

**Layout:**
```
┌────────────────────────────────────────────────────┐
│  AUDIO STUDIO                                      │
├────────────────────────────────────────────────────┤
│                                                    │
│  Characters & Voices:                              │
│  ┌────────────────────────────────────────┐        │
│  │ Maya  → [Voice: Aria ▾] [▶ Preview]   │        │
│  │ Daniel → [Voice: Adam ▾] [▶ Preview]  │        │
│  └────────────────────────────────────────┘        │
│                                                    │
│  Script Lines:                                     │
│  ┌────────────────────────────────────────┐        │
│  │ MAYA: "After all these years..."      │        │
│  │ [Emotion: Bitter ▾] [▶] [↻]          │        │
│  │────────────────────────────────────────│        │
│  │ DANIEL: "Maya... how did you..."      │        │
│  │ [Emotion: Fearful ▾] [▶] [↻]         │        │
│  └────────────────────────────────────────┘        │
│                                                    │
│  Background Music:                                 │
│  [Browse Library] [AI Generate]                    │
│  Now: "Dark Tension Strings" [▶] Vol: ████░ 60%   │
│                                                    │
│  Timeline:                                         │
│  Dialogue ═══█░░░█████░░░████═══                  │
│  Music    ═══════════════════════                  │
│  SFX      ═══░░░░░░█░░░░░░░░═══                  │
│                                                    │
│                     [← Back] [Continue →]          │
└────────────────────────────────────────────────────┘
```

---

## Screen 10: Assembly / Timeline Editor

**Purpose:** Final assembly with full timeline control

**Layout:** Standard NLE (non-linear editor) layout:
- Video preview (top center)
- Multi-track timeline (bottom): Video, Dialogue, Music, SFX, Subtitles
- Clip properties panel (right)
- Transition selector between clips
- Playback controls with frame stepping

---

## Screen 11: Export Screen

**Purpose:** Render and download final video

**Layout:**
```
┌────────────────────────────────────────────────────┐
│  EXPORT                                            │
├────────────────────────────────────────────────────┤
│                                                    │
│  Platform Presets:                                  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│  │ TikTok │ │ YT     │ │ Reels  │ │ Custom │     │
│  │ 9:16   │ │ Shorts │ │ 9:16   │ │        │     │
│  │ 1080p  │ │ 9:16   │ │ 1080p  │ │        │     │
│  └────────┘ └────────┘ └────────┘ └────────┘     │
│                                                    │
│  Quality: [720p] [1080p*] [2K] [4K]               │
│                                                    │
│  Thumbnail:                                        │
│  ┌────┐ ┌────┐ ┌────┐ [Upload custom]             │
│  │ T1 │ │ T2 │ │ T3 │                             │
│  └────┘ └────┘ └────┘                             │
│                                                    │
│  Metadata:                                         │
│  Title: [_________________________]                │
│  Description: [___________________]                │
│  Hashtags: [#drama #ai #revenge ...]               │
│                                                    │
│  Est. credits: 4        [Export Video]              │
│                                                    │
│  ── Export History ──                               │
│  EP1_TikTok_1080p.mp4  [↓ Download] 2m ago        │
│  EP1_YTShorts_1080p.mp4 [↓ Download] 5m ago       │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## Screen 12: Settings

**Purpose:** User preferences, account, defaults

**Sections:**
- Account & Billing (plan, credits, payment)
- Default Project Settings (art style, language, aspect ratio, duration)
- Voice Preferences (default voice library, custom voices)
- AI Preferences (auto-optimize on/off, quality vs speed)
- Export Defaults (platform, resolution)
- API Keys (for custom model integration)
- Notification Preferences

---

# PHASE 7: SCALABILITY

## 7.1 Single Creators

**Needs:** Simple workflow, affordable credits, quick results
**Design:**
- Default "guided mode" walks through each stage sequentially
- AI makes most decisions; creator reviews and approves
- Low credit cost per episode (8-15 credits for a 60s episode)
- Templates for common genres to reduce setup time

## 7.2 Small Teams (2-5 people)

**Needs:** Collaboration, role separation, shared assets
**Design:**
- Team workspaces with role-based access:
  - **Writer**: Story + Script stages
  - **Art Director**: Characters + Locations + Storyboard stages
  - **Editor**: Audio + Assembly + Export stages
  - **Producer**: All stages + project management
- Shared character/location libraries across team projects
- Comment threads on any asset (shot, scene, character)
- Version history with diff view
- Real-time presence indicators (who's working on what)

## 7.3 Agencies (5-20 people)

**Needs:** Client management, brand consistency, volume production, reporting
**Design:**
- Multi-workspace: one workspace per client/brand
- Brand kits: locked art style, color palette, voice, music style per brand
- Template library: agency-wide reusable templates
- Approval workflows: creator → reviewer → client
- Usage analytics: credits per project, per client, per team member
- Batch operations: generate all episodes in a series sequentially
- White-label export (remove platform branding)
- Client preview links (share without login)

## 7.4 Large-Scale Content Factories (20+ people)

**Needs:** Automation, API access, pipeline integration, massive throughput
**Design:**
- **Full API access**: Every operation available via REST/GraphQL API
- **Webhook events**: Get notified on generation completion, review flags, export ready
- **Queue management**: Priority queues, concurrent generation limits, scheduling
- **Bulk operations**: Upload 100 scripts → generate all automatically
- **CI/CD-style pipelines**: Define production pipeline as config, run unattended
- **Asset CDN**: Generated assets served from edge CDN for global teams
- **Analytics dashboard**: Production velocity, quality scores, credit efficiency
- **Custom model integration**: Bring-your-own model (LoRA, fine-tuned checkpoints)
- **Multi-language factory**: Same script → auto-translate → generate in 10 languages
- **SLA guarantees**: Guaranteed generation time, uptime, support response

## 7.5 Scaling Architecture

```
                    ┌─────────────┐
                    │   CDN Edge  │
                    │   (Assets)  │
                    └──────┬──────┘
                           │
┌─────────┐    ┌──────────┴──────────┐    ┌──────────────┐
│ Web App │────│    API Gateway      │────│  Auth / IAM  │
│ (React) │    │  (Rate limit, Auth) │    └──────────────┘
└─────────┘    └──────────┬──────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
       ┌──────┴──┐  ┌─────┴────┐  ┌──┴───────┐
       │ Project │  │Generation│  │ Export   │
       │ Service │  │ Service  │  │ Service  │
       └────┬────┘  └────┬─────┘  └────┬─────┘
            │            │             │
       ┌────┴────┐  ┌────┴─────┐  ┌───┴──────┐
       │ SQLite/ │  │  Job     │  │  FFmpeg  │
       │ Postgres│  │  Queue   │  │  Workers │
       └─────────┘  └────┬─────┘  └──────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         ┌────┴───┐ ┌───┴────┐ ┌───┴───┐
         │ Image  │ │ Video  │ │ Audio │
         │ Gen    │ │ Gen    │ │ Gen   │
         │ Worker │ │ Worker │ │ Worker│
         └────────┘ └────────┘ └───────┘
```

---

# PHASE 8: IMPROVEMENTS

## 8.1 Features That Would Surpass Topview Drama Studio

### 1. Character Memory System

**Problem Topview has:** Characters are visually consistent within a project but don't learn or evolve.

**Improvement:** Characters remember their history across episodes.
- Track emotional state changes across episodes
- Character development arcs (personality shifts over time)
- Wardrobe progression (outfit changes reflecting story development)
- Aging/appearance changes for long series
- Relationship evolution tracking

### 2. Story Memory & World Bible

**Problem:** Each episode is somewhat isolated; no persistent world state.

**Improvement:** Automatic "world bible" that tracks:
- All established facts (character backstories, location details, plot events)
- Continuity checker: flag contradictions with previously established facts
- "Previously on..." auto-generated recaps from world state
- Plot thread tracker: which storylines are open/resolved

### 3. Scene Consistency Engine

**Problem:** AI generates visually different environments between shots of the same location.

**Improvement:**
- Location "fingerprint" beyond reference images — locked lighting, camera perspective angles, prop positions
- Shot-to-shot transition coherence (if character walks left in shot A, they should enter from right in shot B)
- Time-of-day consistency within scenes
- Weather/atmosphere persistence

### 4. Automatic Prompt Optimization

**Problem:** Users have to manually adjust prompts when generation quality is low.

**Improvement:**
- AI analyzes failed generations and automatically adjusts prompts
- Learn from user regeneration patterns (what they accept vs reject)
- A/B test prompt variations and learn which structures produce better results
- Per-model prompt optimization (different strategies for Seedance vs GPT Image)

### 5. Viral Drama Prediction

**Problem:** No way to know if content will perform well before publishing.

**Improvement:**
- Train on viral short drama patterns (hook strength, emotional arc, cliffhanger impact)
- Score each episode's predicted engagement before export
- Suggest specific improvements: "Strengthen hook in first 3 seconds" or "Add more dramatic pause before reveal"
- A/B thumbnail testing with engagement prediction

### 6. Engagement Scoring Engine

**Improvement:**
- Scene-by-scene attention prediction (where viewers will drop off)
- Pacing analysis: flag scenes that are too slow or too rushed
- Emotion curve analysis: compare to proven engagement patterns
- Platform-specific scoring (what works on TikTok vs YouTube Shorts)

### 7. AI Director Mode (Full Autopilot)

**Problem:** Topview still requires user review at each stage.

**Improvement:**
- "One-click episode" mode: input idea → AI handles all stages → delivers finished video
- Director Agent makes all creative decisions autonomously
- User only reviews final output (with option to drill into any stage)
- Configurable autonomy levels:
  - **Full Auto**: Idea → finished video, no intervention
  - **Checkpoints**: AI pauses at story, storyboard, and final assembly for approval
  - **Guided**: Current Topview-like flow with per-stage review

### 8. One-Click Episode Generation

**Improvement:**
- Series mode: Define series concept + episode count → AI generates all episodes
- Maintains cross-episode continuity automatically
- Batch generation with parallel processing
- "Generate while I sleep" — queue entire series overnight

### 9. Multi-Language Localization Factory

**Problem:** Each language requires separate production.

**Improvement:**
- Generate script in one language → auto-translate to 20+ languages
- Language-specific voice generation with lip-sync awareness
- Cultural adaptation (not just translation — modify references, humor, idioms)
- Per-language subtitle generation
- One-click export all languages

### 10. Interactive Story Branching

**Improvement:**
- Create branching narratives (choose-your-own-adventure)
- AI generates multiple story paths from decision points
- Export as interactive video (YouTube end-screen choices) or linear versions of each path
- Audience voting: publish poll → most voted path gets produced next

### 11. Style Transfer & Remix

**Improvement:**
- Take an existing episode → re-render in a different art style
- "Remix" mode: same story, different visual interpretation
- Style consistency lock: ensure every frame matches the selected style reference
- Custom style training: upload 10-20 reference images → create custom art style

### 12. Real-Time Collaboration Canvas

**Improvement:**
- Figma-like real-time collaborative storyboard canvas
- Multiple team members can work on different scenes simultaneously
- Live cursor visibility and conflict resolution
- Comment threads on specific shots/frames
- Version branching (try different creative directions in parallel)

### 13. Smart Re-Generation

**Improvement:**
- When user regenerates one shot, automatically check if adjacent shots need updating for continuity
- "Ripple regeneration": change a character's outfit → auto-flag all shots with that character for update
- Selective regeneration: change only the character in a shot while keeping the background

### 14. Performance Analytics Dashboard

**Improvement (post-publish):**
- Connect to TikTok/YouTube/Instagram APIs
- Track actual performance of published episodes
- Correlate production decisions with engagement metrics
- AI learns from performance data to improve future recommendations
- "What worked" reports: identify which creative patterns drove views/engagement

### 15. Voice Cloning & Custom Characters

**Improvement:**
- Clone a voice from a sample (with consent)
- Create fully custom character voices
- Emotional range expansion: train voice on different emotional states
- Singing/rapping voice generation for musical drama

### 16. Sound Design AI

**Improvement:**
- Auto-generate contextual sound effects from scene descriptions
- Foley generation: footsteps, door sounds, ambient noise matched to location
- Dynamic music generation that adapts to emotional arc in real-time
- Audio transitions between scenes (cross-fade, stinger, silence)

### 17. Thumbnail & Hook Optimizer

**Improvement:**
- Generate 10 thumbnail variants per episode
- A/B test thumbnails with engagement prediction
- Auto-generate "hook variants" — 3-5 different opening moments to test
- Platform-specific thumbnail optimization (TikTok cover vs YouTube thumbnail)

### 18. IP Protection & Watermarking

**Improvement:**
- Invisible watermarking in generated videos
- Content fingerprinting for piracy detection
- License management for generated characters/stories
- Export with/without watermark based on plan

### 19. Community Template Marketplace

**Improvement:**
- Creators share project templates (story structures, character archetypes, style presets)
- Rating and review system
- Revenue sharing for popular templates
- Genre-specific template collections
- "Fork" a template to customize

### 20. Offline / Local Generation

**Improvement:**
- Desktop app with local generation capabilities
- Use local GPU for image/video generation
- Cloud sync for collaboration features
- Hybrid mode: light tasks local, heavy tasks cloud
- Privacy-sensitive content stays on-device

---

## 8.2 Competitive Advantage Summary

| Capability | Topview | Our System |
|-----------|---------|------------|
| Story → Video | Yes (guided) | Yes + Full Autopilot mode |
| Character Consistency | Reference-based | Reference + embedding + cross-episode memory |
| Multi-episode | Yes | Yes + automatic continuity + world bible |
| Collaboration | No | Real-time multi-user + roles + approvals |
| Analytics | No | Engagement prediction + post-publish tracking |
| Localization | Manual | One-click 20+ language factory |
| API Access | Limited | Full REST/GraphQL + webhooks + CI/CD |
| Customization | Preset styles | Custom style training + voice cloning |
| Intelligence | Generate & review | Learn from user behavior + performance data |
| Scale | Single creator | Single → Agency → Content Factory |

---

## Appendix A: Credit Cost Estimation

| Operation | Est. Credits |
|-----------|-------------|
| Story outline generation | 1 |
| Script generation (per episode) | 2 |
| Character reference (3 views) | 3 |
| Location reference (2 views) | 2 |
| Storyboard key frame | 1 per shot |
| Video clip (4s, 720p) | 4 |
| Video clip (4s, 1080p) | 6 |
| Voice generation (per minute) | 2 |
| Music generation (per minute) | 2 |
| Final export render | 2 |
| **Total 60s episode (~12 shots)** | **~50-70 credits** |

## Appendix B: Technology Considerations

This PRD is intentionally **technology-agnostic**. Implementation could use:

- **Video Generation**: Seedance 2.0, Kling, Runway Gen-3, Veo 3, Sora, or local models
- **Image Generation**: GPT Image 2, FLUX, SDXL, Midjourney API, or local models
- **Voice**: ElevenLabs, Edge-TTS, Bark, or custom fine-tuned models
- **LLM**: Claude, GPT-4, Gemini, or local models for agent orchestration
- **Database**: SQLite (local), PostgreSQL (cloud), or hybrid
- **Frontend**: React, Next.js, or native desktop (Electron/Tauri)
- **Backend**: Node.js/Express, Python/FastAPI, or Go
- **Video Processing**: FFmpeg (current stack), Remotion, or cloud encoding

The existing VideoCloudAI monorepo (Express 5 + React 18 + SQLite + FFmpeg) is a viable foundation for Phase 1 implementation.
