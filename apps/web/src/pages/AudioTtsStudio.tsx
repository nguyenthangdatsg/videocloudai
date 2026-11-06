import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ttsApi, settingsApi } from '../lib/api';
import type { VoiceInfo, TtsEngine, TtsStory } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from '../components/layout/TopBar';
import { Spinner } from '../components/ui/Spinner';
import {
  Mic, Volume2, Download, Play, Pause, Clock, FileAudio,
  Search, SlidersHorizontal, Globe, Trash2, Cpu, Wifi, WifiOff,
  RefreshCw, Settings2, Check, CloudCog, Sparkles, Copy, X,
  BookOpen, Plus, Save, Users,
  ArrowLeft, Music,
} from 'lucide-react';
import { clsx } from 'clsx';

// === Story structure types ===
interface VoiceGroupInfo {
  id: string;
  engine: string;
  voice: string;
  emotion: string;
  rate?: string;
  color: string;
}

interface ParagraphInfo {
  index: number;
  group: string;
  emotion: string;
  pace?: 'slow' | 'fast';
  text: string;
  wordCount: number;
  lineNumber: number;
}

interface ParsedStory {
  title: string;
  voiceGroups: VoiceGroupInfo[];
  paragraphs: ParagraphInfo[];
  totalWords: number;
  estimatedDuration: number;
}

const GROUP_COLORS = [
  '#a78bfa', '#34d399', '#f472b6', '#60a5fa',
  '#fbbf24', '#f87171', '#2dd4bf', '#fb923c',
];

