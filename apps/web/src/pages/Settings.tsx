import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { settingsApi, musicApi, ttsApi } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { useAppStore } from '../store';
import { Settings as SettingsIcon, Zap, Mic, Server, Eye, EyeOff, CheckCircle, XCircle, Save, Music, Play, Trash2, Sparkles, Film, Palette, Image as ImageIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { useTheme, THEMES, type ThemeName } from '../hooks/useTheme';

type SettingsTab = 'general' | 'llm' | 'image' | 'narration' | 'video' | 'music';

const THEME_COLORS: Record<ThemeName, { accent: string; bg: string; surface: string }> = {
  midnight: { accent: '#8578f6', bg: '#0c0c14', surface: '#14141e' },
  ocean:    { accent: '#4d9cf5', bg: '#0a1019', surface: '#0f1722' },
  emerald:  { accent: '#34d399', bg: '#0a120e', surface: '#101c16' },
  sunset:   { accent: '#f59e42', bg: '#12100c', surface: '#1c1814' },
  daylight: { accent: '#7c5cf0', bg: '#f3f4f8', surface: '#ffffff' },
};

const WHISPER_MODELS = [
  { value: 'tiny',  label: 'tiny — Fastest, CPU-optimized (~70MB)' },
  { value: 'base',  label: 'base — Balanced (~140MB)' },
  { value: 'small', label: 'small — Better accuracy (~460MB)' },
];

const WHISPER_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'auto', label: 'Auto-detect' },
];

const COMMON_VI_FONTS = [
  'C:/Windows/Fonts/tahoma.ttf',
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/times.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
];

