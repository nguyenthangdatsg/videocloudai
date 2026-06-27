import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ttsApi } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { Spinner } from '../components/ui/Spinner';
import {
  Upload, FileAudio, Copy, Download, Clock, Play, Pause,
  FileText, List, CheckCircle,
} from 'lucide-react';
import { clsx } from 'clsx';

interface TranscriptEntry {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
  startMs: number;
  endMs: number;
}

interface TranscriptResult {
  text: string;
  entries: TranscriptEntry[];
  duration: number;
  srtPath: string;
}

export function Transcribe() {
  const { t } = useTranslation();

  const [file, setFile] = useState<File | null>(null);
  const [selectedHistoryFile, setSelectedHistoryFile] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'full' | 'segments'>('full');
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Audio playback for segments
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: history } = useQuery({
    queryKey: ['tts', 'history'],
    queryFn: ttsApi.history,
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setSelectedHistoryFile(''); }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setSelectedHistoryFile(''); }
  }, []);

  const handleTranscribe = async () => {
    setIsTranscribing(true);
    setProgress([]);
    setResult(null);
    setError(null);

    try {
      const res = await ttsApi.transcribe(
        {
          file: file ?? undefined,
          filename: selectedHistoryFile || undefined,
        },
        (step, detail) => setProgress((prev) => [...prev, `[${step}] ${detail ?? ''}`]),
      );
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSrt = () => {
    if (!result?.srtPath) return;
    const a = document.createElement('a');
    a.href = `/api/tts/transcribe/srt/${result.srtPath}`;
    a.download = result.srtPath;
    a.click();
  };

  const playSegment = (entry: TranscriptEntry) => {
    if (!audioRef.current) return;
    const url = file
      ? URL.createObjectURL(file)
      : selectedHistoryFile
        ? `/api/tts/audio/${selectedHistoryFile}`
        : null;
    if (!url) return;

    if (playingUrl && audioRef.current.src) {
      audioRef.current.pause();
      setPlayingUrl(null);
    }

    audioRef.current.src = url;
    audioRef.current.currentTime = entry.startMs / 1000;
    audioRef.current.play();
    setPlayingUrl(`${entry.index}`);

    const endTime = entry.endMs / 1000;
    const checkEnd = setInterval(() => {
      if (audioRef.current && audioRef.current.currentTime >= endTime) {
        audioRef.current.pause();
        setPlayingUrl(null);
        clearInterval(checkEnd);
      }
    }, 100);
  };

  const canTranscribe = (file || selectedHistoryFile) && !isTranscribing;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title={t('tts.transcribeTitle')} subtitle={t('tts.transcribeSubtitle')} />

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-5">

          {/* ═══ Upload area ═══ */}
          <div
            className={clsx(
              'border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer',
              dragOver
                ? 'border-cyan-500 bg-cyan-900/20'
                : file
                  ? 'border-green-600/50 bg-green-900/10'
                  : 'border-c-border hover:border-c-border-hi'
            )}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,.ogg,.m4a,.aac,.flac,.webm,.mp4"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileAudio className="w-6 h-6 text-green-400" />
                <div>
                  <div className="text-sm text-c-text">{file.name}</div>
                  <div className="text-xs text-c-dim">{(file.size / 1024).toFixed(0)} KB</div>
                </div>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-c-dim mx-auto mb-2" />
                <div className="text-sm text-c-muted">{t('tts.dragDropAudio')}</div>
                <div className="text-xs text-c-dim mt-1">{t('tts.supportedFormats')}</div>
              </>
            )}
          </div>

          {/* ═══ Or select from history ═══ */}
          {history && history.length > 0 && (
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('tts.orSelectHistory')}</label>
              <select
                value={selectedHistoryFile}
                onChange={(e) => { setSelectedHistoryFile(e.target.value); if (e.target.value) setFile(null); }}
                className="input text-sm w-full"
              >
                <option value="">--</option>
                {history.map((f) => (
                  <option key={f.filename} value={f.filename}>
                    {f.filename} — {f.duration > 0 ? `${f.duration.toFixed(1)}s` : ''} ({f.sizeKB} KB)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ═══ Transcribe button ═══ */}
          <button
            onClick={handleTranscribe}
            disabled={!canTranscribe}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            {isTranscribing ? <Spinner size="sm" /> : <FileText className="w-4 h-4" />}
            {isTranscribing ? t('tts.transcribing') : t('tts.transcribe')}
          </button>

          {/* ═══ Progress ═══ */}
          {isTranscribing && progress.length > 0 && (
            <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10">
              <div className="flex items-center gap-2 mb-1">
                <Spinner size="sm" />
                <span className="text-xs font-medium text-cyan-300">{t('tts.transcribing')}</span>
              </div>
              <div className="font-mono text-[11px] text-c-dim space-y-0.5">
                {progress.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ Error ═══ */}
          {error && (
            <div className="border border-red-800/30 rounded-xl p-3 bg-red-900/10 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* ═══ Result ═══ */}
          {result && (
            <div className="border border-green-800/30 rounded-xl bg-green-900/5 overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 border-b border-green-800/20 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-green-300">{t('tts.transcribeResult')}</span>
                <span className="text-xs text-c-dim ml-auto">
                  {result.entries.length} {t('tts.segments').toLowerCase()} · {result.duration.toFixed(1)}s
                </span>
              </div>

              {/* Actions bar */}
              <div className="px-4 py-2 border-b border-green-800/20 flex items-center gap-2">
                <div className="flex rounded-lg border border-c-border overflow-hidden">
                  {(['full', 'segments'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={clsx(
                        'text-xs px-3 py-1.5 flex items-center gap-1.5 transition-colors',
                        viewMode === mode
                          ? 'bg-cyan-900/30 text-cyan-300'
                          : 'text-c-muted hover:text-c-text'
                      )}
                    >
                      {mode === 'full' ? <FileText className="w-3 h-3" /> : <List className="w-3 h-3" />}
                      {mode === 'full' ? t('tts.fullText') : t('tts.segments')}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={handleCopy} className="btn-secondary text-xs flex items-center gap-1.5">
                    <Copy className="w-3 h-3" />
                    {copied ? t('tts.copied') : t('tts.copyText')}
                  </button>
                  <button onClick={handleDownloadSrt} className="btn-secondary text-xs flex items-center gap-1.5">
                    <Download className="w-3 h-3" />
                    {t('tts.downloadSrt')}
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 max-h-[500px] overflow-auto">
                {viewMode === 'full' ? (
                  <p className="text-sm text-c-text leading-relaxed whitespace-pre-wrap select-all">
                    {result.text}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {result.entries.map((entry) => (
                      <div
                        key={entry.index}
                        className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-c-surface transition-colors group"
                      >
                        <button
                          onClick={() => playSegment(entry)}
                          className={clsx(
                            'w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5 transition-colors',
                            playingUrl === `${entry.index}`
                              ? 'bg-cyan-900/40 text-cyan-300'
                              : 'bg-c-bg text-c-dim group-hover:text-c-muted'
                          )}
                        >
                          {playingUrl === `${entry.index}`
                            ? <Pause className="w-2.5 h-2.5" />
                            : <Play className="w-2.5 h-2.5" />}
                        </button>
                        <div className="flex items-center gap-2 shrink-0 w-32">
                          <Clock className="w-3 h-3 text-c-dim" />
                          <span className="text-[11px] font-mono text-cyan-300/70">
                            {entry.startTime.split(',')[0]} → {entry.endTime.split(',')[0]}
                          </span>
                        </div>
                        <span className="text-sm text-c-text flex-1">{entry.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <audio ref={audioRef} className="hidden" onEnded={() => setPlayingUrl(null)} />
    </div>
  );
}
