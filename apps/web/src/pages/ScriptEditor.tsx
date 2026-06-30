import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { videosApi, scriptApi, settingsApi, musicApi, ttsApi } from '../lib/api';
import { Lightbulb } from 'lucide-react';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { Wand2, Play, RotateCcw, FileText, Clock, Sparkles, ChevronDown, ChevronUp, AlertCircle, Music, Search, Check, X, Zap, Mic, Volume2 } from 'lucide-react';
import type { VideoFormat, VideoDuration, SceneLine } from '@videocloudai/shared';
import { clsx } from 'clsx';

const DEFAULT_PROMPTS: Record<string, Record<string, string>> = {
  short: {
    en: `You are a scriptwriter for short-form cinematic social media videos.
Write a narration script for a {duration}-second video about: {topic}

Rules:
- Write in short, powerful sentences (each sentence will become one scene)
- Use vivid, visual language that can be shown cinematically
- Each sentence should be 10-20 words maximum
- Aim for {scenes} sentences total based on the duration
- Style: cinematic, emotional, storytelling
- No brackets, no stage directions, no scene numbers, no formatting
- Output ONLY the script text, nothing else — no intro, no explanation`,

    vi: `Bạn là người viết kịch bản cho các video mạng xã hội dạng ngắn phong cách điện ảnh.
Viết kịch bản thuyết minh cho video {duration} giây về chủ đề: {topic}

Quy tắc:
- Viết bằng các câu ngắn gọn, mạnh mẽ (mỗi câu sẽ trở thành một cảnh)
- Dùng ngôn ngữ hình ảnh, sống động, có thể thể hiện bằng hình ảnh điện ảnh
- Mỗi câu tối đa 15-25 từ
- Nhắm tới {scenes} câu dựa trên thời lượng
- Phong cách: điện ảnh, cảm xúc, kể chuyện
- Không có dấu ngoặc, không có hướng dẫn sân khấu, không số cảnh, không định dạng
- Chỉ xuất văn bản kịch bản, không có gì khác — không mở đầu, không giải thích`,
  },
  long: {
    en: `You are a scriptwriter for long-form cinematic YouTube videos.
Write a narration script for a {duration}-second ({minutes}-minute) video about: {topic}

Rules:
- Write in short, powerful sentences (each sentence will become one scene)
- Use vivid, visual language that can be shown cinematically
- Each sentence should be 10-25 words maximum
- Aim for {scenes} sentences total to fill {minutes} minutes
- Structure the video with a clear intro, main content sections, and conclusion
- Style: cinematic, educational, storytelling
- No brackets, no stage directions, no scene numbers, no formatting
- Output ONLY the script text, nothing else — no intro, no explanation`,

    vi: `Bạn là người viết kịch bản cho các video YouTube dài phong cách điện ảnh.
Viết kịch bản thuyết minh cho video {duration} giây ({minutes} phút) về chủ đề: {topic}

Quy tắc:
- Viết bằng các câu ngắn gọn, mạnh mẽ (mỗi câu sẽ trở thành một cảnh)
- Dùng ngôn ngữ hình ảnh, sống động, có thể thể hiện bằng hình ảnh điện ảnh
- Mỗi câu tối đa 15-30 từ
- Nhắm tới {scenes} câu để lấp đầy {minutes} phút
- Cấu trúc video với phần mở đầu, nội dung chính và kết luận rõ ràng
- Phong cách: điện ảnh, giáo dục, kể chuyện
- Không có dấu ngoặc, không có hướng dẫn sân khấu, không số cảnh, không định dạng
- Chỉ xuất văn bản kịch bản, không có gì khác — không mở đầu, không giải thích`,
  },
};

function isLongForm(fmt: VideoFormat): boolean {
  return fmt === 'youtube';
}

function getLocalPrompt(lang: string, format: VideoFormat): string {
  const category = isLongForm(format) ? 'long' : 'short';
  return DEFAULT_PROMPTS[category][lang] ?? DEFAULT_PROMPTS[category].en;
}