export function Settings() {
  const { t } = useTranslation();
  const { pushNotification } = useAppStore();
  const { theme: currentTheme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, boolean | null>>({});
  const [testingService, setTestingService] = useState<string | null>(null);
  const [musicMood, setMusicMood] = useState('dramatic');
  const [musicSearchResults, setMusicSearchResults] = useState<Array<{ id: string; name: string; artist_name: string; duration: number; audio: string; audiodownload: string; image: string; shareurl: string }>>([]);
  const [musicSearching, setMusicSearching] = useState(false);
  const [downloadingTrack, setDownloadingTrack] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: ttsData } = useQuery({
    queryKey: ['tts', 'voices'],
    queryFn: ttsApi.voices,
  });
  const voices = ttsData?.voices;
  const voiceLangs = ttsData?.languages ?? {};

  const { data: cachedTracks } = useQuery({
    queryKey: ['music', 'cached'],
    queryFn: musicApi.cached,
  });

  const { data: savedSettings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    if (savedSettings) {
      setForm(savedSettings);
      setDirty(false);
    }
  }, [savedSettings]);

  const saveMutation = useMutation({
    mutationFn: settingsApi.save,
    onSuccess: () => {
      setDirty(false);
      pushNotification({ id: 'settings-saved', type: 'success', title: t('settings.saved') });
    },
  });

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const testService = async (service: string) => {
    setTestingService(service);
    try {
      const result = await settingsApi.testService(service);
      setTestResults((prev) => ({ ...prev, ...result }));
    } catch {
      setTestResults((prev) => ({ ...prev, [service]: false }));
    } finally {
      setTestingService(null);
    }
  };

  const handleMusicSearch = async () => {
    setMusicSearching(true);
    setMusicSearchResults([]);
    try {
      const result = await musicApi.search(musicMood, 8);
      setMusicSearchResults(result.tracks);
    } catch {
      // error handled silently — user sees empty state
    } finally {
      setMusicSearching(false);
    }
  };

  const handleDownloadTrack = async (track: typeof musicSearchResults[0]) => {
    setDownloadingTrack(track.id);
    try {
      await musicApi.download(track);
      queryClient.invalidateQueries({ queryKey: ['music', 'cached'] });
    } finally {
      setDownloadingTrack(null);
    }
  };

  const handleClearMusicCache = async () => {
    await musicApi.clearCache();
    queryClient.invalidateQueries({ queryKey: ['music', 'cached'] });
  };

  const MOODS = ['dramatic', 'calm', 'energetic', 'sad', 'hopeful', 'mysterious', 'romantic', 'uplifting', 'tense', 'dark'];

  const voicesByLang = voices
    ? Object.entries(voices).reduce<Record<string, Array<[string, typeof voices[string]]>>>((acc, entry) => {
        const lang = entry[1].lang;
        if (!acc[lang]) acc[lang] = [];
        acc[lang].push(entry);
        return acc;
      }, {})
    : {};

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title={t('settings.title')} subtitle={t('settings.subtitle')} />
        <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <TopBar title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="flex-1 p-6 max-w-2xl pb-24">
        {/* Tab bar */}
        <div className="flex gap-1 mb-6 border-b border-c-border overflow-x-auto">
          {([
            { key: 'general', icon: Palette, label: t('settings.tabGeneral') },
            { key: 'llm', icon: Sparkles, label: t('settings.tabLLM') },
            { key: 'image', icon: ImageIcon, label: t('settings.tabImage') },
            { key: 'narration', icon: Mic, label: t('settings.tabNarration') },
            { key: 'video', icon: Film, label: t('settings.tabVideo') },
            { key: 'music', icon: Music, label: t('settings.tabMusic') },
          ] as Array<{ key: SettingsTab; icon: React.ElementType; label: string }>).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
                activeTab === key
                  ? 'border-accent-primary text-accent-hover'
                  : 'border-transparent text-c-dim hover:text-c-text hover:border-c-border'
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="space-y-6">

        {/* ═══ GENERAL TAB ═══ */}
        {activeTab === 'general' && (<>
        {/* Theme */}
        <section className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <Palette className="w-4 h-4 text-c-accent" />
            {t('settings.theme')}
          </h2>
          <div className="grid grid-cols-5 gap-3">
            {THEMES.map((name) => {
              const colors = THEME_COLORS[name];
              const active = currentTheme === name;
              return (
                <button
                  key={name}
                  onClick={() => setTheme(name)}
                  className={clsx(
                    'relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all duration-150',
                    active
                      ? 'border-c-accent shadow-lg ring-1 ring-c-accent/30'
                      : 'border-c-border hover:border-c-border-hi'
                  )}
                >
                  {/* Mini preview */}
                  <div
                    className="w-full aspect-[4/3] rounded-lg overflow-hidden border border-black/10"
                    style={{ background: colors.bg }}
                  >
                    <div className="m-1.5 rounded" style={{ background: colors.surface, height: '40%' }} />
                    <div className="mx-1.5 flex gap-1">
                      <div className="rounded" style={{ background: colors.accent, width: '40%', height: 6 }} />
                      <div className="rounded opacity-30" style={{ background: colors.accent, flex: 1, height: 6 }} />
                    </div>
                  </div>
                  <span className={clsx('text-xs font-medium', active ? 'text-c-accent' : 'text-c-muted')}>
                    {t(`theme.${name}`)}
                  </span>
                  {active && (
                    <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: colors.accent }}>
                      <CheckCircle className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Branding */}
        <section className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <Palette className="w-4 h-4 text-accent-primary" />
            {t('settings.branding')}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-c-muted block mb-1">{t('settings.appName')}</label>
              <input
                type="text"
                value={form.app_name ?? ''}
                onChange={(e) => set('app_name', e.target.value)}
                placeholder="VideoCloudAI"
                className="input w-full"
              />
              <div className="text-xs text-c-dim mt-0.5">{t('settings.appNameHint')}</div>
            </div>
            <div>
              <label className="text-xs text-c-muted block mb-1">{t('settings.appLogoUrl')}</label>
              <input
                type="text"
                value={form.app_logo_url ?? ''}
                onChange={(e) => set('app_logo_url', e.target.value)}
                placeholder="https://example.com/logo.png"
                className="input w-full"
              />
              <div className="text-xs text-c-dim mt-0.5">{t('settings.appLogoUrlHint')}</div>
            </div>
            {form.app_logo_url && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-c-muted">{t('settings.logoPreview')}</span>
                <img
                  src={form.app_logo_url}
                  alt="Logo preview"
                  className="w-8 h-8 rounded-lg object-cover border border-c-border"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
            )}
          </div>
        </section>

        </>)}

        {/* ═══ LLM TAB ═══ */}
        {activeTab === 'llm' && (<>
        {/* LLM Provider */}
        <section className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent-primary" />
            {t('settings.llmTitle')}
          </h2>

          <div className="space-y-3">
            {/* Provider tabs */}
            {(() => {
              const provider = form['llm_provider'] ?? 'gemini';
              const tabs = [
                { id: 'gemini', label: 'Gemini' },
                { id: 'groq', label: 'Groq' },
                { id: 'grok', label: 'Grok' },
                { id: 'openai', label: 'ChatGPT' },
                { id: 'openrouter', label: 'OpenRouter' },
                { id: 'cerebras', label: 'Cerebras' },
                { id: 'anthropic', label: 'Anthropic' },
              ] as const;
              return (
                <>
                  <div>
                    <label className="text-xs text-c-muted mb-1.5 block">{t('settings.llmProvider')}</label>
                    <div className="flex rounded-xl border border-c-border overflow-hidden">
                      {tabs.map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => set('llm_provider', tab.id)}
                          className={clsx(
                            'flex-1 py-2 text-sm font-medium transition-colors',
                            provider === tab.id
                              ? 'bg-accent-muted text-accent-primary border-b-2 border-accent-primary'
                              : 'text-c-muted hover:bg-c-elevated hover:text-c-text'
                          )}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10.5px] text-c-dim mt-1">{t('settings.llmProviderHint')}</div>
                  </div>

                  {/* Gemini settings */}
                  {provider === 'gemini' && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="text-xs text-c-muted mb-1 block">{t('settings.geminiApiKey')}</label>
                        <div className="relative">
                          <input
                            type={showKeys['gemini_api_key'] ? 'text' : 'password'}
                            className="input pr-10 font-mono text-sm"
                            placeholder="AIza..."
                            value={form['gemini_api_key'] ?? ''}
                            onChange={(e) => set('gemini_api_key', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKeys((s) => ({ ...s, gemini_api_key: !s['gemini_api_key'] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text"
                          >
                            {showKeys['gemini_api_key'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="text-xs text-c-dim mt-0.5">{t('settings.geminiHint')}</div>
                      </div>
                      <div>
                        <label className="text-xs text-c-muted mb-1.5 block">{t('settings.geminiModel')}</label>
                        <select className="input" value={form['gemini_model'] ?? 'gemini-2.5-flash'} onChange={(e) => set('gemini_model', e.target.value)}>
                          <option value="gemini-2.5-flash">Gemini 2.5 Flash — {t('settings.geminiModelFast')}</option>
                          <option value="gemini-2.5-pro">Gemini 2.5 Pro — {t('settings.geminiModelCapable')}</option>
                          <option value="gemini-2.0-flash">Gemini 2.0 Flash — {t('settings.geminiModelLegacy')}</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => testService('gemini')} disabled={testingService === 'gemini'} className="btn-secondary flex items-center gap-2 text-sm">
                          {testingService === 'gemini' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
                          {testingService === 'gemini' ? t('settings.testing') : t('settings.testGemini')}
                        </button>
                        {testResults['gemini'] !== undefined && (
                          <div className="flex items-center gap-1.5">
                            {testResults['gemini'] ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                            <Badge variant={testResults['gemini'] ? 'success' : 'error'}>{testResults['gemini'] ? t('settings.testPassed') : t('settings.testFailed')}</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Groq settings */}
                  {provider === 'groq' && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="text-xs text-c-muted mb-1 block">{t('settings.groqApiKey')}</label>
                        <div className="relative">
                          <input
                            type={showKeys['groq_api_key'] ? 'text' : 'password'}
                            className="input pr-10 font-mono text-sm"
                            placeholder={t('settings.keyPlaceholder')}
                            value={form['groq_api_key'] ?? ''}
                            onChange={(e) => set('groq_api_key', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKeys((s) => ({ ...s, groq_api_key: !s['groq_api_key'] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text"
                          >
                            {showKeys['groq_api_key'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="text-xs text-c-dim mt-0.5">{t('settings.groqHint')}</div>
                      </div>
                      <div>
                        <label className="text-xs text-c-muted mb-1.5 block">{t('settings.groqModel')}</label>
                        <select className="input" value={form['groq_model'] ?? 'llama-3.3-70b-versatile'} onChange={(e) => set('groq_model', e.target.value)}>
                          <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile — {t('settings.groqModelMostCapable')}</option>
                          <option value="llama-3.1-8b-instant">llama-3.1-8b-instant — {t('settings.groqModelFastest')}</option>
                          <option value="gemma2-9b-it">gemma2-9b-it — {t('settings.groqModelBalanced')}</option>
                          <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 — {t('settings.groqModelLongContext')}</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => testService('groq')} disabled={testingService === 'groq'} className="btn-secondary flex items-center gap-2 text-sm">
                          {testingService === 'groq' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
                          {testingService === 'groq' ? t('settings.testing') : t('settings.testGroq')}
                        </button>
                        {testResults['groq'] !== undefined && (
                          <div className="flex items-center gap-1.5">
                            {testResults['groq'] ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                            <Badge variant={testResults['groq'] ? 'success' : 'error'}>{testResults['groq'] ? t('settings.testPassed') : t('settings.testFailed')}</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* OpenRouter settings */}
                  {provider === 'openrouter' && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="text-xs text-c-muted mb-1 block">{t('settings.openrouterApiKey')}</label>
                        <div className="relative">
                          <input
                            type={showKeys['openrouter_api_key'] ? 'text' : 'password'}
                            className="input pr-10 font-mono text-sm"
                            placeholder="sk-or-..."
                            value={form['openrouter_api_key'] ?? ''}
                            onChange={(e) => set('openrouter_api_key', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKeys((s) => ({ ...s, openrouter_api_key: !s['openrouter_api_key'] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text"
                          >
                            {showKeys['openrouter_api_key'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="text-xs text-c-dim mt-0.5">{t('settings.openrouterHint')}</div>
                      </div>
                      <div>
                        <label className="text-xs text-c-muted mb-1.5 block">{t('settings.openrouterModel')}</label>
                        <select className="input" value={form['openrouter_model'] ?? 'meta-llama/llama-3.3-70b-instruct:free'} onChange={(e) => set('openrouter_model', e.target.value)}>
                          <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B — {t('settings.free')}</option>
                          <option value="deepseek/deepseek-chat-v3-0324:free">DeepSeek V3 — {t('settings.free')}</option>
                          <option value="qwen/qwen3-235b-a22b:free">Qwen3 235B — {t('settings.free')}</option>
                          <option value="google/gemini-2.5-flash-preview:free">Gemini 2.5 Flash — {t('settings.free')}</option>
                          <option value="mistralai/mistral-small-3.1-24b-instruct:free">Mistral Small 3.1 — {t('settings.free')}</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => testService('openrouter')} disabled={testingService === 'openrouter'} className="btn-secondary flex items-center gap-2 text-sm">
                          {testingService === 'openrouter' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
                          {testingService === 'openrouter' ? t('settings.testing') : t('settings.testOpenRouter')}
                        </button>
                        {testResults['openrouter'] !== undefined && (
                          <div className="flex items-center gap-1.5">
                            {testResults['openrouter'] ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                            <Badge variant={testResults['openrouter'] ? 'success' : 'error'}>{testResults['openrouter'] ? t('settings.testPassed') : t('settings.testFailed')}</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Cerebras settings */}
                  {provider === 'cerebras' && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="text-xs text-c-muted mb-1 block">{t('settings.cerebrasApiKey')}</label>
                        <div className="relative">
                          <input
                            type={showKeys['cerebras_api_key'] ? 'text' : 'password'}
                            className="input pr-10 font-mono text-sm"
                            placeholder="csk-..."
                            value={form['cerebras_api_key'] ?? ''}
                            onChange={(e) => set('cerebras_api_key', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKeys((s) => ({ ...s, cerebras_api_key: !s['cerebras_api_key'] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text"
                          >
                            {showKeys['cerebras_api_key'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="text-xs text-c-dim mt-0.5">{t('settings.cerebrasHint')}</div>
                      </div>
                      <div>
                        <label className="text-xs text-c-muted mb-1.5 block">{t('settings.cerebrasModel')}</label>
                        <select className="input" value={form['cerebras_model'] ?? 'llama-3.3-70b'} onChange={(e) => set('cerebras_model', e.target.value)}>
                          <option value="llama-3.3-70b">Llama 3.3 70B — {t('settings.cerebrasModelFast')}</option>
                          <option value="llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B — {t('settings.cerebrasModelSmall')}</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => testService('cerebras')} disabled={testingService === 'cerebras'} className="btn-secondary flex items-center gap-2 text-sm">
                          {testingService === 'cerebras' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
                          {testingService === 'cerebras' ? t('settings.testing') : t('settings.testCerebras')}
                        </button>
                        {testResults['cerebras'] !== undefined && (
                          <div className="flex items-center gap-1.5">
                            {testResults['cerebras'] ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                            <Badge variant={testResults['cerebras'] ? 'success' : 'error'}>{testResults['cerebras'] ? t('settings.testPassed') : t('settings.testFailed')}</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Grok (xAI) settings */}
                  {provider === 'grok' && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="text-xs text-c-muted mb-1 block">{t('settings.grokApiKey')}</label>
                        <div className="relative">
                          <input
                            type={showKeys['grok_api_key'] ? 'text' : 'password'}
                            className="input pr-10 font-mono text-sm"
                            placeholder="xai-..."
                            value={form['grok_api_key'] ?? ''}
                            onChange={(e) => set('grok_api_key', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKeys((s) => ({ ...s, grok_api_key: !s['grok_api_key'] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text"
                          >
                            {showKeys['grok_api_key'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="text-xs text-c-dim mt-0.5">{t('settings.grokLlmHint')}</div>
                      </div>
                      <div>
                        <label className="text-xs text-c-muted mb-1.5 block">{t('settings.grokModel')}</label>
                        <select className="input" value={form['grok_model'] ?? 'grok-3-mini'} onChange={(e) => set('grok_model', e.target.value)}>
                          <option value="grok-3-mini">Grok 3 Mini — Fast</option>
                          <option value="grok-3">Grok 3 — Most capable</option>
                          <option value="grok-2">Grok 2</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => testService('grok')} disabled={testingService === 'grok'} className="btn-secondary flex items-center gap-2 text-sm">
                          {testingService === 'grok' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
                          {testingService === 'grok' ? t('settings.testing') : t('settings.testGrok')}
                        </button>
                        {testResults['grok'] !== undefined && (
                          <div className="flex items-center gap-1.5">
                            {testResults['grok'] ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                            <Badge variant={testResults['grok'] ? 'success' : 'error'}>{testResults['grok'] ? t('settings.testPassed') : t('settings.testFailed')}</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ChatGPT (OpenAI) settings */}
                  {provider === 'openai' && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="text-xs text-c-muted mb-1 block">{t('settings.openaiApiKey')}</label>
                        <div className="relative">
                          <input
                            type={showKeys['openai_api_key'] ? 'text' : 'password'}
                            className="input pr-10 font-mono text-sm"
                            placeholder="sk-..."
                            value={form['openai_api_key'] ?? ''}
                            onChange={(e) => set('openai_api_key', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKeys((s) => ({ ...s, openai_api_key: !s['openai_api_key'] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text"
                          >
                            {showKeys['openai_api_key'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="text-xs text-c-dim mt-0.5">{t('settings.openaiLlmHint')}</div>
                      </div>
                      <div>
                        <label className="text-xs text-c-muted mb-1.5 block">{t('settings.openaiModel')}</label>
                        <select className="input" value={form['openai_model'] ?? 'gpt-4o-mini'} onChange={(e) => set('openai_model', e.target.value)}>
                          <option value="gpt-4o-mini">GPT-4o Mini — Fast & cheap</option>
                          <option value="gpt-4o">GPT-4o — Most capable</option>
                          <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                          <option value="gpt-4.1">GPT-4.1</option>
                          <option value="o4-mini">o4-mini — Reasoning</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => testService('openai')} disabled={testingService === 'openai'} className="btn-secondary flex items-center gap-2 text-sm">
                          {testingService === 'openai' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
                          {testingService === 'openai' ? t('settings.testing') : t('settings.testOpenai')}
                        </button>
                        {testResults['openai'] !== undefined && (
                          <div className="flex items-center gap-1.5">
                            {testResults['openai'] ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                            <Badge variant={testResults['openai'] ? 'success' : 'error'}>{testResults['openai'] ? t('settings.testPassed') : t('settings.testFailed')}</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Anthropic settings */}
                  {provider === 'anthropic' && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="text-xs text-c-muted mb-1 block">{t('settings.anthropicApiKey')}</label>
                        <div className="relative">
                          <input
                            type={showKeys['anthropic_api_key'] ? 'text' : 'password'}
                            className="input pr-10 font-mono text-sm"
                            placeholder="sk-ant-..."
                            value={form['anthropic_api_key'] ?? ''}
                            onChange={(e) => set('anthropic_api_key', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKeys((s) => ({ ...s, anthropic_api_key: !s['anthropic_api_key'] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text"
                          >
                            {showKeys['anthropic_api_key'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="text-xs text-c-dim mt-0.5">{t('settings.anthropicHint')}</div>
                      </div>
                      <div>
                        <label className="text-xs text-c-muted mb-1.5 block">{t('settings.anthropicModel')}</label>
                        <select className="input" value={form['anthropic_model'] ?? 'claude-sonnet-4-6'} onChange={(e) => set('anthropic_model', e.target.value)}>
                          <option value="claude-opus-4-6">Claude Opus 4.6 — {t('settings.anthropicModelMostCapable')}</option>
                          <option value="claude-sonnet-4-6">Claude Sonnet 4.6 — {t('settings.anthropicModelBalanced')}</option>
                          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 — {t('settings.anthropicModelFastest')}</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => testService('anthropic')} disabled={testingService === 'anthropic'} className="btn-secondary flex items-center gap-2 text-sm">
                          {testingService === 'anthropic' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
                          {testingService === 'anthropic' ? t('settings.testing') : t('settings.testAnthropic')}
                        </button>
                        {testResults['anthropic'] !== undefined && (
                          <div className="flex items-center gap-1.5">
                            {testResults['anthropic'] ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                            <Badge variant={testResults['anthropic'] ? 'success' : 'error'}>{testResults['anthropic'] ? t('settings.testPassed') : t('settings.testFailed')}</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Shared prompts (used by both providers) */}
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('settings.groqDescriptionPrompt')}</label>
              <div className="text-[10.5px] text-c-muted mb-2">{t('settings.groqDescriptionPromptHint')}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-blue-400 mb-1">EN</div>
                  <textarea
                    className="input min-h-[100px] font-mono text-[11px] leading-snug"
                    rows={5}
                    placeholder={t('settings.groqDescriptionPromptPlaceholder')}
                    value={form['groq_description_prompt'] ?? ''}
                    onChange={(e) => set('groq_description_prompt', e.target.value)}
                  />
                </div>
                <div>
                  <div className="text-xs font-medium text-yellow-400 mb-1">VI</div>
                  <textarea
                    className="input min-h-[100px] font-mono text-[11px] leading-snug"
                    rows={5}
                    placeholder="Ban la nguoi viet caption..."
                    value={form['groq_description_prompt_vi'] ?? ''}
                    onChange={(e) => set('groq_description_prompt_vi', e.target.value)}
                  />
                </div>
              </div>
              <div className="text-[10.5px] text-c-dim mt-1">{t('settings.groqDescriptionPromptLangHint')}</div>
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('settings.groqCreditTemplate')}</label>
              <input
                className="input font-mono text-[12px]"
                placeholder="Created by {author}"
                value={form['groq_description_credit_template'] ?? ''}
                onChange={(e) => set('groq_description_credit_template', e.target.value)}
              />
              <div className="text-[10.5px] text-c-muted mt-1">{t('settings.groqCreditTemplateHint')}</div>
            </div>
          </div>
        </section>

        </>)}

        {/* ═══ IMAGE TAB ═══ */}
        {activeTab === 'image' && (<>
        {/* Image Providers */}
        <section className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-green-400" />
            {t('settings.imageProviders')}
          </h2>
          <div className="text-xs text-c-dim mb-4">{t('settings.imageProvidersHint')}</div>

          <div className="space-y-4">
            {/* Pollinations */}
            <div className="border border-green-800/20 rounded-lg p-3 bg-green-900/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-c-text">Pollinations <span className="text-green-400 text-[10px]">FREE — No key needed</span></span>
                <span className="text-[10px] text-c-dim">{t('settings.pollinationsModelLabel')}</span>
              </div>
              <select
                className="input text-sm"
                value={form['pollinations_model'] ?? 'flux'}
                onChange={(e) => set('pollinations_model', e.target.value)}
              >
                <option value="flux">Flux (Default)</option>
                <option value="turbo">Turbo (Fast)</option>
                <option value="gptimage">GPT Image (Premium)</option>
                <option value="seedream">Seedream</option>
                <option value="seedream-pro">Seedream Pro</option>
                <option value="kontext">Kontext</option>
                <option value="nanobanana">NanoBanana</option>
                <option value="nanobanana-pro">NanoBanana Pro</option>
                <option value="zimage">ZImage</option>
              </select>
              <div className="text-[10.5px] text-c-dim">{t('settings.pollinationsHint')}</div>
            </div>

            {/* HuggingFace */}
            <div className="border border-c-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-c-text">HuggingFace <span className="text-green-400 text-[10px]">FREE</span></span>
                <span className="text-[10px] text-c-dim">SDXL</span>
              </div>
              <div className="relative">
                <input
                  type={showKeys['huggingface_api_key'] ? 'text' : 'password'}
                  className="input pr-10 font-mono text-sm"
                  placeholder="hf_... (optional)"
                  value={form['huggingface_api_key'] ?? ''}
                  onChange={(e) => set('huggingface_api_key', e.target.value)}
                />
                <button type="button" onClick={() => setShowKeys((s) => ({ ...s, huggingface_api_key: !s['huggingface_api_key'] }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text">
                  {showKeys['huggingface_api_key'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="text-[10.5px] text-c-dim">{t('settings.huggingfaceHint')}</div>
            </div>

          </div>

          <div className="mt-4 p-3 bg-cyan-900/10 border border-cyan-800/20 rounded-lg text-xs text-cyan-300/70">
            {t('settings.imageProvidersFallback')}
          </div>
        </section>
        </>)}

        {/* ═══ VIDEO TAB ═══ */}
        {activeTab === 'video' && (<>
        {/* Intro & Outro */}
        <section className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <Film className="w-4 h-4 text-purple-400" />
            {t('settings.introOutro')}
          </h2>

          <div className="space-y-5">
            {/* Intro */}
            <div className="border border-c-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-c-text">Intro</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-c-accent w-3.5 h-3.5"
                    checked={form['intro_enabled'] === '1'}
                    onChange={(e) => set('intro_enabled', e.target.checked ? '1' : '0')}
                  />
                  <span className="text-xs text-c-muted">{t('settings.introEnabled')}</span>
                </label>
              </div>
              <div className="text-xs text-c-dim">{t('settings.introEnabledHint')}</div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('settings.creatorName')}</label>
                  <input
                    className="input text-sm"
                    placeholder={t('settings.creatorNamePlaceholder')}
                    value={form['intro_creator_name'] ?? ''}
                    onChange={(e) => set('intro_creator_name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('settings.tagline')}</label>
                  <input
                    className="input text-sm"
                    placeholder={t('settings.taglinePlaceholder')}
                    value={form['intro_tagline'] ?? ''}
                    onChange={(e) => set('intro_tagline', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('settings.duration')}</label>
                  <select
                    className="input text-sm"
                    value={form['intro_duration'] ?? '3'}
                    onChange={(e) => set('intro_duration', e.target.value)}
                  >
                    {[2, 3, 4, 5].map((s) => (
                      <option key={s} value={String(s)}>{s}s</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('settings.introStyle')}</label>
                  <select
                    className="input text-sm"
                    value={form['intro_style'] ?? 'minimal'}
                    onChange={(e) => set('intro_style', e.target.value)}
                  >
                    <option value="minimal">{t('settings.introStyleMinimal')}</option>
                    <option value="cinematic">{t('settings.introStyleCinematic')}</option>
                    <option value="bold">{t('settings.introStyleBold')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('settings.accentColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="w-8 h-8 rounded cursor-pointer border border-c-border bg-transparent"
                      value={form['intro_accent_color'] ?? '#8578f6'}
                      onChange={(e) => set('intro_accent_color', e.target.value)}
                    />
                    <input
                      className="input text-xs font-mono flex-1"
                      value={form['intro_accent_color'] ?? '#8578f6'}
                      onChange={(e) => set('intro_accent_color', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Outro */}
            <div className="border border-c-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-c-text">Outro</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-c-accent w-3.5 h-3.5"
                    checked={form['outro_enabled'] === '1'}
                    onChange={(e) => set('outro_enabled', e.target.checked ? '1' : '0')}
                  />
                  <span className="text-xs text-c-muted">{t('settings.outroEnabled')}</span>
                </label>
              </div>
              <div className="text-xs text-c-dim">{t('settings.outroEnabledHint')}</div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('settings.creatorName')}</label>
                  <input
                    className="input text-sm"
                    placeholder={t('settings.creatorNamePlaceholder')}
                    value={form['outro_creator_name'] ?? ''}
                    onChange={(e) => set('outro_creator_name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('settings.socialHandle')}</label>
                  <input
                    className="input text-sm"
                    placeholder={t('settings.socialHandlePlaceholder')}
                    value={form['outro_social_handle'] ?? ''}
                    onChange={(e) => set('outro_social_handle', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-c-muted mb-1 block">{t('settings.ctaText')}</label>
                <input
                  className="input text-sm"
                  placeholder={t('settings.ctaTextPlaceholder')}
                  value={form['outro_cta_text'] ?? 'Follow for more!'}
                  onChange={(e) => set('outro_cta_text', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('settings.duration')}</label>
                  <select
                    className="input text-sm"
                    value={form['outro_duration'] ?? '3'}
                    onChange={(e) => set('outro_duration', e.target.value)}
                  >
                    {[2, 3, 4, 5].map((s) => (
                      <option key={s} value={String(s)}>{s}s</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('settings.accentColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="w-8 h-8 rounded cursor-pointer border border-c-border bg-transparent"
                      value={form['outro_accent_color'] ?? '#8578f6'}
                      onChange={(e) => set('outro_accent_color', e.target.value)}
                    />
                    <input
                      className="input text-xs font-mono flex-1"
                      value={form['outro_accent_color'] ?? '#8578f6'}
                      onChange={(e) => set('outro_accent_color', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Chrome path */}
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('settings.chromePath')}</label>
              <input
                className="input font-mono text-sm"
                placeholder={t('settings.chromePathPlaceholder')}
                value={form['chrome_executable_path'] ?? ''}
                onChange={(e) => set('chrome_executable_path', e.target.value)}
              />
              <div className="text-xs text-c-dim mt-0.5">{t('settings.chromePathHint')}</div>
            </div>

            <div className="p-3 bg-purple-900/10 border border-purple-800/20 rounded-lg text-xs text-purple-300/70">
              {t('settings.remotionNote')}
            </div>
          </div>
        </section>

        </>)}

        {/* ═══ NARRATION TAB ═══ */}
        {activeTab === 'narration' && (<>
        {/* Narration */}
        <section className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <Mic className="w-4 h-4 text-blue-400" />
            {t('settings.narration')}
          </h2>

          <div>
            <label className="text-xs text-c-muted mb-1.5 block">{t('settings.defaultVoice')}</label>
            <select
              className="input"
              value={form['default_voice'] ?? 'en-US-GuyNeural'}
              onChange={(e) => set('default_voice', e.target.value)}
            >
              {Object.entries(voicesByLang).map(([lang, voiceList]) => (
                <optgroup
                  key={lang}
                  label={voiceLangs[lang] ?? lang}
                >
                  {voiceList.map(([voiceId, info]) => (
                    <option key={voiceId} value={voiceId}>
                      {info.flag} {info.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Voice Controls Defaults */}
          <div className="mt-4 space-y-3">
            <div className="text-xs font-medium text-c-text">{t('settings.voiceControlsDefaults')}</div>

            <div className="grid grid-cols-3 gap-4">
              {/* Speed */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-c-muted">{t('tts.speed')}</label>
                  <div className="flex items-center gap-0.5">
                    <input type="number" min={-50} max={100} step={5}
                      value={form['default_tts_rate'] ?? '0'}
                      onChange={(e) => set('default_tts_rate', String(Math.min(100, Math.max(-50, Number(e.target.value) || 0))))}
                      className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                    <span className="text-xs text-c-dim">%</span>
                  </div>
                </div>
                <input type="range" min={-50} max={100} step={5}
                  value={Number(form['default_tts_rate'] ?? '0')}
                  onChange={(e) => set('default_tts_rate', e.target.value)}
                  className="w-full accent-cyan-500 h-1.5" />
              </div>

              {/* Pitch */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-c-muted">{t('tts.pitch')}</label>
                  <div className="flex items-center gap-0.5">
                    <input type="number" min={-50} max={50} step={5}
                      value={form['default_tts_pitch'] ?? '0'}
                      onChange={(e) => set('default_tts_pitch', String(Math.min(50, Math.max(-50, Number(e.target.value) || 0))))}
                      className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                    <span className="text-xs text-c-dim">Hz</span>
                  </div>
                </div>
                <input type="range" min={-50} max={50} step={5}
                  value={Number(form['default_tts_pitch'] ?? '0')}
                  onChange={(e) => set('default_tts_pitch', e.target.value)}
                  className="w-full accent-cyan-500 h-1.5" />
              </div>

              {/* Volume */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-c-muted">{t('tts.volume')}</label>
                  <div className="flex items-center gap-0.5">
                    <input type="number" min={-50} max={100} step={5}
                      value={form['default_tts_volume'] ?? '0'}
                      onChange={(e) => set('default_tts_volume', String(Math.min(100, Math.max(-50, Number(e.target.value) || 0))))}
                      className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                    <span className="text-xs text-c-dim">%</span>
                  </div>
                </div>
                <input type="range" min={-50} max={100} step={5}
                  value={Number(form['default_tts_volume'] ?? '0')}
                  onChange={(e) => set('default_tts_volume', e.target.value)}
                  className="w-full accent-cyan-500 h-1.5" />
              </div>
            </div>

            <div className="text-[10.5px] text-c-dim">{t('settings.voiceControlsDefaultsHint')}</div>
          </div>

          <div className="mt-3 p-3 bg-c-bg rounded-lg">
            <div className="text-xs text-c-muted">
              {t('settings.installEdgeTts')}
              <code className="text-accent-primary font-mono ml-1">pip install edge-tts</code>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => testService('edge-tts')}
              disabled={testingService === 'edge-tts'}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              {testingService === 'edge-tts' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
              {testingService === 'edge-tts' ? t('settings.testing') : t('settings.testEdgeTts')}
            </button>
            {testResults['edge-tts'] !== undefined && (
              <div className="flex items-center gap-1.5">
                {testResults['edge-tts']
                  ? <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                  : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                <Badge variant={testResults['edge-tts'] ? 'success' : 'error'}>
                  {testResults['edge-tts'] ? t('settings.testPassed') : t('settings.testFailed')}
                </Badge>
              </div>
            )}
          </div>
        </section>

        {/* Subtitles */}
        <section className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <Server className="w-4 h-4 text-amber-400" />
            {t('settings.subtitles')}
          </h2>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-c-muted mb-1.5 block">{t('settings.whisperModel')}</label>
                <select
                  className="input"
                  value={form['whisper_model'] ?? 'tiny'}
                  onChange={(e) => set('whisper_model', e.target.value)}
                >
                  {WHISPER_MODELS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-c-muted mb-1.5 block">{t('settings.whisperLanguage')}</label>
                <select
                  className="input"
                  value={form['whisper_language'] ?? 'en'}
                  onChange={(e) => set('whisper_language', e.target.value)}
                >
                  {WHISPER_LANGUAGES.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('settings.subtitleFontPath')}</label>
              <input
                className="input font-mono text-sm"
                placeholder={t('settings.fontPathPlaceholder')}
                value={form['subtitle_font_path'] ?? ''}
                onChange={(e) => set('subtitle_font_path', e.target.value)}
              />
              <div className="text-xs text-c-dim mt-1">{t('settings.fontHint')}</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-xs text-c-dim">{t('settings.commonFonts')}</span>
                {COMMON_VI_FONTS.map((f) => (
                  <button
                    key={f}
                    onClick={() => set('subtitle_font_path', f)}
                    className={clsx(
                      'text-xs px-2 py-0.5 rounded border transition-colors',
                      form['subtitle_font_path'] === f
                        ? 'border-accent-primary text-accent-hover bg-accent-muted'
                        : 'border-c-border text-c-dim hover:border-c-border-hi hover:text-c-muted'
                    )}
                  >
                    {f.split('/').pop()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('settings.subtitleFontSize')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={24}
                  max={80}
                  value={parseInt(form['subtitle_font_size'] ?? '52')}
                  onChange={(e) => set('subtitle_font_size', e.target.value)}
                  className="flex-1 accent-c-accent"
                />
                <span className="text-sm text-c-text font-mono w-8 text-center">
                  {form['subtitle_font_size'] ?? '52'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 p-3 bg-c-bg rounded-lg">
            <div className="text-xs text-c-muted">
              {t('settings.installWhisper')}
              <code className="text-accent-primary font-mono ml-1">pip install openai-whisper</code>
            </div>
          </div>
        </section>

        </>)}

        {/* ═══ MUSIC TAB ═══ */}
        {activeTab === 'music' && (<>
        {/* Jamendo Music */}
        <section className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <Music className="w-4 h-4 text-pink-400" />
            {t('music.title')}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('music.clientId')}</label>
              <div className="relative">
                <input
                  type={showKeys['jamendo_client_id'] ? 'text' : 'password'}
                  className="input pr-10 font-mono text-sm"
                  placeholder={t('music.clientIdPlaceholder')}
                  value={form['jamendo_client_id'] ?? ''}
                  onChange={(e) => set('jamendo_client_id', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowKeys((s) => ({ ...s, jamendo_client_id: !s['jamendo_client_id'] }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text"
                >
                  {showKeys['jamendo_client_id'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="text-xs text-c-dim mt-0.5">{t('music.clientIdHint')}</div>
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1.5 block">
                {t('music.volume')} — {Math.round(parseFloat(form['music_volume'] ?? '0.20') * 100)}%
              </label>
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={Math.round(parseFloat(form['music_volume'] ?? '0.20') * 100)}
                onChange={(e) => set('music_volume', String(parseInt(e.target.value) / 100))}
                className="w-full accent-c-accent"
              />
              <div className="flex justify-between text-xs text-c-dim mt-0.5">
                <span>0%</span><span>25%</span><span>50%</span>
              </div>
            </div>

            {/* Track search */}
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('music.searchByMood')}</label>
              <div className="flex gap-2">
                <select
                  className="input flex-1"
                  value={musicMood}
                  onChange={(e) => setMusicMood(e.target.value)}
                >
                  {MOODS.map((m) => (
                    <option key={m} value={m} className="capitalize">{m}</option>
                  ))}
                </select>
                <button
                  onClick={handleMusicSearch}
                  disabled={musicSearching || !form['jamendo_client_id']}
                  className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-40"
                >
                  {musicSearching ? <Spinner size="sm" /> : <Music className="w-3.5 h-3.5" />}
                  {musicSearching ? t('music.searching') : t('common.search')}
                </button>
              </div>
            </div>

            {/* Search results */}
            {musicSearchResults.length > 0 && (
              <div className="space-y-1.5 max-h-64 overflow-auto">
                {musicSearchResults.map((track) => (
                  <div key={track.id} className="flex items-center gap-3 bg-c-surface border border-c-border rounded-lg p-2.5">
                    {track.image && (
                      <img src={track.image} className="w-10 h-10 rounded object-cover shrink-0" alt="" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-c-text font-medium truncate">{track.name}</div>
                      <div className="text-xs text-c-dim truncate">{track.artist_name} · {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {track.audio && (
                        <a href={track.audio} target="_blank" rel="noreferrer"
                          className="p-1.5 rounded hover:bg-c-elevated text-c-muted hover:text-c-text">
                          <Play className="w-3 h-3" />
                        </a>
                      )}
                      <button
                        onClick={() => handleDownloadTrack(track)}
                        disabled={downloadingTrack === track.id}
                        className="btn-secondary text-xs py-1 px-2"
                      >
                        {downloadingTrack === track.id ? <Spinner size="sm" /> : t('music.download')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {musicSearchResults.length === 0 && !musicSearching && (
              <div className="text-xs text-c-dim">{t('music.noResults')}</div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => testService('jamendo')}
                disabled={testingService === 'jamendo'}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                {testingService === 'jamendo' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
                {testingService === 'jamendo' ? t('settings.testing') : t('settings.testJamendo')}
              </button>
              {testResults['jamendo'] !== undefined && (
                <div className="flex items-center gap-1.5">
                  {testResults['jamendo']
                    ? <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                  <Badge variant={testResults['jamendo'] ? 'success' : 'error'}>
                    {testResults['jamendo'] ? t('settings.testPassed') : t('settings.testFailed')}
                  </Badge>
                </div>
              )}
            </div>

            {/* Cached tracks */}
            {(cachedTracks?.length ?? 0) > 0 && (
              <div className="flex items-center justify-between pt-2 border-t border-c-border">
                <span className="text-xs text-c-muted">
                  {cachedTracks?.length} {t('music.cached')}
                </span>
                <button
                  onClick={handleClearMusicCache}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-3 h-3" />
                  {t('music.clearCache')}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* FFmpeg */}
        <section className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-green-400" />
            {t('settings.ffmpeg')}
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('settings.ffmpegPath')}</label>
              <input
                className="input font-mono"
                value={form['ffmpeg_path'] ?? 'ffmpeg'}
                onChange={(e) => set('ffmpeg_path', e.target.value)}
                placeholder="ffmpeg"
              />
            </div>
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('settings.ffprobePath')}</label>
              <input
                className="input font-mono"
                value={form['ffprobe_path'] ?? 'ffprobe'}
                onChange={(e) => set('ffprobe_path', e.target.value)}
                placeholder="ffprobe"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="text-xs text-c-muted mb-1.5 block">{t('settings.ytDlpPath')}</label>
            <input
              className="input font-mono text-sm"
              value={form['yt_dlp_path'] ?? 'yt-dlp'}
              onChange={(e) => set('yt_dlp_path', e.target.value)}
              placeholder="yt-dlp"
            />
            <div className="text-xs text-c-dim mt-0.5">{t('settings.ytDlpHint')}</div>
          </div>

          <div className="mt-3 p-3 bg-c-bg rounded-lg text-xs text-c-muted">
            {t('settings.downloadFfmpeg')}{' '}
            <span className="text-accent-primary">ffmpeg.org</span> {t('settings.addToPath')}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => testService('ffmpeg')}
              disabled={testingService === 'ffmpeg'}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              {testingService === 'ffmpeg' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
              {testingService === 'ffmpeg' ? t('settings.testing') : t('settings.testFfmpeg')}
            </button>
            {testResults['ffmpeg'] !== undefined && (
              <div className="flex items-center gap-1.5">
                {testResults['ffmpeg']
                  ? <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                  : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                <Badge variant={testResults['ffmpeg'] ? 'success' : 'error'}>
                  {testResults['ffmpeg'] ? t('settings.testPassed') : t('settings.testFailed')}
                </Badge>
              </div>
            )}
          </div>
        </section>
        </>)}

        </div>{/* end space-y-6 */}
      </div>

      {/* Floating save bar */}
      <div className={clsx(
        'fixed bottom-0 left-0 right-0 z-50 transition-all duration-300',
        dirty ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
      )}>
        <div className="mx-auto max-w-2xl px-6 pb-4">
          <div className="flex items-center justify-between gap-4 bg-c-surface border border-c-border-hi rounded-xl px-5 py-3 shadow-2xl shadow-black/60 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm text-c-muted">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              {t('settings.unsavedChanges')}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (savedSettings) { setForm(savedSettings); setDirty(false); }
                }}
                className="btn-secondary text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {saveMutation.isPending ? <Spinner size="sm" /> : <Save className="w-4 h-4" />}
                {saveMutation.isPending ? t('settings.saving') : t('settings.saveSettings')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