function parseStoryStructure(text: string): ParsedStory | null {
  if (!/^\[VOICE_GROUP:/m.test(text)) return null;

  const voiceGroups: VoiceGroupInfo[] = [];
  const vgRegex = /^\[VOICE_GROUP:\s*(.+?)\]\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = vgRegex.exec(text)) !== null) {
    const parts = m[1].split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const id = parts[0];
    let engine = 'edge-tts', voice = '', emotion = 'default', rate: string | undefined;
    for (let i = 1; i < parts.length; i++) {
      const ci = parts[i].indexOf(':');
      if (ci > 0) {
        const k = parts[i].slice(0, ci).trim().toLowerCase();
        const v = parts[i].slice(ci + 1).trim();
        if (k === 'engine') engine = v;
        else if (k === 'voice') voice = v;
        else if (k === 'emotion') emotion = v;
        else if (k === 'rate') rate = v;
      }
    }
    voiceGroups.push({ id, engine, voice, emotion, rate, color: GROUP_COLORS[voiceGroups.length % GROUP_COLORS.length] });
  }

  let title = 'Untitled Story';
  const paragraphs: ParagraphInfo[] = [];
  const lines = text.split('\n');
  let curGroup = voiceGroups[0]?.id || 'narrator';
  let curEmotion = voiceGroups[0]?.emotion || 'default';
  let curPace: 'slow' | 'fast' | undefined;
  let narrationLines: string[] = [];
  let voiceLineNum = 0;

  const flushParagraph = () => {
    const narr = narrationLines.join(' ').trim();
    if (narr) {
      const wc = narr.split(/\s+/).filter(Boolean).length;
      paragraphs.push({ index: paragraphs.length, group: curGroup, emotion: curEmotion, pace: curPace, text: narr, wordCount: wc, lineNumber: voiceLineNum });
      curPace = undefined;
    }
    narrationLines = [];
  };

  for (let li = 0; li < lines.length; li++) {
    const trimmed = lines[li].trim();
    if (!trimmed) { flushParagraph(); continue; }
    const titleMatch = trimmed.match(/^#\s+(.+)$/);
    if (titleMatch) { title = titleMatch[1].trim(); continue; }
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) continue;
    if (/^\[VOICE_GROUP:/i.test(trimmed)) continue;
    if (/^\[CHARACTER:/i.test(trimmed)) continue;
    if (trimmed === '---') continue;
    const voiceMatch = trimmed.match(/^\[VOICE:\s*(.+?)\]\s*$/i);
    if (voiceMatch) {
      flushParagraph();
      voiceLineNum = li;
      const vParts = voiceMatch[1].split('|').map(s => s.trim());
      for (const p of vParts) {
        const ci = p.indexOf(':');
        if (ci > 0) {
          const k = p.slice(0, ci).trim().toLowerCase();
          const v = p.slice(ci + 1).trim();
          if (k === 'group') curGroup = v;
          else if (k === 'emotion') curEmotion = v;
        }
      }
      continue;
    }
    const paceMatch = trimmed.match(/^\[PACE:\s*(slow|fast)\]\s*$/i);
    if (paceMatch) { curPace = paceMatch[1].toLowerCase() as 'slow' | 'fast'; continue; }
    if (/^\[.+?:.*\]\s*$/.test(trimmed)) continue;
    narrationLines.push(trimmed);
  }
  flushParagraph();

  const totalWords = paragraphs.reduce((s, p) => s + p.wordCount, 0);
  const estimatedDuration = (totalWords / 150) * 60;

  return { title, voiceGroups, paragraphs, totalWords, estimatedDuration };
}

export function AudioTtsStudio() {
  const { t } = useTranslation();

  // --- Text ---
  const [text, setText] = useState('');

  // --- Engine selection ---
  const [engine, setEngine] = useState<TtsEngine>('kokoro');

  // --- Voice selection (per-engine) ---
  const [selectedVoice, setSelectedVoice] = useState('af_heart');
  const [edgeVoice, setEdgeVoice] = useState('en-US-GuyNeural');
  const [kokoroVoice, setKokoroVoice] = useState('af_heart');
  const [langFilter, setLangFilter] = useState('all');


  // --- Voice params ---
  const [rate, setRate] = useState(0);       // -100 to +100
  const [pitch, setPitch] = useState(0);     // -50 to +50 Hz
  const [volume, setVolume] = useState(0);   // -50 to +100
  const [style, setStyle] = useState('');

  // --- Selection ---
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // --- Story Prompt Guide ---
  const [showStoryPrompt, setShowStoryPrompt] = useState(false);

  // --- Story Projects ---
  const [view, setView] = useState<'dashboard' | 'editor'>('dashboard');
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: stories, refetch: refetchStories } = useQuery({
    queryKey: ['tts', 'stories'],
    queryFn: ttsApi.stories,
  });

  // --- Playback ---
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Data ---
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const { data: ttsData } = useQuery({
    queryKey: ['tts', 'voices'],
    queryFn: ttsApi.voices,
  });

  const { data: kokoroVoicesData } = useQuery({
    queryKey: ['tts', 'kokoro', 'voices', 'formatted'],
    queryFn: ttsApi.kokoroVoicesFormatted,
  });

  const { data: omnivoiceHealth } = useQuery({
    queryKey: ['tts', 'omnivoice', 'health'],
    queryFn: ttsApi.omnivoiceHealth,
    refetchInterval: 30_000,
  });

  const { data: kokoroHealth } = useQuery({
    queryKey: ['tts', 'kokoro', 'health'],
    queryFn: ttsApi.kokoroHealth,
    refetchInterval: 30_000,
  });

  const { data: googleTtsHealth } = useQuery({
    queryKey: ['tts', 'google-tts', 'health'],
    queryFn: ttsApi.googleTtsHealth,
    refetchInterval: 30_000,
  });

  const [googleConfigOpen, setGoogleConfigOpen] = useState(false);
  const [googleProjectId, setGoogleProjectId] = useState('');
  const [googleCredentialsJson, setGoogleCredentialsJson] = useState('');
  const [googleCredentialsPath, setGoogleCredentialsPath] = useState('');
  const [googleVoice, setGoogleVoice] = useState('en-US-Neural2-D');
  const [googleSpeakingRate, setGoogleSpeakingRate] = useState(1.0);
  const [googlePitch, setGooglePitch] = useState(0);
  const [googleConfigSaving, setGoogleConfigSaving] = useState(false);
  const [googleConfigMsg, setGoogleConfigMsg] = useState('');
  const [gVoiceLang, setGVoiceLang] = useState('en-US');
  const [gVoiceType, setGVoiceType] = useState('all');
  const [gVoiceGender, setGVoiceGender] = useState('all');
  const [gVoiceSearch, setGVoiceSearch] = useState('');

  const { data: googleConfig, refetch: refetchGoogleConfig } = useQuery({
    queryKey: ['tts', 'google-tts', 'config'],
    queryFn: ttsApi.googleTtsConfig,
    enabled: engine === 'google-tts',
  });

  const { data: googleVoices, isLoading: googleVoicesLoading, refetch: refetchGoogleVoices } = useQuery({
    queryKey: ['tts', 'google-tts', 'voices'],
    queryFn: () => ttsApi.googleTtsVoices(),
    enabled: engine === 'google-tts' && (googleTtsHealth?.healthy ?? false),
  });

  const { data: googleUsage, refetch: refetchGoogleUsage } = useQuery({
    queryKey: ['tts', 'google-tts', 'usage'],
    queryFn: ttsApi.googleTtsUsage,
    enabled: engine === 'google-tts',
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (googleConfig) {
      setGoogleProjectId(googleConfig.projectId);
      setGoogleCredentialsPath(googleConfig.credentialsPath);
      setGoogleVoice(googleConfig.defaultVoice);
      setGoogleSpeakingRate(parseFloat(googleConfig.speakingRate) || 1.0);
      setGooglePitch(parseFloat(googleConfig.pitch) || 0);
    }
  }, [googleConfig]);

  const { data: defaultEngine } = useQuery({
    queryKey: ['tts', 'defaultEngine'],
    queryFn: ttsApi.defaultEngine,
  });

  // Set engine from server default on mount
  useEffect(() => {
    if (defaultEngine) setEngine(defaultEngine);
  }, [defaultEngine]);

  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ['tts', 'history'],
    queryFn: ttsApi.history,
  });

  const edgeVoices = ttsData?.voices ?? {};
  const edgeLanguages = ttsData?.languages ?? {};
  const kokoroVoices = kokoroVoicesData?.voices ?? {};
  const kokoroLanguages = kokoroVoicesData?.languages ?? {};

  // Active voice set depends on engine
  const voices = engine === 'kokoro' ? kokoroVoices : edgeVoices;
  const languages = engine === 'kokoro' ? kokoroLanguages : edgeLanguages;

  // Set default edge voice from settings on mount
  useEffect(() => {
    if (settingsData?.default_voice && settingsData.default_voice in edgeVoices) {
      setEdgeVoice(settingsData.default_voice);
    }
  }, [settingsData?.default_voice, edgeVoices]);

  // Switch displayed voice when engine changes
  useEffect(() => {
    if (engine === 'kokoro') {
      setSelectedVoice(kokoroVoice);
    } else if (engine === 'google-tts') {
      setSelectedVoice(googleVoice);
    } else {
      setSelectedVoice(edgeVoice);
    }
    setLangFilter('all');
    setStyle('');
    setQuotaError('');
  }, [engine]);

  // Keep per-engine voice in sync
  const handleVoiceChange = (v: string) => {
    setSelectedVoice(v);
    if (engine === 'kokoro') setKokoroVoice(v);
    else if (engine === 'google-tts') setGoogleVoice(v);
    else setEdgeVoice(v);
  };

  // Current voice info
  const currentVoice: VoiceInfo | undefined = voices[selectedVoice];
  const availableStyles = currentVoice?.styles ?? [];

  // Reset style when switching to a voice without styles
  useEffect(() => {
    if (style && !availableStyles.includes(style)) {
      setStyle('');
    }
  }, [selectedVoice]);

  // --- Build unique language list with flags ---
  const langList = Object.values(voices).reduce<Record<string, string>>((acc, v) => {
    if (!acc[v.lang]) acc[v.lang] = v.flag;
    return acc;
  }, {});

  // --- Filter voices ---
  const filteredVoices = Object.entries(voices).filter(([id, info]) => {
    if (langFilter !== 'all' && info.lang !== langFilter) return false;

    return true;
  });

  // Group by language
  const groupedVoices: Record<string, [string, VoiceInfo][]> = {};
  for (const entry of filteredVoices) {
    const lang = entry[1].lang;
    if (!groupedVoices[lang]) groupedVoices[lang] = [];
    groupedVoices[lang].push(entry);
  }

  // --- Format params ---
  const fmtRate = rate >= 0 ? `+${rate}%` : `${rate}%`;
  const fmtPitch = pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`;
  const fmtVolume = volume >= 0 ? `+${volume}%` : `${volume}%`;

  // --- Audio controls ---
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (progressTimer.current) clearInterval(progressTimer.current);
    setPlayingUrl(null);
    setAudioProgress(0);
  }, []);

  const startProgressTimer = useCallback(() => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      if (audioRef.current) {
        setAudioProgress(audioRef.current.currentTime);
        setAudioDuration(audioRef.current.duration || 0);
      }
    }, 100);
  }, []);

  const playAudio = useCallback((url: string) => {
    // Same URL: toggle pause/resume
    if (playingUrl === url && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play();
        startProgressTimer();
      } else {
        audioRef.current.pause();
        if (progressTimer.current) clearInterval(progressTimer.current);
      }
      return;
    }
    stopAudio();
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play();
      setPlayingUrl(url);
      startProgressTimer();
    }
  }, [playingUrl, stopAudio, startProgressTimer]);

  const seekFromEvent = useCallback((e: MouseEvent | React.MouseEvent, bar: HTMLDivElement) => {
    if (!audioRef.current || !audioDuration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * audioDuration;
  }, [audioDuration]);

  const handleSeekStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = e.currentTarget;
    seekFromEvent(e, bar);

    const onMove = (ev: MouseEvent) => seekFromEvent(ev, bar);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [seekFromEvent]);

  const handleGoogleSaveConfig = async () => {
    setGoogleConfigSaving(true);
    setGoogleConfigMsg('');
    try {
      await ttsApi.googleTtsSaveConfig({
        projectId: googleProjectId,
        credentialsJson: googleCredentialsJson || undefined,
        credentialsPath: googleCredentialsPath || undefined,
        defaultVoice: googleVoice,
        speakingRate: String(googleSpeakingRate),
        pitch: String(googlePitch),
      });
      setGoogleCredentialsJson('');
      setGoogleConfigMsg(t('tts.googleTtsConfigSaved'));
      refetchGoogleConfig();
      refetchGoogleVoices();
    } catch (err) {
      setGoogleConfigMsg((err as Error).message);
    } finally {
      setGoogleConfigSaving(false);
    }
  };

  const handleGoogleReload = async () => {
    try {
      await ttsApi.googleTtsReload();
      setGoogleConfigMsg(t('tts.googleTtsReloaded'));
      refetchGoogleConfig();
      refetchGoogleVoices();
    } catch (err) {
      setGoogleConfigMsg((err as Error).message);
    }
  };

  // --- Google TTS quota check ---
  const [quotaError, setQuotaError] = useState('');
  const checkGoogleQuota = async (charCount: number): Promise<boolean> => {
    if (engine !== 'google-tts') return true;
    try {
      const result = await ttsApi.googleTtsCheckQuota(selectedVoice, charCount);
      if (!result.allowed) {
        setQuotaError(result.reason || t('tts.googleTtsQuotaExceeded'));
        return false;
      }
      setQuotaError('');
      return true;
    } catch {
      return true; // allow if check fails (server handles final block)
    }
  };

  // --- Preview voice ---
  const handlePreview = async () => {
    // Preview uses ~80 chars sample text — check quota for Google TTS
    const ok = await checkGoogleQuota(100);
    if (!ok) return;

    setPreviewLoading(true);
    try {
      const blob = await ttsApi.preview({
        voice: selectedVoice, rate: fmtRate, pitch: fmtPitch, volume: fmtVolume,
        style: style || undefined, engine,
      });
      const url = URL.createObjectURL(blob);
      // Directly set audio src to avoid stale closure issues with playAudio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = url;
        await audioRef.current.play();
        setPlayingUrl(url);
        startProgressTimer();
      }
    } catch (err) {
      console.error('Voice preview failed:', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  // --- Generate ---
  const [generateProgress, setGenerateProgress] = useState<string[]>([]);
  const progressLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (progressLogRef.current) {
      const el = progressLogRef.current;
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [generateProgress]);
  // Detect story format: has [VOICE_GROUP:] declarations
  const isStoryFormat = /^\[VOICE_GROUP:/m.test(text);

  // --- Parsed story structure (debounced) ---
  const [parsedStory, setParsedStory] = useState<ParsedStory | null>(null);
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    parseTimerRef.current = setTimeout(() => {
      setParsedStory(isStoryFormat ? parseStoryStructure(text) : null);
    }, 300);
    return () => { if (parseTimerRef.current) clearTimeout(parseTimerRef.current); };
  }, [text, isStoryFormat]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      setGenerateProgress([]);
      const onProgress = (step: string, detail?: string) => setGenerateProgress((prev) => [...prev, `[${step}] ${detail ?? ''}`]);

      // Story project mode
      if (isStoryFormat && activeStoryId) {
        // Save content first, then generate
        await ttsApi.updateStory(activeStoryId, { content: text });
        return ttsApi.generateStoryProject(activeStoryId, onProgress);
      }

      // Story mode without project: quick generate
      if (isStoryFormat) {
        return ttsApi.generateStory(text, onProgress);
      }

      // Single voice mode
      const ok = await checkGoogleQuota(text.length);
      if (!ok) throw new Error('quota_blocked');

      return ttsApi.generateStream(
        { text, voice: selectedVoice, rate: fmtRate, pitch: fmtPitch, volume: fmtVolume, style: style || undefined, engine },
        onProgress,
      );
    },
    onSuccess: (data) => {
      refetchHistory();
      refetchStories();
      if (engine === 'google-tts') refetchGoogleUsage();
      playAudio(data.url);
    },
  });

  // --- Delete ---
  const deleteMutation = useMutation({
    mutationFn: (filename: string) => ttsApi.delete(filename),
    onSuccess: () => refetchHistory(),
  });

  const handleDelete = (filename: string, url: string) => {
    if (!confirm(t('tts.confirmDelete'))) return;
    if (playingUrl === url) stopAudio();
    deleteMutation.mutate(filename);
  };

  // --- Selection helpers ---
  const toggleSelect = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!history) return;
    if (selected.size === history.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(history.map((f) => f.filename)));
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(t('tts.confirmBulkDelete', { count: selected.size }))) return;
    stopAudio();
    await Promise.all([...selected].map((filename) => ttsApi.delete(filename)));
    setSelected(new Set());
    refetchHistory();
  };

  const handleBulkDownload = () => {
    if (!history) return;
    for (const file of history) {
      if (selected.has(file.filename)) {
        handleDownload(file.url, file.filename);
      }
    }
  };

  // --- Download ---
  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const openStory = (story: TtsStory) => {
    setActiveStoryId(story.id);
    setText(story.content);
    setView('editor');
  };

  const openQuickTts = () => {
    setActiveStoryId(null);
    setText('');
    setView('editor');
  };

  const backToDashboard = () => {
    setView('dashboard');
  };

  const totalDuration = (stories ?? []).reduce((s, st) => s + st.duration, 0);
  const readyCount = (stories ?? []).filter(s => s.status === 'ready').length;
  const draftCount = (stories ?? []).filter(s => s.status === 'draft').length;

  // ═══════════════════════════════════════════════════════════════
  //  DASHBOARD VIEW
  // ═══════════════════════════════════════════════════════════════
  if (view === 'dashboard') {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <TopBar title={t('tts.title')} subtitle={t('tts.subtitle')} />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-6 space-y-6">

            {/* ── Header actions ── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-c-text">{t('tts.storyProjects')}</h2>
                <span className="text-xs text-c-dim tabular-nums bg-c-elevated px-2 py-0.5 rounded-full">{stories?.length ?? 0}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={openQuickTts}
                  className="btn-secondary flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Mic className="w-4 h-4" />
                  {t('tts.quickTts')}
                </button>
                <button
                  className="btn-secondary flex items-center gap-2 text-sm cursor-pointer"
                  onClick={() => setShowStoryPrompt(true)}
                >
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  {t('tts.storyPrompt')}
                </button>
                <button
                  onClick={() => {
                    ttsApi.createStory({ content: '', title: t('tts.newStoryTitle') }).then((s) => {
                      refetchStories();
                      openStory(s);
                    });
                  }}
                  className="btn-primary flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  {t('tts.newStory')}
                </button>
              </div>
            </div>

            {/* ── Summary strip ── */}
            {stories && stories.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="card p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-900/30 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4.5 h-4.5 text-purple-400" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-c-text tabular-nums">{stories.length}</div>
                    <div className="text-[11px] text-c-dim">{t('tts.totalStories')}</div>
                  </div>
                </div>
                <div className="card p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <Check className="w-4.5 h-4.5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-c-text tabular-nums">{readyCount}</div>
                    <div className="text-[11px] text-c-dim">{t('tts.readyStories')}</div>
                  </div>
                </div>
                <div className="card p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-900/30 flex items-center justify-center shrink-0">
                    <FileAudio className="w-4.5 h-4.5 text-amber-400" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-c-text tabular-nums">{draftCount}</div>
                    <div className="text-[11px] text-c-dim">{t('tts.draftStories')}</div>
                  </div>
                </div>
                <div className="card p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-cyan-900/30 flex items-center justify-center shrink-0">
                    <Clock className="w-4.5 h-4.5 text-cyan-400" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-c-text tabular-nums">{fmtTime(totalDuration)}</div>
                    <div className="text-[11px] text-c-dim">{t('tts.totalDuration')}</div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Story cards grid ── */}
            {stories && stories.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {stories.map((story) => {
                  const voiceCount = (() => { try { return JSON.parse(story.voice_groups || '[]').length; } catch { return 0; } })();
                  return (
                    <div
                      key={story.id}
                      onClick={() => openStory(story)}
                      className="card p-0 cursor-pointer transition-all duration-200 hover:shadow-lg hover:ring-1 hover:ring-purple-500/20 group overflow-hidden"
                    >
                      {/* Card accent bar */}
                      <div className={clsx(
                        'h-1',
                        story.status === 'ready' ? 'bg-emerald-500' :
                        story.status === 'generating' ? 'bg-amber-500 animate-pulse' :
                        story.status === 'failed' ? 'bg-red-500' :
                        'bg-purple-500/30',
                      )} />

                      <div className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <h3 className="font-semibold text-sm text-c-text truncate flex-1 mr-2 group-hover:text-purple-300 transition-colors">{story.title}</h3>
                          <span className={clsx(
                            'text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0',
                            story.status === 'ready' ? 'text-emerald-400 bg-emerald-500/15' :
                            story.status === 'generating' ? 'text-amber-400 bg-amber-500/15 animate-pulse' :
                            story.status === 'failed' ? 'text-red-400 bg-red-500/15' :
                            'text-c-dim bg-c-elevated',
                          )}>{story.status}</span>
                        </div>

                        {/* Meta row */}
                        <div className="flex items-center gap-3 text-xs text-c-dim mb-4">
                          {voiceCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3 text-purple-400/60" />
                              {voiceCount}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <FileAudio className="w-3 h-3 text-cyan-400/60" />
                            {story.paragraph_count}p
                          </span>
                          {story.duration > 0 && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-emerald-400/60" />
                              {fmtTime(story.duration)}
                            </span>
                          )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between pt-3 border-t border-c-border">
                          <span className="text-[10px] text-c-dim">
                            {new Date(story.updated_at).toLocaleDateString()}
                          </span>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {story.status === 'ready' && story.audio_path && (
                              <button
                                onClick={(e) => { e.stopPropagation(); playAudio(`/api/tts/audio/${story.audio_path!.split(/[/\\]/).pop()}`); }}
                                className="p-1.5 rounded-lg text-c-dim hover:text-emerald-400 hover:bg-emerald-900/20 transition-colors cursor-pointer"
                                title={t('tts.play')}
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {story.status === 'ready' && story.audio_path && (
                              <a
                                href={`/api/tts/audio/${story.audio_path!.split(/[/\\]/).pop()}`}
                                download
                                onClick={(e) => e.stopPropagation()}
                                className="p-1.5 rounded-lg text-c-dim hover:text-cyan-400 hover:bg-cyan-900/20 transition-colors cursor-pointer"
                                title={t('tts.download')}
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!confirm(t('tts.confirmDeleteStory'))) return;
                                ttsApi.deleteStory(story.id).then(() => {
                                  if (activeStoryId === story.id) { setActiveStoryId(null); setText(''); }
                                  refetchStories();
                                });
                              }}
                              className="p-1.5 rounded-lg text-c-dim hover:text-red-400 hover:bg-red-900/20 transition-colors cursor-pointer"
                              title={t('tts.delete')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card p-12 text-center">
                <Music className="w-12 h-12 mx-auto mb-4 text-purple-400/30" />
                <p className="text-base text-c-muted mb-2">{t('tts.noStories')}</p>
                <p className="text-sm text-c-dim mb-6">{t('tts.noStoriesHint')}</p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    className="btn-secondary flex items-center gap-2 text-sm cursor-pointer"
                    onClick={() => setShowStoryPrompt(true)}
                  >
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    {t('tts.storyPrompt')}
                  </button>
                  <button
                    onClick={openQuickTts}
                    className="btn-secondary flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                    {t('tts.quickTts')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <audio ref={audioRef} className="hidden" onEnded={stopAudio} />
        {showStoryPrompt && <StoryPromptGuide onClose={() => setShowStoryPrompt(false)} defaultEngine={engine} />}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  EDITOR VIEW
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title={t('tts.title')} subtitle={t('tts.subtitle')} />

      <div className="flex-1 grid grid-cols-[1fr_320px] gap-0 min-h-0">
        {/* ═══ Left: Main area ═══ */}
        <div className="flex flex-col overflow-auto">
          <div className="p-6 space-y-5">

            {/* ── Back to dashboard + story name ── */}
            <div className="flex items-center gap-3">
              <button
                onClick={backToDashboard}
                className="flex items-center gap-1.5 text-sm text-c-muted hover:text-c-text transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                {t('tts.backToDashboard')}
              </button>
              {activeStoryId && (
                <>
                  <span className="text-c-dim">/</span>
                  <span className="text-sm font-medium text-purple-300 truncate max-w-[300px]">
                    {stories?.find(s => s.id === activeStoryId)?.title}
                  </span>
                </>
              )}
              {!activeStoryId && (
                <>
                  <span className="text-c-dim">/</span>
                  <span className="text-sm font-medium text-cyan-300">{t('tts.quickTts')}</span>
                </>
              )}
              <div className="ml-auto flex items-center gap-2">
                {isStoryFormat && !activeStoryId && (
                  <button
                    onClick={() => {
                      const parsed = parseStoryTitle(text);
                      ttsApi.createStory({ content: text, title: parsed }).then((s) => {
                        setActiveStoryId(s.id);
                        refetchStories();
                      });
                    }}
                    className="btn-secondary flex items-center gap-1.5 text-xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('tts.saveAsProject')}
                  </button>
                )}
              </div>
            </div>

            {/* ── Story result player (when audio already generated) ── */}
            {(() => {
              const activeStory = stories?.find(s => s.id === activeStoryId);
              if (!activeStory || !activeStory.audio_path || activeStory.status !== 'ready') return null;
              const audioUrl = `/api/tts/audio/${activeStory.audio_path.split(/[/\\]/).pop()}`;
              const voiceCount = (() => { try { return JSON.parse(activeStory.voice_groups || '[]').length; } catch { return 0; } })();
              const isPlaying = playingUrl === audioUrl;
              return (
                <div className="border border-emerald-800/30 rounded-xl overflow-hidden bg-emerald-900/5">
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-900/30 flex items-center justify-center shrink-0">
                        <FileAudio className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-c-text">{t('tts.storyAudioReady')}</div>
                        <div className="flex items-center gap-3 text-xs text-c-dim mt-0.5">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {fmtTime(activeStory.duration)}
                          </span>
                          {voiceCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {voiceCount} {t('tts.voices')}
                            </span>
                          )}
                          <span>{activeStory.paragraph_count} {t('tts.paragraphs')}</span>
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium text-emerald-400 bg-emerald-500/15">
                        {activeStory.status}
                      </span>
                    </div>

                    {/* Waveform-style progress bar */}
                    {isPlaying && audioDuration > 0 && (
                      <div className="space-y-1">
                        <div
                          className="h-2 bg-c-bg rounded-full cursor-grab active:cursor-grabbing overflow-hidden select-none"
                          onMouseDown={handleSeekStart}
                        >
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-100"
                            style={{ width: `${(audioProgress / audioDuration) * 100}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-c-dim tabular-nums">
                          <span>{fmtTime(audioProgress)}</span>
                          <span>{fmtTime(audioDuration)}</span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => playAudio(audioUrl)}
                        className={clsx(
                          'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                          isPlaying
                            ? 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30'
                            : 'bg-emerald-600 text-white hover:bg-emerald-500',
                        )}
                      >
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        {isPlaying ? t('tts.pause') : t('tts.play')}
                      </button>
                      <a
                        href={audioUrl}
                        download
                        className="btn-secondary flex items-center gap-1.5 text-sm cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        {t('tts.download')}
                      </a>
                      <button
                        onClick={() => generateMutation.mutate()}
                        disabled={generateMutation.isPending}
                        className="btn-secondary flex items-center gap-1.5 text-sm cursor-pointer ml-auto"
                      >
                        <RefreshCw className={clsx('w-4 h-4', generateMutation.isPending && 'animate-spin')} />
                        {t('tts.regenerate')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Text input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-c-muted">{t('tts.textInput')}</label>
              </div>
              <textarea
                className="input h-40 resize-y font-mono text-sm leading-relaxed"
                placeholder={t('tts.textPlaceholder')}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-c-dim">
                  {wordCount} {t('scriptEditor.words')} · {text.length} {t('tts.chars')}
                </span>
                <div className="flex items-center gap-2">
                  {activeStoryId && isStoryFormat && (
                    <button
                      onClick={() => ttsApi.updateStory(activeStoryId, { content: text }).then(() => refetchStories())}
                      className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Save className="w-3 h-3" />
                      {t('tts.save')}
                    </button>
                  )}
                  <button onClick={() => { setText(''); setActiveStoryId(null); }} className="text-xs text-c-dim hover:text-c-muted cursor-pointer">
                    {t('scriptEditor.clear')}
                  </button>
                </div>
              </div>
            </div>

            {/* ═══ TTS Engine selector ═══ */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                <span className="text-xs text-c-muted">{t('tts.engine')}</span>
              </div>
              <div className="flex rounded-lg border border-c-border overflow-hidden">
                <button
                  onClick={() => setEngine('kokoro')}
                  className={clsx(
                    'px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5',
                    engine === 'kokoro'
                      ? 'bg-emerald-900/40 text-emerald-300 border-r border-emerald-600/30'
                      : 'text-c-muted hover:text-c-text border-r border-c-border'
                  )}
                >
                  Kokoro
                  {kokoroHealth?.available
                    ? <Wifi className="w-3 h-3 text-green-400" />
                    : <WifiOff className="w-3 h-3 text-red-400/60" />}
                </button>
                <button
                  onClick={() => setEngine('omnivoice')}
                  className={clsx(
                    'px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5',
                    engine === 'omnivoice'
                      ? 'bg-violet-900/40 text-violet-300 border-r border-violet-600/30'
                      : 'text-c-muted hover:text-c-text border-r border-c-border'
                  )}
                >
                  OmniVoice
                  {omnivoiceHealth?.reachable
                    ? <Wifi className="w-3 h-3 text-green-400" />
                    : <WifiOff className="w-3 h-3 text-red-400/60" />}
                </button>
                <button
                  onClick={() => setEngine('google-tts')}
                  className={clsx(
                    'px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5',
                    engine === 'google-tts'
                      ? 'bg-blue-900/40 text-blue-300 border-r border-blue-600/30'
                      : 'text-c-muted hover:text-c-text border-r border-c-border'
                  )}
                >
                  Google TTS
                  {googleTtsHealth?.healthy
                    ? <Wifi className="w-3 h-3 text-green-400" />
                    : <WifiOff className="w-3 h-3 text-red-400/60" />}
                </button>
                <button
                  onClick={() => setEngine('edge-tts')}
                  className={clsx(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    engine === 'edge-tts'
                      ? 'bg-cyan-900/40 text-cyan-300'
                      : 'text-c-muted hover:text-c-text'
                  )}
                >
                  Edge TTS
                </button>
              </div>
              {engine === 'omnivoice' && !omnivoiceHealth?.reachable && (
                <span className="text-xs text-amber-400/80">{t('tts.omnivoiceOffline')}</span>
              )}
              {engine === 'kokoro' && !kokoroHealth?.available && (
                <span className="text-xs text-amber-400/80">{t('tts.kokoroOffline')}</span>
              )}
              {engine === 'google-tts' && !googleTtsHealth?.available && (
                <span className="text-xs text-amber-400/80">{t('tts.googleTtsOffline')}</span>
              )}
            </div>

            {/* ═══ Google TTS Config ═══ */}
            {engine === 'google-tts' && (
              <div className="border border-blue-800/30 rounded-xl p-4 space-y-3 bg-blue-900/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CloudCog className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-medium text-blue-300">{t('tts.googleTtsConfig')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full', googleTtsHealth?.healthy ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400')}>
                      {googleTtsHealth?.healthy ? t('tts.googleTtsConfigured') : t('tts.googleTtsNotConfigured')}
                    </span>
                    <button onClick={() => setGoogleConfigOpen(!googleConfigOpen)} className="text-xs text-c-muted hover:text-c-text">
                      <Settings2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {googleConfigOpen && (
                  <div className="space-y-3 pt-2 border-t border-blue-800/20">
                    <div>
                      <label className="text-xs text-c-muted mb-1 block">{t('tts.googleTtsProjectId')}</label>
                      <input
                        type="text"
                        value={googleProjectId}
                        onChange={(e) => setGoogleProjectId(e.target.value)}
                        placeholder={t('tts.googleTtsProjectIdPlaceholder')}
                        className="input text-sm w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-c-muted mb-1 block">{t('tts.googleTtsCredentials')}</label>
                      <textarea
                        value={googleCredentialsJson}
                        onChange={(e) => setGoogleCredentialsJson(e.target.value)}
                        placeholder={googleConfig?.hasCredentials ? '(credentials saved - paste new to replace)' : t('tts.googleTtsCredentialsPlaceholder')}
                        className="input text-xs w-full h-24 resize-y font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-c-muted mb-1 block">{t('tts.googleTtsCredentialsPath')}</label>
                      <input
                        type="text"
                        value={googleCredentialsPath}
                        onChange={(e) => setGoogleCredentialsPath(e.target.value)}
                        placeholder={t('tts.googleTtsCredentialsPathPlaceholder')}
                        className="input text-sm w-full"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleGoogleSaveConfig}
                        disabled={googleConfigSaving}
                        className="btn-primary text-xs flex items-center gap-1.5"
                      >
                        {googleConfigSaving ? <Spinner size="sm" /> : <Check className="w-3.5 h-3.5" />}
                        {t('tts.googleTtsSaveConfig')}
                      </button>
                      <button
                        onClick={handleGoogleReload}
                        className="btn-secondary text-xs flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t('tts.googleTtsReload')}
                      </button>
                      {googleConfigMsg && (
                        <span className="text-xs text-green-400">{googleConfigMsg}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Google TTS Usage & Quota */}
                <div className="rounded-lg border border-blue-800/20 bg-blue-950/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-blue-300">{t('tts.googleTtsQuotaTitle')}</span>
                    {googleUsage && (
                      <button
                        onClick={async () => { await ttsApi.googleTtsResetUsage(); refetchGoogleUsage(); }}
                        className="text-[10px] text-c-dim hover:text-c-muted"
                      >
                        {t('tts.googleTtsQuotaReset')}
                      </button>
                    )}
                  </div>
                  {(() => {
                    const QUOTA_ROWS = [
                      { type: 'Standard', limit: 4_000_000 },
                      { type: 'Wavenet', limit: 1_000_000 },
                      { type: 'Neural2', limit: 1_000_000 },
                      { type: 'Studio', limit: 100_000 },
                      { type: 'Chirp HD', limit: 0 },
                      { type: 'Chirp3', limit: 0 },
                    ];
                    const fmtChars = (n: number) => {
                      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
                      if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
                      return String(n);
                    };
                    return (
                      <div className="space-y-1.5">
                        {QUOTA_ROWS.map(({ type, limit }) => {
                          const used = googleUsage?.[type]?.used ?? 0;
                          const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
                          const isPaid = limit === 0;
                          return (
                            <div key={type}>
                              <div className="flex justify-between items-center mb-0.5">
                                <span className="text-[11px] text-c-muted">{type}</span>
                                {isPaid ? (
                                  <span className="text-[10px] text-amber-400 font-mono">{used > 0 ? `${fmtChars(used)} used · ` : ''}{t('tts.googleTtsQuotaPaid')}</span>
                                ) : (
                                  <span className="text-[10px] font-mono">
                                    <span className={pct > 80 ? 'text-red-400' : pct > 50 ? 'text-amber-400' : 'text-green-400'}>{fmtChars(used)}</span>
                                    <span className="text-c-dim"> / {fmtChars(limit)}</span>
                                  </span>
                                )}
                              </div>
                              {!isPaid && (
                                <div className="h-1 bg-c-bg rounded-full overflow-hidden">
                                  <div
                                    className={clsx('h-full rounded-full transition-all', pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-green-500')}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  <div className="text-[10px] text-c-dim">{t('tts.googleTtsQuotaNote')}</div>
                </div>

                {/* Google TTS Quota Warning */}
                {quotaError && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/30 border border-red-700/40">
                    <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
                    <div className="flex-1">
                      <div className="text-xs font-medium text-red-300 mb-0.5">{t('tts.googleTtsQuotaBlocked')}</div>
                      <div className="text-[11px] text-red-400/80">{quotaError}</div>
                    </div>
                    <button onClick={() => setQuotaError('')} className="text-red-400/60 hover:text-red-300 text-xs">✕</button>
                  </div>
                )}

                {/* Google TTS Voice Browser */}
                {googleTtsHealth?.healthy && (
                  <div className="space-y-3 pt-2 border-t border-blue-800/20">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-c-muted">{t('tts.googleTtsVoice')}</label>
                      {googleVoices && (
                        <span className="text-xs text-c-dim">{googleVoices.length} {t('tts.voicesAvailable')}</span>
                      )}
                    </div>

                    {googleVoicesLoading ? (
                      <div className="flex items-center gap-2 text-xs text-c-dim py-4 justify-center">
                        <Spinner size="sm" /> {t('tts.googleTtsLoadingVoices')}
                      </div>
                    ) : !googleVoices || googleVoices.length === 0 ? (
                      <div className="text-xs text-c-dim py-4 text-center">{t('tts.googleTtsNoVoices')}</div>
                    ) : (() => {
                      const VOICE_TYPES = ['Chirp3', 'Chirp', 'Neural2', 'Wavenet', 'Studio', 'Standard', 'Casual', 'News', 'Polyglot'] as const;
                      const getVoiceType = (name: string) => {
                        for (const vt of VOICE_TYPES) {
                          if (name.includes(vt)) return vt;
                        }
                        // Chirp HD voices have star/constellation names without type prefix
                        const parts = name.split('-');
                        if (parts.length === 1 || (parts.length === 2 && !name.includes('Standard') && !name.includes('Neural'))) return 'Chirp HD';
                        return 'Other';
                      };

                      const allLangs = [...new Set(googleVoices.flatMap((v) => v.languageCodes))].sort();
                      const typesInLang = [...new Set(googleVoices
                        .filter((v) => v.languageCodes.includes(gVoiceLang))
                        .map((v) => getVoiceType(v.name)))].sort();

                      const filtered = googleVoices.filter((v) => {
                        if (!v.languageCodes.includes(gVoiceLang)) return false;
                        if (gVoiceType !== 'all' && getVoiceType(v.name) !== gVoiceType) return false;
                        if (gVoiceGender !== 'all' && v.ssmlGender !== gVoiceGender) return false;
                        if (gVoiceSearch && !v.name.toLowerCase().includes(gVoiceSearch.toLowerCase())) return false;
                        return true;
                      });

                      const TYPE_COLORS: Record<string, string> = {
                        'Chirp HD': 'bg-purple-900/40 text-purple-300 border-purple-600/30',
                        'Chirp3': 'bg-purple-900/40 text-purple-300 border-purple-600/30',
                        'Chirp': 'bg-violet-900/40 text-violet-300 border-violet-600/30',
                        'Neural2': 'bg-blue-900/40 text-blue-300 border-blue-600/30',
                        'Wavenet': 'bg-cyan-900/40 text-cyan-300 border-cyan-600/30',
                        'Studio': 'bg-amber-900/40 text-amber-300 border-amber-600/30',
                        'Standard': 'bg-gray-800/40 text-gray-300 border-gray-600/30',
                        'Casual': 'bg-green-900/40 text-green-300 border-green-600/30',
                        'News': 'bg-rose-900/40 text-rose-300 border-rose-600/30',
                        'Polyglot': 'bg-teal-900/40 text-teal-300 border-teal-600/30',
                        'Other': 'bg-gray-800/40 text-gray-400 border-gray-600/30',
                      };

                      return (
                        <>
                          {/* Filters row */}
                          <div className="grid grid-cols-4 gap-2">
                            <select value={gVoiceLang} onChange={(e) => { setGVoiceLang(e.target.value); setGVoiceType('all'); }}
                              className="input text-xs">
                              {allLangs.map((lc) => (
                                <option key={lc} value={lc}>{lc}</option>
                              ))}
                            </select>
                            <select value={gVoiceType} onChange={(e) => setGVoiceType(e.target.value)}
                              className="input text-xs">
                              <option value="all">{t('tts.googleTtsVoiceCategory')}: All</option>
                              {typesInLang.map((vt) => (
                                <option key={vt} value={vt}>{vt}</option>
                              ))}
                            </select>
                            <select value={gVoiceGender} onChange={(e) => setGVoiceGender(e.target.value)}
                              className="input text-xs">
                              <option value="all">{t('tts.allGenders')}</option>
                              <option value="MALE">{t('tts.male')}</option>
                              <option value="FEMALE">{t('tts.female')}</option>
                            </select>
                            <div className="relative">
                              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-c-dim" />
                              <input type="text" value={gVoiceSearch} onChange={(e) => setGVoiceSearch(e.target.value)}
                                placeholder={t('tts.searchVoices')}
                                className="input text-xs w-full pl-6" />
                            </div>
                          </div>

                          {/* Voice list */}
                          <div className="max-h-48 overflow-y-auto rounded-lg border border-c-border bg-c-bg space-y-0.5 p-1">
                            {filtered.length === 0 ? (
                              <div className="text-xs text-c-dim py-3 text-center">{t('tts.noVoicesFound')}</div>
                            ) : filtered.map((v) => {
                              const vType = getVoiceType(v.name);
                              const isSelected = googleVoice === v.name;
                              return (
                                <button
                                  key={v.name}
                                  onClick={() => { setGoogleVoice(v.name); setSelectedVoice(v.name); }}
                                  className={clsx(
                                    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors',
                                    isSelected
                                      ? 'bg-blue-900/40 border border-blue-500/40'
                                      : 'hover:bg-c-surface border border-transparent'
                                  )}
                                >
                                  <span className={clsx('text-xs', v.ssmlGender === 'MALE' ? 'text-blue-400' : 'text-pink-400')}>
                                    {v.ssmlGender === 'MALE' ? '\u2642' : '\u2640'}
                                  </span>
                                  <span className={clsx('text-xs flex-1 truncate', isSelected ? 'text-blue-200 font-medium' : 'text-c-text')}>
                                    {v.name}
                                  </span>
                                  <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border', TYPE_COLORS[vType] || TYPE_COLORS['Other'])}>
                                    {vType}
                                  </span>
                                  <span className="text-[10px] text-c-dim">{v.naturalSampleRateHertz / 1000}k</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="text-xs text-c-dim">{filtered.length} / {googleVoices.length} voices</div>

                          {/* Selected voice + controls */}
                          {googleVoice && (
                            <div className="bg-blue-900/15 border border-blue-800/30 rounded-lg p-3 space-y-3">
                              <div className="flex items-center gap-2">
                                <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                                <span className="text-xs font-medium text-blue-300">{googleVoice}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <div className="flex justify-between items-center mb-1">
                                    <label className="text-xs text-c-muted">{t('tts.googleTtsSpeakingRate')}</label>
                                    <span className="text-xs text-blue-300 font-mono">{googleSpeakingRate.toFixed(2)}x</span>
                                  </div>
                                  <input type="range" min={0.25} max={4.0} step={0.05} value={googleSpeakingRate}
                                    onChange={(e) => setGoogleSpeakingRate(Number(e.target.value))}
                                    className="w-full accent-blue-500 h-1.5" />
                                </div>
                                <div>
                                  <div className="flex justify-between items-center mb-1">
                                    <label className="text-xs text-c-muted">{t('tts.googleTtsPitch')}</label>
                                    <span className="text-xs text-blue-300 font-mono">{googlePitch.toFixed(1)}</span>
                                  </div>
                                  <input type="range" min={-20} max={20} step={0.5} value={googlePitch}
                                    onChange={(e) => setGooglePitch(Number(e.target.value))}
                                    className="w-full accent-blue-500 h-1.5" />
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ═══ Language & Voice select ═══ */}
            {engine !== 'google-tts' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <label className="text-xs text-c-muted">{t('tts.selectLanguage')}</label>
                </div>
                <select
                  value={langFilter}
                  onChange={(e) => setLangFilter(e.target.value)}
                  className="input text-sm w-full"
                >
                  <option value="all">{t('tts.allLanguages')}</option>
                  {Object.entries(langList).map(([code, flag]) => (
                    <option key={code} value={code}>
                      {flag} {languages[code] ?? code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Search className="w-4 h-4 text-cyan-400" />
                  <label className="text-xs text-c-muted">{t('tts.searchVoices')}</label>
                </div>
                <select
                  value={selectedVoice}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  className="input text-sm w-full"
                >
                  {Object.entries(groupedVoices).map(([lang, entries]) => (
                    <optgroup key={lang} label={`${entries[0]?.[1]?.flag ?? ''} ${languages[lang] ?? lang}`}>
                      {entries.map(([id, info]) => (
                        <option key={id} value={id}>
                          {info.flag} {info.label} ({info.gender === 'male' ? '♂' : '♀'})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            )}

            {/* ═══ Voice controls ═══ */}
            {engine !== 'google-tts' && (
            <div className="border border-[#22d3ee20] rounded-xl p-4 space-y-4 bg-[#22d3ee05]">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium text-c-text">{t('tts.voiceControls')}</span>
                {currentVoice && (
                  <span className="ml-auto text-xs text-cyan-300 bg-cyan-900/20 px-2 py-0.5 rounded-full">
                    {currentVoice.flag} {currentVoice.label}
                  </span>
                )}
              </div>

              {/* Sliders grid */}
              <div className="grid grid-cols-3 gap-4">
                {/* Speed */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-c-muted">{t('tts.speed')}</label>
                    <div className="flex items-center gap-0.5">
                      <input type="number" min={-50} max={100} step={5} value={rate}
                        onChange={(e) => setRate(Math.min(100, Math.max(-50, Number(e.target.value) || 0)))}
                        className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                      <span className="text-xs text-c-dim">%</span>
                    </div>
                  </div>
                  <input type="range" min={-50} max={100} step={5} value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    className="w-full accent-cyan-500 h-1.5" />
                </div>

                {/* Pitch */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-c-muted">{t('tts.pitch')}</label>
                    <div className="flex items-center gap-0.5">
                      <input type="number" min={-50} max={50} step={5} value={pitch}
                        onChange={(e) => setPitch(Math.min(50, Math.max(-50, Number(e.target.value) || 0)))}
                        className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                      <span className="text-xs text-c-dim">Hz</span>
                    </div>
                  </div>
                  <input type="range" min={-50} max={50} step={5} value={pitch}
                    onChange={(e) => setPitch(Number(e.target.value))}
                    className="w-full accent-cyan-500 h-1.5" />
                </div>

                {/* Volume */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-c-muted">{t('tts.volume')}</label>
                    <div className="flex items-center gap-0.5">
                      <input type="number" min={-50} max={100} step={5} value={volume}
                        onChange={(e) => setVolume(Math.min(100, Math.max(-50, Number(e.target.value) || 0)))}
                        className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                      <span className="text-xs text-c-dim">%</span>
                    </div>
                  </div>
                  <input type="range" min={-50} max={100} step={5} value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-full accent-cyan-500 h-1.5" />
                </div>
              </div>

              {/* Emotion/Style (only for supported voices) */}
              {availableStyles.length > 0 && (
                <div>
                  <label className="text-xs text-c-muted mb-1.5 block">{t('tts.emotion')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setStyle('')}
                      className={clsx(
                        'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                        !style
                          ? 'bg-cyan-900/30 border-cyan-600/50 text-cyan-300'
                          : 'border-c-border text-c-muted hover:border-c-border-hi'
                      )}
                    >
                      {t('tts.neutral')}
                    </button>
                    {availableStyles.map((s) => (
                      <button
                        key={s}
                        onClick={() => setStyle(s)}
                        className={clsx(
                          'text-xs px-2.5 py-1 rounded-lg border transition-colors capitalize',
                          style === s
                            ? 'bg-amber-900/30 border-amber-600/50 text-amber-300'
                            : 'border-c-border text-c-muted hover:border-c-border-hi'
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Reset params */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setRate(0); setPitch(0); setVolume(0); setStyle(''); }}
                  className="text-xs text-c-dim hover:text-c-muted"
                >
                  {t('tts.resetParams')}
                </button>
              </div>
            </div>
            )}

            {/* ═══ Action bar ═══ */}
            <div className="flex gap-3">
              <button
                onClick={handlePreview}
                disabled={previewLoading}
                className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
              >
                {previewLoading ? <Spinner size="sm" /> : <Volume2 className="w-4 h-4" />}
                {t('tts.previewVoice')}
              </button>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={!text.trim() || generateMutation.isPending}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-50',
                  isStoryFormat ? 'btn-primary bg-purple-600 hover:bg-purple-500' : 'btn-primary',
                )}
              >
                {generateMutation.isPending ? <Spinner size="sm" /> : isStoryFormat ? <Sparkles className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {generateMutation.isPending ? t('tts.generating') : isStoryFormat ? t('tts.generateStory') : t('tts.generate')}
              </button>
            </div>

            {/* ═══ Progress log ═══ */}
            {generateMutation.isPending && generateProgress.length > 0 && (
              <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10 space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <Spinner size="sm" />
                  <span className="text-xs font-medium text-cyan-300">{t('tts.generating')}</span>
                </div>
                <div ref={progressLogRef} className="max-h-28 overflow-y-auto font-mono text-[11px] text-c-dim space-y-0.5">
                  {generateProgress.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ Audio player (generated result) ═══ */}
            {generateMutation.data && (
              <div className="border border-green-800/30 rounded-xl p-4 bg-green-900/10 space-y-3">
                <div className="flex items-center gap-2">
                  <FileAudio className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium text-green-300">{t('tts.generated')}</span>
                  <span className="text-xs text-c-dim ml-auto">
                    {generateMutation.data.duration.toFixed(1)}s
                  </span>
                </div>

                {/* Progress bar */}
                {playingUrl === generateMutation.data.url && audioDuration > 0 && (
                  <div className="space-y-1">
                    <div
                      className="h-2 bg-c-bg rounded-full cursor-grab active:cursor-grabbing overflow-hidden select-none"
                      onMouseDown={handleSeekStart}
                    >
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-100"
                        style={{ width: `${(audioProgress / audioDuration) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-c-dim">
                      <span>{fmtTime(audioProgress)}</span>
                      <span>{fmtTime(audioDuration)}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => playAudio(generateMutation.data!.url)}
                    className="btn-secondary flex items-center gap-1.5 text-xs"
                  >
                    {playingUrl === generateMutation.data.url
                      ? <><Pause className="w-3.5 h-3.5" /> {t('tts.pause')}</>
                      : <><Play className="w-3.5 h-3.5" /> {t('tts.play')}</>}
                  </button>
                  <button
                    onClick={() => handleDownload(generateMutation.data!.url, generateMutation.data!.filename)}
                    className="btn-secondary flex items-center gap-1.5 text-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t('tts.download')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ Right sidebar: History ═══ */}
        <div className="flex flex-col border-l border-c-border overflow-hidden">
          <div className="px-4 py-4 border-b border-c-border">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-c-text">{t('tts.history')}</h2>
                <p className="text-xs text-c-muted mt-0.5">{history?.length ?? 0} {t('tts.files')}</p>
              </div>
              {history && history.length > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={history.length > 0 && selected.size === history.length}
                    onChange={toggleSelectAll}
                    className="accent-cyan-500 w-3.5 h-3.5"
                  />
                  <span className="text-xs text-c-muted">{t('tts.selectAll')}</span>
                </label>
              )}
            </div>
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="px-3 py-2 border-b border-c-border bg-cyan-900/10 flex items-center gap-2">
              <span className="text-xs text-cyan-300">{selected.size} {t('tts.selected')}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={handleBulkDownload}
                  className="text-xs text-c-muted hover:text-c-text flex items-center gap-1 px-2 py-1 rounded border border-c-border hover:border-c-border-hi transition-colors"
                >
                  <Download className="w-3 h-3" />
                  {t('tts.download')}
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="text-xs text-red-400/80 hover:text-red-400 flex items-center gap-1 px-2 py-1 rounded border border-red-800/30 hover:border-red-600/50 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  {t('tts.deleteFile')}
                </button>
              </div>
            </div>
          )}

          {!history || history.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
              <FileAudio className="w-8 h-8 text-c-dim mb-3" />
              <div className="text-xs text-c-muted">{t('tts.noHistory')}</div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-3 space-y-1.5">
              {history.map((file) => {
                const isPlaying = playingUrl === file.url;
                return (
                  <div
                    key={file.filename}
                    className={clsx(
                      'bg-c-surface border rounded-lg p-2.5 transition-colors',
                      isPlaying ? 'border-cyan-600/40' : 'border-c-border'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(file.filename)}
                        onChange={() => toggleSelect(file.filename)}
                        className="accent-cyan-500 w-3.5 h-3.5 shrink-0"
                      />
                      <button
                        onClick={() => playAudio(file.url)}
                        className={clsx(
                          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                          isPlaying
                            ? 'bg-cyan-900/40 text-cyan-300'
                            : 'bg-c-bg text-c-muted hover:text-c-text'
                        )}
                      >
                        {isPlaying
                          ? <Pause className="w-3 h-3" />
                          : <Play className="w-3 h-3" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-c-dim truncate">
                          {file.duration > 0 ? fmtTime(file.duration) : '--:--'} · {file.sizeKB} KB
                        </div>
                        <div className="text-xs text-c-dim flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {new Date(file.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleDownload(file.url, file.filename)}
                          className="text-c-dim hover:text-c-muted p-0.5"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(file.filename, file.url)}
                          className="text-c-dim hover:text-red-400 p-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Player bar when this item is playing */}
                    {isPlaying && audioDuration > 0 && (
                      <div className="mt-2 space-y-1">
                        <div
                          className="h-1.5 bg-c-bg rounded-full cursor-grab active:cursor-grabbing overflow-hidden select-none"
                          onMouseDown={handleSeekStart}
                        >
                          <div
                            className="h-full bg-cyan-500 rounded-full transition-all duration-100"
                            style={{ width: `${(audioProgress / audioDuration) * 100}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-c-dim">
                          <span>{fmtTime(audioProgress)}</span>
                          <span>{fmtTime(audioDuration)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        onEnded={stopAudio}
      />

      {showStoryPrompt && <StoryPromptGuide onClose={() => setShowStoryPrompt(false)} defaultEngine={engine} />}
    </div>
  );
}

function fmtTime(s: number): string {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Story Prompt Guide — generates AI story prompt for multi-role TTS
// ═══════════════════════════════════════════════════════════════════════════

// --- Parse title from story markdown ---
function parseStoryTitle(text: string): string {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled Story';
}

// --- Voice tables per engine ---
const VOICE_TABLES: Record<string, string> = {
  'google-tts': `**Available voices (Google TTS Neural2 — free 1M chars/month):**

| Voice ID | Gender | Best for |
|---|---|---|
| en-US-Neural2-A | Male | Young man, casual, everyman |
| en-US-Neural2-D | Male | Narrator, authority, deep calm |
| en-US-Neural2-I | Male | Older man, weathered, quiet |
| en-US-Neural2-J | Male | Gruff, low, dry delivery |
| en-US-Neural2-C | Female | Young woman, clear, direct |
| en-US-Neural2-E | Female | Narrator, warm, even-toned |
| en-US-Neural2-F | Female | Younger voice, lighter |
| en-US-Neural2-H | Female | Low, calm, measured |
| en-US-Neural2-G | Female | Warm, maternal, steady |`,

  'edge-tts': `**Available voices (Edge TTS — free, 50+ voices):**

| Voice ID | Gender | Best for |
|---|---|---|
| en-US-GuyNeural | Male | Narrator, calm, deep |
| en-US-AndrewNeural | Male | Young man, friendly |
| en-US-BrianNeural | Male | Authoritative, news anchor |
| en-US-ChristopherNeural | Male | Older, warm storyteller |
| en-US-EricNeural | Male | Gruff, weathered |
| en-US-RogerNeural | Male | Dramatic, theatrical |
| en-US-JennyNeural | Female | Clear, versatile narrator |
| en-US-AriaNeural | Female | Warm, expressive |
| en-US-SaraNeural | Female | Young, bright |
| en-US-MichelleNeural | Female | Mature, confident |
| en-US-NancyNeural | Female | Gentle, maternal |
| en-GB-RyanNeural | Male | British, refined |
| en-GB-SoniaNeural | Female | British, elegant |`,

  'kokoro': `**Available voices (Kokoro — local, fast, natural):**

| Voice ID | Gender | Best for |
|---|---|---|
| af_heart | Female | Default, warm, natural narrator |
| af_bella | Female | Gentle, emotional storyteller |
| af_nova | Female | Clear, young, energetic |
| af_sarah | Female | Calm, mature, measured |
| af_sky | Female | Light, airy, dreamy |
| af_nicole | Female | Strong, confident |
| am_adam | Male | Default narrator, balanced |
| am_michael | Male | Warm, fatherly, deep |
| am_fenrir | Male | Low, intense, dramatic |
| am_eric | Male | Gruff, older, weathered |
| am_liam | Male | Young, casual, friendly |
| am_onyx | Male | Dark, mysterious |
| bf_emma | Female | British, refined |
| bm_george | Male | British, authoritative |
| bm_daniel | Male | British, gentle narrator |`,

  'omnivoice': `**Available voices (OmniVoice — premium, highest quality):**

Use voice names from your OmniVoice server. Check Settings → TTS for available voices. Assign voices to roles based on character traits.`,
};

// --- Engine labels for prompt ---
const ENGINE_LABELS: Record<string, string> = {
  'google-tts': 'google-tts',
  'edge-tts': 'edge-tts',
  'kokoro': 'kokoro',
  'omnivoice': 'omnivoice',
};

// --- Default narrator voice per engine ---
const DEFAULT_NARRATOR: Record<string, string> = {
  'google-tts': 'en-US-Neural2-D',
  'edge-tts': 'en-US-GuyNeural',
  'kokoro': 'am_adam',
  'omnivoice': 'narrator',
};

function getStoryPrompt(eng: string): string {
  const voiceTable = VOICE_TABLES[eng] || VOICE_TABLES['edge-tts'];
  const engineId = ENGINE_LABELS[eng] || 'edge-tts';
  const narratorVoice = DEFAULT_NARRATOR[eng] || 'en-US-GuyNeural';

  return `You are a human writer creating an audio story — a multi-voice drama meant to be listened to, read aloud through text-to-speech.

Your prose feels natural and lived-in. Never artificial. Never generic. Write for the ear, not the eye.

### Story request

- **Title:** [STORY_NAME]
- **Description/theme:** [DESCRIPTION]
- **Duration target:** [DURATION — e.g., "2 to 3 hours" / "30 minutes" / "10 minutes"]
- **Word count target:** [WORD_COUNT — e.g., "18,000-25,000 words" / "4,000 words" / "1,500 words"]
- **Language:** [LANGUAGE — e.g., English]
- **Genre:** [GENRE — e.g., Soft Sci-fi / Horror / Literary Fiction / Thriller / Fantasy / Slice of Life]
- **Tone:** [TONE — e.g., "Slow, observational, dry humor" / "Tense and claustrophobic" / "Warm and melancholic"]

### Writing rules

- Use natural, specific language. Concrete details over abstract feelings.
- No AI-sounding prose: no vague poetic flourishes, no overused metaphors.
- Invent small, believable details — routines, habits, textures of ordinary life.
- Emotion comes through actions and observations, never stated directly.
- Each paragraph = 2-6 sentences of spoken narration. Short enough to breathe.
- Characters talk the way real people talk — short sentences, half-thoughts, no speeches.

### Voice assignment

Assign each role a distinct voice. The narrator carries the story. Other characters appear when they speak. For stories under 30 min: 2-4 roles. Longer: up to 6-8 roles.

${voiceTable}

**Available emotions** (set default per role, override per paragraph when needed):
narrator, calm, gentle, serious, sad, whisper, mysterious, suspense, dramatic, warm, hopeful, sarcastic, frustrated, angry, tired, confident, tender, anxious, excited, fearful, commanding

**Emotion tips:** Most paragraphs use calm/narrator/gentle/serious. Shift gradually. Whisper for inner thoughts. Sarcastic is rare.

### Output format — STRICT

\`\`\`markdown
# STORY TITLE

[VOICE_GROUP: narrator | engine:${engineId} | voice:${narratorVoice} | emotion:calm]
[VOICE_GROUP: character_id | engine:${engineId} | voice:VOICE_ID | emotion:DEFAULT_EMOTION]

[VOICE: group:narrator | emotion:calm]
Narration paragraph. Two to six sentences.

[VOICE: group:character_id | emotion:confident]
Character dialogue — how this person actually talks.

[VOICE: group:narrator | emotion:whisper]
[PACE: slow]
Back to narrator. Pace tag is optional — use for atmospheric moments.

[VOICE: group:character_id | emotion:frustrated]
Another character line. Emotion overrides the group default.
\`\`\`

### Rules
1. Every paragraph MUST start with \`[VOICE: group:... | emotion:...]\` on its own line, followed by the spoken text.
2. \`[VOICE_GROUP:]\` declarations go at the top, before any narration.
3. \`[PACE: slow]\` or \`[PACE: fast]\` is optional — place on its own line before the paragraph.
4. Switch voices when characters speak. Return to narrator for description.
5. All VOICE_GROUPs must use \`engine:${engineId}\`.
6. Do NOT include: segment headings (##), scene headings (###), [PEXELS:], [CHARACTER:], production notes, chapter markers, or any video-related tags.
7. Output is ONLY: title line, voice group declarations, then paragraphs with voice tags. Nothing else.

### What NOT to write
- No stage directions: (he sighs), [beat]
- No empty poetry: "The silence spoke volumes"
- No AI transitions: "Little did he know"
- No stated emotions: "He felt sad" — show it instead
- No headings between paragraphs — just voice tags and text

Now write the complete story. Begin with \`# TITLE\` and end with the last paragraph.`;
}

// --- Example voice assignments per engine ---
const EXAMPLE_VOICES: Record<string, { narrator: string; elena: string; cole: string; voss: string }> = {
  'google-tts': { narrator: 'en-US-Neural2-D', elena: 'en-US-Neural2-C', cole: 'en-US-Neural2-A', voss: 'en-US-Neural2-J' },
  'edge-tts':   { narrator: 'en-US-GuyNeural', elena: 'en-US-JennyNeural', cole: 'en-US-AndrewNeural', voss: 'en-US-RogerNeural' },
  'kokoro':     { narrator: 'am_adam', elena: 'af_heart', cole: 'am_liam', voss: 'am_fenrir' },
  'omnivoice':  { narrator: 'narrator', elena: 'elena', cole: 'cole', voss: 'voss' },
};

function getStoryExample(eng: string): string {
  const v = EXAMPLE_VOICES[eng] || EXAMPLE_VOICES['edge-tts'];
  const engineId = ENGINE_LABELS[eng] || 'edge-tts';

  return `# The Last Signal

[VOICE_GROUP: narrator | engine:${engineId} | voice:${v.narrator} | emotion:narrator]
[VOICE_GROUP: elena | engine:${engineId} | voice:${v.elena} | emotion:confident]
[VOICE_GROUP: cole | engine:${engineId} | voice:${v.cole} | emotion:serious]
[VOICE_GROUP: voss | engine:${engineId} | voice:${v.voss} | emotion:commanding]

[VOICE: group:narrator | emotion:mysterious]
[PACE: slow]
On the night of September fourteenth, a radio telescope in the mountains of Chile picked up something it shouldn't have. A pattern. Repeating. Intentional. And it was coming from beyond our solar system.

[VOICE: group:elena | emotion:excited]
The signal repeats every forty-seven seconds. It's not random noise. It's not a pulsar. I've checked every known source in the catalog. This is something new. Something we've never seen before.

[VOICE: group:cole | emotion:anxious]
Elena, slow down. We've had false positives before. Remember the hydrogen line anomaly last year? Everyone got excited, and it turned out to be a microwave oven in the break room.

[VOICE: group:elena | emotion:frustrated]
This is different, Cole. I've been doing this for twelve years. I know what interference looks like. This signal has structure. It has mathematical precision. Someone out there is trying to talk to us.

[VOICE: group:narrator | emotion:suspense]
[PACE: slow]
Within forty-eight hours, the signal had been classified. The military arrived before the scientific community even knew what had been found.

[VOICE: group:voss | emotion:commanding]
Doctor Vasquez, let me be clear. This discovery is now under federal jurisdiction. You will not publish. You will not contact colleagues. You will not leave this facility until we understand exactly what we're dealing with.

[VOICE: group:elena | emotion:angry]
You can't bury this! The whole point of searching for extraterrestrial intelligence is to share it with the world. If we hide this, we are no better than every government that has lied to its people.

[VOICE: group:cole | emotion:gentle]
Elena, listen to me. I know you're right. I know this matters. But if we push too hard right now, they'll shut us out completely. We need to be smart about this.

[VOICE: group:elena | emotion:dramatic]
[PACE: slow]
I decoded it. It took me three sleepless nights, but I decoded the signal. It's not just a message. It's a warning. Something is coming toward us, and whoever sent this signal wants us to be ready.

[VOICE: group:cole | emotion:fearful]
How long? Elena, how long do we have?

[VOICE: group:elena | emotion:sad]
[PACE: slow]
The signal includes a countdown. Based on the mathematical constants they used, I estimate eleven years. Maybe twelve. Not enough time to argue about who gets to know.

[VOICE: group:narrator | emotion:tender]
[PACE: slow]
And so the question was no longer whether we were alone in the universe. It was whether we could set aside everything that divided us, and face what was coming as one species, on one small blue world, running out of time.`;
}

function StoryPromptGuide({ onClose, defaultEngine }: { onClose: () => void; defaultEngine: TtsEngine }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'prompt' | 'example'>('prompt');
  const [copied, setCopied] = useState(false);
  const [promptEngine, setPromptEngine] = useState<string>(defaultEngine);

  const handleCopy = async (content: string) => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col animate-slide-up" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-c-border shrink-0">
          <h2 className="text-lg font-bold text-c-text flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            {t('tts.storyPromptTitle')}
          </h2>
          <button onClick={onClose} className="text-c-dim hover:text-c-text p-1.5 rounded-lg hover:bg-c-elevated transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Engine selector + Tab bar */}
        <div className="flex items-center border-b border-c-border shrink-0">
          <button
            onClick={() => setTab('prompt')}
            className={`px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
              tab === 'prompt' ? 'text-purple-300 border-b-2 border-purple-400' : 'text-c-muted hover:text-c-text'
            }`}
          >
            {t('tts.storyPromptTabPrompt')}
          </button>
          <button
            onClick={() => setTab('example')}
            className={`px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
              tab === 'example' ? 'text-purple-300 border-b-2 border-purple-400' : 'text-c-muted hover:text-c-text'
            }`}
          >
            {t('tts.storyPromptTabExample')}
          </button>
          <div className="ml-auto flex items-center gap-1.5 pr-3">
            <span className="text-[10px] text-c-dim">{t('tts.storyPromptEngine')}</span>
            {(['edge-tts', 'kokoro', 'google-tts', 'omnivoice'] as const).map((e) => (
              <button
                key={e}
                onClick={() => setPromptEngine(e)}
                className={`px-2 py-1 text-[10px] rounded-md transition-colors cursor-pointer ${
                  promptEngine === e
                    ? 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40'
                    : 'text-c-dim hover:text-c-muted hover:bg-c-elevated'
                }`}
              >
                {e === 'google-tts' ? 'Google' : e === 'edge-tts' ? 'Edge' : e === 'kokoro' ? 'Kokoro' : 'Omni'}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'prompt' && (
            <>
              <p className="text-sm text-c-muted">{t('tts.storyPromptDesc')}</p>

              <div className="text-[11px] text-c-dim space-y-1.5 bg-c-elevated rounded-lg p-3">
                <p className="font-medium text-purple-300/80">{t('tts.storyPromptHowTo')}</p>
                <ol className="list-decimal list-inside space-y-0.5 text-c-muted">
                  <li>{t('tts.storyPromptStep1')}</li>
                  <li>{t('tts.storyPromptStep2')}</li>
                  <li>{t('tts.storyPromptStep3')}</li>
                  <li>{t('tts.storyPromptStep4')}</li>
                </ol>
              </div>

              <pre className="text-[11px] font-mono text-c-text bg-c-elevated rounded-lg p-4 max-h-[400px] overflow-auto whitespace-pre-wrap leading-relaxed">
                {getStoryPrompt(promptEngine)}
              </pre>
            </>
          )}

          {tab === 'example' && (
            <>
              <div>
                <p className="text-sm font-medium text-purple-300">{t('tts.storyExampleTitle')}</p>
                <p className="text-xs text-c-dim">{t('tts.storyExampleSubtitle')}</p>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[10px] bg-c-elevated rounded-lg p-3">
                <p className="col-span-2 font-medium text-purple-300/80 mb-1">{t('tts.storyExampleRoles')}</p>
                {(() => {
                  const v = EXAMPLE_VOICES[promptEngine] || EXAMPLE_VOICES['edge-tts'];
                  return (<>
                    <span className="text-blue-300">narrator — {v.narrator} (Male, deep)</span>
                    <span className="text-cyan-300">elena — {v.elena} (Female, determined)</span>
                    <span className="text-green-300">cole — {v.cole} (Male, supportive)</span>
                    <span className="text-red-300">voss — {v.voss} (Male, antagonist)</span>
                  </>);
                })()}
              </div>

              <pre className="text-[11px] font-mono text-c-text bg-c-elevated rounded-lg p-4 max-h-[400px] overflow-auto whitespace-pre-wrap leading-relaxed">
                {getStoryExample(promptEngine)}
              </pre>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 p-4 border-t border-c-border shrink-0">
          <button
            className="btn-primary flex items-center gap-2 text-sm cursor-pointer"
            onClick={() => handleCopy(tab === 'example' ? getStoryExample(promptEngine) : getStoryPrompt(promptEngine))}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied
              ? t('tts.storyPromptCopied')
              : tab === 'example' ? t('tts.storyExampleCopy') : t('tts.storyPromptCopy')
            }
          </button>
          <button
            className="btn-secondary flex items-center gap-2 text-sm cursor-pointer"
            onClick={() => handleDownload(
              tab === 'example' ? getStoryExample(promptEngine) : getStoryPrompt(promptEngine),
              tab === 'example' ? 'story-example.md' : 'story-format-prompt.md'
            )}
          >
            <Download className="w-4 h-4" />
            {t('tts.storyPromptDownload')}
          </button>
        </div>
      </div>
    </div>
  );
}