function formatDurationLabel(seconds: number): string {
  if (seconds < 120) return `${seconds}s`;
  return `${seconds / 60}m`;
}

const MUSIC_MOODS = [
  { value: 'dramatic',    labelKey: 'editor.moodDramatic' },
  { value: 'energetic',   labelKey: 'editor.moodEnergetic' },
  { value: 'hopeful',     labelKey: 'editor.moodHopeful' },
  { value: 'calm',        labelKey: 'editor.moodCalm' },
  { value: 'uplifting',   labelKey: 'editor.moodUplifting' },
  { value: 'sad',         labelKey: 'editor.moodSad' },
  { value: 'mysterious',  labelKey: 'editor.moodMysterious' },
  { value: 'romantic',    labelKey: 'editor.moodRomantic' },
  { value: 'dark',        labelKey: 'editor.moodDark' },
  { value: 'tense',       labelKey: 'editor.moodTense' },
  { value: 'melancholic', labelKey: 'editor.moodMelancholic' },
  { value: 'euphoric',    labelKey: 'editor.moodEuphoric' },
];

const TEMPLATES = [
  {
    id: 'motivation',
    label: 'Motivation',
    script:
      "Most people wait too long. They think the perfect moment will come. But the truth is, the moment is now. Stop waiting. Start moving. The only thing standing between you and your dream is the decision to begin.",
  },
  {
    id: 'storytelling',
    label: 'Storytelling',
    script:
      "There was a time when everything felt impossible. When every door seemed closed. But one decision changed everything. One step forward became the beginning of something no one expected.",
  },
  {
    id: 'aesthetic',
    label: 'Aesthetic',
    script:
      "Rainy nights and city lights. The world moves fast but some moments stay still. Find your quiet in the chaos. This is what it feels like to be alive.",
  },
];

const SHORT_DURATIONS: { value: VideoDuration; label: string }[] = [
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 45, label: '45s' },
  { value: 60, label: '60s' },
];

const LONG_DURATIONS: { value: VideoDuration; label: string }[] = [
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 180, label: '3m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
];

const FORMATS: { value: VideoFormat; labelKey: string; label: string }[] = [
  { value: 'tiktok', labelKey: 'scriptEditor.formatTikTok', label: 'TikTok' },
  { value: 'youtube-shorts', labelKey: 'scriptEditor.formatYTShorts', label: 'YT Shorts' },
  { value: 'instagram-reels', labelKey: 'scriptEditor.formatReels', label: 'Reels' },
  { value: 'youtube', labelKey: 'scriptEditor.formatYouTube', label: 'YouTube' },
];

export function ScriptEditor() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [format, setFormat] = useState<VideoFormat>('tiktok');
  const [duration, setDuration] = useState<VideoDuration>(30);
  const [narrationEnabled, setNarrationEnabled] = useState(true);
  const [narrationVoice, setNarrationVoice] = useState('');
  const [narrationRate, setNarrationRate] = useState('+0%');
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [voicePreviewing, setVoicePreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicMood, setMusicMood] = useState('dramatic');
  const [selectedTrackPath, setSelectedTrackPath] = useState<string | null>(null);
  const [selectedTrackName, setSelectedTrackName] = useState<string | null>(null);
  const [musicSearchResults, setMusicSearchResults] = useState<Array<{ id: string; name: string; artist_name: string; duration: number; audio: string; audiodownload: string; image: string; shareurl: string }>>([]);
  const [musicSearching, setMusicSearching] = useState(false);
  const [downloadingTrackId, setDownloadingTrackId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SceneLine[]>([]);
  const [hooks, setHooks] = useState<string[]>([]);
  const [generatingHooks, setGeneratingHooks] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(() => getLocalPrompt(i18n.language, 'tiktok'));
  const promptUserEdited = useRef(false);

  const createMutation = useMutation({
    mutationFn: videosApi.create,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      navigate(`/editor?video=${project.id}`);
    },
  });

  // Load stored custom prompt from Settings (one-time, on mount)
  const { data: storedPrompt } = useQuery({
    queryKey: ['script', 'stored-prompt'],
    queryFn: () => scriptApi.defaultPrompt(),
    staleTime: Infinity,
  });

  // Apply stored prompt once on mount (if admin set a custom one in Settings)
  useEffect(() => {
    if (storedPrompt && storedPrompt !== DEFAULT_PROMPTS.short.en && storedPrompt !== DEFAULT_PROMPTS.short.vi && storedPrompt !== DEFAULT_PROMPTS.long.en && storedPrompt !== DEFAULT_PROMPTS.long.vi) {
      setSystemPrompt(storedPrompt);
      promptUserEdited.current = true;
    }
  }, [storedPrompt]);

  // Immediately switch prompt when site language or format changes (unless user edited it)
  useEffect(() => {
    if (!promptUserEdited.current) {
      setSystemPrompt(getLocalPrompt(i18n.language, format));
    }
  }, [i18n.language, format]);

  // When switching format category, adjust duration to a valid value
  useEffect(() => {
    const longForm = isLongForm(format);
    if (longForm && duration < 60) {
      setDuration(120);
    } else if (!longForm && duration > 60) {
      setDuration(30);
    }
  }, [format]);

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const { data: ttsData } = useQuery({
    queryKey: ['tts', 'voices'],
    queryFn: ttsApi.voices,
  });

  const voices = ttsData?.voices;
  const ttsLanguages = ttsData?.languages ?? {};

  // Group voices by language
  const voicesByLang = voices
    ? Object.entries(voices).reduce<Record<string, [string, { lang: string; label: string; flag: string }][]>>((acc, entry) => {
        const lang = entry[1].lang;
        if (!acc[lang]) acc[lang] = [];
        acc[lang].push(entry);
        return acc;
      }, {})
    : {};

  const selectedVoice = narrationVoice || settingsData?.default_voice || 'en-US-GuyNeural';

  const handlePreviewVoice = async () => {
    setVoicePreviewing(true);
    try {
      if (voicePreviewUrl) {
        URL.revokeObjectURL(voicePreviewUrl);
        setVoicePreviewUrl(null);
      }
      const blob = await ttsApi.preview({ voice: selectedVoice, rate: narrationRate });
      const url = URL.createObjectURL(blob);
      setVoicePreviewUrl(url);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
      }
    } finally {
      setVoicePreviewing(false);
    }
  };

  const { data: cachedTracks } = useQuery({
    queryKey: ['music', 'cached'],
    queryFn: musicApi.cached,
    enabled: musicEnabled,
  });

  const groqConfigured = Boolean(settingsData?.groq_api_key?.length);

  const generateMutation = useMutation({
    mutationFn: () => scriptApi.generate(aiTopic, duration, systemPrompt || undefined),
    onSuccess: (generated) => {
      setScript(generated);
      if (!title) setTitle(aiTopic);
    },
  });

  const previewScenes = async () => {
    if (!script.trim()) return;
    // Client-side scene preview using simple sentence split
    const sentences = script
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3);

    const totalSentences = sentences.length;
    const perScene = Math.max(2, Math.floor(duration / totalSentences));

    const scenes: SceneLine[] = sentences.map((line) => ({
      line,
      visual: line.split(' ').slice(0, 4).join(' ').toLowerCase(),
      mood: 'dramatic',
      duration: perScene,
    }));

    setPreview(scenes);
  };

  const handleCreate = () => {
    if (!title.trim() || !script.trim()) return;
    createMutation.mutate({
      title,
      script,
      format,
      duration,
      narrationEnabled,
      narrationVoice: narrationEnabled ? selectedVoice : undefined,
      narrationRate: narrationEnabled ? narrationRate : undefined,
      subtitlesEnabled,
      musicEnabled,
      musicMood: musicEnabled ? musicMood : undefined,
      musicTrackPath: musicEnabled && selectedTrackPath ? selectedTrackPath : undefined,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <TopBar
        title={t('scriptEditor.title')}
        subtitle={t('scriptEditor.subtitle')}
        actions={
          <button
            onClick={handleCreate}
            disabled={!title || !script || createMutation.isPending}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {createMutation.isPending ? <Spinner size="sm" /> : <Play className="w-4 h-4" />}
            {t('scriptEditor.createProject')}
          </button>
        }
      />

      <div className="flex-1 grid grid-cols-2 gap-0 overflow-hidden">
        {/* Left: Input */}
        <div className="flex flex-col border-r border-c-border overflow-auto">
          <div className="p-6 space-y-4">
            {/* AI Script Generation */}
            <div className="border border-accent-glow rounded-xl p-4 bg-accent-muted">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-accent-primary" />
                <span className="text-sm font-medium text-c-text">{t('scriptEditor.generateWithAI')}</span>
                <Badge variant="default" className="text-xs">Groq</Badge>
              </div>

              {!groqConfigured ? (
                <div className="flex items-center gap-2 text-xs text-amber-400 p-2 bg-amber-900/10 rounded-lg border border-amber-800/20">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {t('scriptEditor.groqNotConfigured')}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-c-muted block">{t('scriptEditor.aiTopic')}</label>
                    <input
                      className="input text-sm"
                      placeholder={t('scriptEditor.aiTopicPlaceholder')}
                      value={aiTopic}
                      onChange={(e) => setAiTopic(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && aiTopic.trim() && generateMutation.mutate()}
                    />
                  </div>

                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setShowSystemPrompt((v) => !v)}
                      className="flex items-center gap-1 text-xs text-c-dim hover:text-c-muted transition-colors"
                    >
                      {showSystemPrompt ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {t('scriptEditor.editSystemPrompt')}
                    </button>
                    {showSystemPrompt && (
                      <textarea
                        className="input h-32 resize-y font-mono text-xs mt-2 leading-relaxed"
                        value={systemPrompt}
                        onChange={(e) => { promptUserEdited.current = true; setSystemPrompt(e.target.value); }}
                      />
                    )}
                  </div>

                  <button
                    onClick={() => generateMutation.mutate()}
                    disabled={!aiTopic.trim() || generateMutation.isPending}
                    className="mt-3 btn-primary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  >
                    {generateMutation.isPending ? <Spinner size="sm" /> : <Sparkles className="w-4 h-4" />}
                    {generateMutation.isPending ? t('scriptEditor.generating') : t('scriptEditor.generateScript')}
                  </button>
                </>
              )}
            </div>

            {/* Templates */}
            <div>
              <label className="text-xs text-c-muted uppercase tracking-wider mb-2 block">
                {t('scriptEditor.templates')}
              </label>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => {
                      setScript(tmpl.script);
                      if (!title) setTitle(tmpl.label + ' Video');
                    }}
                    className="btn-ghost text-xs"
                  >
                    {tmpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('scriptEditor.videoTitle')}</label>
              <input
                className="input"
                placeholder={t('scriptEditor.titlePlaceholder')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Script */}
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">
                {t('scriptEditor.narrationScript')}
              </label>
              <textarea
                className={clsx('input resize-none font-mono text-sm leading-relaxed', isLongForm(format) ? 'h-72' : 'h-48')}
                placeholder={t('scriptEditor.scriptPlaceholder')}
                value={script}
                onChange={(e) => setScript(e.target.value)}
              />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-c-dim">
                  {script.split(/\s+/).filter(Boolean).length} {t('scriptEditor.words')}
                </span>
                <div className="flex items-center gap-2">
                  {groqConfigured && script.trim() && (
                    <button
                      onClick={async () => {
                        setGeneratingHooks(true);
                        setHooks([]);
                        try {
                          const result = await scriptApi.generateHooks(script);
                          setHooks(result);
                        } finally {
                          setGeneratingHooks(false);
                        }
                      }}
                      disabled={generatingHooks}
                      className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1 disabled:opacity-50"
                    >
                      {generatingHooks ? <Spinner size="sm" /> : <Zap className="w-3 h-3" />}
                      {generatingHooks ? t('script.generatingHooks') : t('script.generateHooks')}
                    </button>
                  )}
                  <button
                    onClick={() => { setScript(''); setPreview([]); setHooks([]); }}
                    className="text-xs text-c-dim hover:text-c-muted flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {t('scriptEditor.clear')}
                  </button>
                </div>
              </div>

              {/* Hooks panel */}
              {hooks.length > 0 && (
                <div className="mt-3 border border-accent-glow rounded-xl p-3 bg-accent-muted space-y-2">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-accent-primary" />
                    <span className="text-xs font-medium text-c-text">{t('script.hooks')}</span>
                    <button
                      onClick={() => setHooks([])}
                      className="ml-auto text-xs text-c-dim hover:text-c-muted"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {hooks.map((hook, i) => (
                    <div key={i} className="flex items-start gap-2 bg-c-surface border border-c-border rounded-lg p-2.5">
                      <p className="flex-1 text-xs text-c-text leading-relaxed">{hook}</p>
                      <button
                        onClick={() => {
                          // Replace the first sentence/paragraph of the script with this hook
                          const rest = script.replace(/^[^.!?]*[.!?]\s*/, '');
                          setScript(hook + (rest.trim() ? ' ' + rest.trim() : ''));
                          setHooks([]);
                        }}
                        className="shrink-0 text-xs px-2 py-0.5 bg-accent-primary/15 text-accent-hover border border-accent-primary/30 rounded hover:bg-accent-primary/25 transition-colors"
                      >
                        {t('script.useHook')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Settings */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-c-muted mb-1.5 block">{t('scriptEditor.format')}</label>
                <div className="flex gap-1.5 flex-wrap">
                  {FORMATS.map(({ value, labelKey, label }) => (
                    <button
                      key={value}
                      onClick={() => setFormat(value)}
                      className={clsx(
                        'flex-1 min-w-[60px] text-xs py-1.5 rounded-lg border transition-colors',
                        format === value
                          ? 'bg-accent-muted border-accent-primary text-accent-hover'
                          : 'border-c-border text-c-muted hover:border-c-border-hi'
                      )}
                    >
                      {t(labelKey, label)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-c-muted mb-1.5 block">{t('scriptEditor.duration')}</label>
                <div className="flex gap-1.5">
                  {(isLongForm(format) ? LONG_DURATIONS : SHORT_DURATIONS).map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setDuration(value)}
                      className={clsx(
                        'flex-1 text-xs py-1.5 rounded-lg border transition-colors',
                        duration === value
                          ? 'bg-accent-muted border-accent-primary text-accent-hover'
                          : 'border-c-border text-c-muted hover:border-c-border-hi'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 accent-c-accent"
                  checked={narrationEnabled}
                  onChange={(e) => setNarrationEnabled(e.target.checked)}
                />
                <span className="text-xs text-c-muted">{t('scriptEditor.aiNarration')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 accent-c-accent"
                  checked={subtitlesEnabled}
                  onChange={(e) => setSubtitlesEnabled(e.target.checked)}
                />
                <span className="text-xs text-c-muted">{t('scriptEditor.subtitles')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 accent-c-accent"
                  checked={musicEnabled}
                  onChange={(e) => setMusicEnabled(e.target.checked)}
                />
                <span className="text-xs text-c-muted">{t('scriptEditor.music')}</span>
              </label>
            </div>

            {narrationEnabled && voices && (
              <div className="border border-[#22d3ee30] rounded-xl p-3 space-y-3 bg-[#22d3ee08]">
                <div className="flex items-center gap-2">
                  <Mic className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-medium text-c-text">{t('scriptEditor.voiceSettings')}</span>
                </div>

                {/* Voice selector */}
                <div>
                  <label className="text-xs text-c-muted mb-1.5 block">{t('scriptEditor.voice')}</label>
                  <select
                    value={selectedVoice}
                    onChange={(e) => setNarrationVoice(e.target.value)}
                    className="input text-sm w-full"
                  >
                    {Object.entries(voicesByLang).map(([lang, entries]) => (
                      <optgroup key={lang} label={ttsLanguages[lang] ?? lang}>
                        {entries.map(([id, info]) => (
                          <option key={id} value={id}>
                            {info.flag} {info.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Speech rate slider */}
                <div>
                  <label className="text-xs text-c-muted mb-1.5 block">
                    {t('scriptEditor.speechRate')}: {narrationRate}
                  </label>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={5}
                    value={parseInt(narrationRate)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setNarrationRate(val >= 0 ? `+${val}%` : `${val}%`);
                    }}
                    className="w-full accent-cyan-500 h-1.5"
                  />
                  <div className="flex justify-between text-xs text-c-dim mt-0.5">
                    <span>{t('scriptEditor.slower')}</span>
                    <span>{t('scriptEditor.faster')}</span>
                  </div>
                </div>

                {/* Preview button */}
                <button
                  onClick={handlePreviewVoice}
                  disabled={voicePreviewing}
                  className="flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                >
                  {voicePreviewing ? <Spinner size="sm" /> : <Volume2 className="w-3.5 h-3.5" />}
                  {voicePreviewing ? t('scriptEditor.previewing') : t('scriptEditor.previewVoice')}
                </button>
                <audio ref={audioRef} className="hidden" />
              </div>
            )}

            {musicEnabled && (
              <div className="border border-c-border rounded-xl p-3 space-y-3 bg-c-bg">
                <div className="flex items-center gap-2">
                  <Music className="w-3.5 h-3.5 text-pink-400" />
                  <span className="text-xs font-medium text-c-text">{t('scriptEditor.music')}</span>
                  {selectedTrackName && (
                    <div className="ml-auto flex items-center gap-1.5 text-xs text-pink-300 bg-pink-900/20 border border-pink-800/30 rounded-full px-2 py-0.5">
                      <Check className="w-3 h-3" />
                      <span className="max-w-[120px] truncate">{selectedTrackName}</span>
                      <button
                        onClick={() => { setSelectedTrackPath(null); setSelectedTrackName(null); }}
                        className="hover:text-pink-200"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Mood selector */}
                <div>
                  <label className="text-xs text-c-muted mb-1.5 block">{t('scriptEditor.musicMood')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {MUSIC_MOODS.map(({ value, labelKey }) => (
                      <button
                        key={value}
                        onClick={() => { setMusicMood(value); setMusicSearchResults([]); }}
                        className={clsx(
                          'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                          musicMood === value
                            ? 'bg-pink-900/30 border-pink-600/50 text-pink-300'
                            : 'border-c-border text-c-muted hover:border-c-border-hi'
                        )}
                      >
                        {t(labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cached tracks */}
                {cachedTracks && cachedTracks.length > 0 && (
                  <div>
                    <label className="text-xs text-c-muted mb-1.5 block">{t('editor.orSelectTrack')}</label>
                    <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
                      {cachedTracks.map((track) => (
                        <button
                          key={track.id}
                          onClick={() => {
                            if (selectedTrackPath === track.filename) {
                              setSelectedTrackPath(null);
                              setSelectedTrackName(null);
                            } else {
                              setSelectedTrackPath(track.filename);
                              setSelectedTrackName(track.filename.replace(/\.[^.]+$/, ''));
                            }
                          }}
                          className={clsx(
                            'flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border transition-colors text-left',
                            selectedTrackPath === track.filename
                              ? 'bg-pink-900/20 border-pink-600/40 text-pink-300'
                              : 'border-c-border text-c-muted hover:border-c-border-hi'
                          )}
                        >
                          <span className="truncate">{track.filename.replace(/\.[^.]+$/, '')}</span>
                          <span className="ml-2 shrink-0 text-c-dim">{track.sizeKB} KB</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inline Jamendo search */}
                {settingsData?.jamendo_client_id ? (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="text-xs text-c-muted flex-1">{t('scriptEditor.searchJamendo')}</label>
                      <button
                        onClick={async () => {
                          setMusicSearching(true);
                          setMusicSearchResults([]);
                          try {
                            const r = await musicApi.search(musicMood, 5);
                            setMusicSearchResults(r.tracks);
                          } finally {
                            setMusicSearching(false);
                          }
                        }}
                        disabled={musicSearching}
                        className="flex items-center gap-1 text-xs text-accent-primary hover:text-accent-hover disabled:opacity-50"
                      >
                        {musicSearching ? <Spinner size="sm" /> : <Search className="w-3 h-3" />}
                        {musicSearching ? t('music.searching') : t('common.search')}
                      </button>
                    </div>
                    {musicSearchResults.length > 0 && (
                      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                        {musicSearchResults.map((track) => (
                          <div key={track.id} className="flex items-center gap-2 bg-c-surface border border-c-border rounded-lg px-2.5 py-1.5">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-c-text truncate">{track.name}</div>
                              <div className="text-xs text-c-dim truncate">{track.artist_name} · {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}</div>
                            </div>
                            <button
                              onClick={async () => {
                                setDownloadingTrackId(track.id);
                                try {
                                  const result = await musicApi.download(track);
                                  const filename = result.localPath.split('/').pop()!.split('\\').pop()!;
                                  setSelectedTrackPath(filename);
                                  setSelectedTrackName(track.name);
                                  setMusicSearchResults([]);
                                } finally {
                                  setDownloadingTrackId(null);
                                }
                              }}
                              disabled={downloadingTrackId === track.id}
                              className="shrink-0 btn-secondary text-xs py-0.5 px-2"
                            >
                              {downloadingTrackId === track.id ? <Spinner size="sm" /> : t('music.download')}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-c-dim italic">{t('scriptEditor.jamendoHint')}</div>
                )}
              </div>
            )}

            <button
              onClick={previewScenes}
              disabled={!script}
              className="btn-secondary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              <Wand2 className="w-4 h-4" />
              {t('scriptEditor.previewScenes')}
            </button>
          </div>
        </div>

        {/* Right: Scene preview */}
        <div className="flex flex-col overflow-auto">
          <div className="px-6 py-4 border-b border-c-border">
            <h2 className="text-sm font-medium text-c-text">{t('scriptEditor.scenePreview')}</h2>
            <p className="text-xs text-c-muted mt-0.5">
              {preview.length} {t('scriptEditor.scenes')} · {formatDurationLabel(duration)} {t('scriptEditor.total')}
            </p>
          </div>

          {preview.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <FileText className="w-8 h-8 text-c-dim mb-3" />
              <div className="text-sm text-c-muted">{t('scriptEditor.previewPlaceholder')}</div>
              <div className="text-xs text-c-dim mt-1">
                {t('scriptEditor.writeFirst')}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {preview.map((scene, i) => (
                <div key={i} className="bg-c-surface border border-c-border rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <span className="text-xs font-mono text-c-dim mt-0.5">#{i + 1}</span>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <Badge mood={scene.mood}>{scene.mood}</Badge>
                      <span className="flex items-center gap-1 text-xs text-c-muted">
                        <Clock className="w-3 h-3" />
                        {scene.duration}s
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-c-text leading-relaxed mb-3">"{scene.line}"</p>

                  <div className="flex items-center gap-2 p-2 bg-c-bg rounded-lg">
                    <Wand2 className="w-3 h-3 text-accent-primary shrink-0" />
                    <span className="text-xs text-c-muted italic">{scene.visual}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
