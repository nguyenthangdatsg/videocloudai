import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { storyboardApi, imageApi, ttsApi, settingsApi, musicApi } from '../../lib/api';
import type { StoryboardSegment, StoryboardPromptItem, MotionEffect, SubtitleStyle } from '../../lib/api';
import { TopBar } from '../../components/layout/TopBar';
import { Spinner } from '../../components/ui/Spinner';
import {
  Film, Mic, Image, ArrowRight,
  X, Download, CheckCircle, Clock, FileText, Upload,
  Wand2, Save, Tag,
  ChevronDown, ChevronUp, FileUp,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useImageGenStore } from '../../store/image-generation';
import type { GenImage, GenMediaType } from '../../store/image-generation';

import type { WorkflowStep, TranscriptEntry, StagePart } from './types';
import { mergeToSentences, splitSegment, msToTimeStr } from './utils';
import { StoryboardProvider } from './StoryboardContext';
import {
  TopicsStep,
  ScriptStep,
  AudioStep,
  PromptsStep,
  ImagesStep,
  TimelineStep,
  MetadataStep,
  AssembleStep,
} from './components';

export function Storyboard() {
  const { t } = useTranslation();
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState('');
  const [projectLoaded, setProjectLoaded] = useState(false);

  const [step, setStep] = useState<WorkflowStep>('topics');

  // Template
  const [templateText, setTemplateText] = useState('');
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [templateSections, setTemplateSections] = useState<Record<string, string>>({});
  const [templateStageParts, setTemplateStageParts] = useState<Record<string, StagePart[]>>({});
  const [showTemplate, setShowTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const templateFileRef = useRef<HTMLInputElement>(null);

  // Per-step editable prompts (extracted from template, editable by user)
  const [topicsPrompt, setTopicsPrompt] = useState('');
  const [scriptPrompt, setScriptPrompt] = useState('');
  const [imagePromptPrompt, setImagePromptPrompt] = useState('');
  const [metadataPrompt, setMetadataPrompt] = useState('');
  const [savingPrompt, setSavingPrompt] = useState<string | null>(null);

  // Step 0: Topics
  const [topicIdeas, setTopicIdeas] = useState<string[]>([]);
  const [generatingTopics, setGeneratingTopics] = useState(false);

  // Step 1: Script
  const [scriptText, setScriptText] = useState('');
  const [scriptTopic, setScriptTopic] = useState('');
  const [scriptDuration, setScriptDuration] = useState(600);
  const [generatingScript, setGeneratingScript] = useState(false);

  // Step 2: Audio + Transcribe
  const [voice, setVoice] = useState('en-US-GuyNeural');
  const [langFilter, setLangFilter] = useState('all');
  const [ttsRate, setTtsRate] = useState(0);
  const [ttsPitch, setTtsPitch] = useState(0);
  const [ttsVolume, setTtsVolume] = useState(0);
  const [ttsStyle, setTtsStyle] = useState('');
  const [voicePreviewLoading, setVoicePreviewLoading] = useState(false);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);
  const [voicePreviewPlaying, setVoicePreviewPlaying] = useState(false);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState<string[]>([]);
  const [audioFile, setAudioFile] = useState<{ filename: string; url: string; duration: number } | null>(null);
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);

  // Step 3: Image prompts
  const [prompts, setPrompts] = useState<StoryboardPromptItem[]>([]);
  const [generatingPrompts, setGeneratingPrompts] = useState(false);
  const [promptProgress, setPromptProgress] = useState<string[]>([]);
  const promptAbortRef = useRef<AbortController | null>(null);
  const [editingPromptIdx, setEditingPromptIdx] = useState<number | null>(null);

  // Step 4: Image generation (global store — survives navigation)
  const imageGenStore = useImageGenStore();
  const bgTask = useImageGenStore((s) => projectId ? s.tasks.get(projectId) : undefined);
  const [generatedImages, setGeneratedImages] = useState<GenImage[]>([]);
  const generatingImages = bgTask?.running ?? false;
  const imageProgress = bgTask?.progress ?? [];
  const [provider, setProvider] = useState('auto');
  const [imageModel, setImageModel] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [uploadingZip, setUploadingZip] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const imageCardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [imageTab, setImageTab] = useState<'generate' | 'upload' | 'flow'>('flow');
  const [flowAvailable, setFlowAvailable] = useState(false);
  const [flowProvider, setFlowProvider] = useState<'google-flow' | 'grok' | 'chatgpt'>('google-flow');
  const [mediaType, setMediaType] = useState<GenMediaType>('image');
  const [videoDuration, setVideoDuration] = useState(5);

  // Fetch available image providers (with models)
  const { data: imageProviders } = useQuery({
    queryKey: ['image', 'providers'],
    queryFn: imageApi.providers,
    staleTime: 60_000,
  });
  const selectedProviderInfo = imageProviders?.find((p) => p.id === provider);

  // Step 5: Timeline
  const [segments, setSegments] = useState<StoryboardSegment[]>([]);
  const [timeFormat, setTimeFormat] = useState<'seconds' | 'minutes'>('seconds');
  const [trackZoom, setTrackZoom] = useState(150);
  const [trackHeight, setTrackHeight] = useState(224);
  const [frameHoldTime, setFrameHoldTime] = useState(0);
  const [frameTransition, setFrameTransition] = useState<'voice' | 'hold'>('voice');
  const trackDragRef = useRef<{ startX: number; scrollLeft: number; raf: number | null } | null>(null);
  const [trackGrabbing, setTrackGrabbing] = useState(false);
  const manualScrolling = useRef(false);

  // Background music
  const [bgMusicFilename, setBgMusicFilename] = useState<string>('');
  const [voiceVolume, setVoiceVolume] = useState(1.0);
  const [musicVolume, setMusicVolume] = useState(0.3);

  // Step 6: Metadata & Thumbnail
  const [generatingMetadata, setGeneratingMetadata] = useState(false);
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataDesc, setMetadataDesc] = useState('');
  const [metadataTags, setMetadataTags] = useState<string[]>([]);
  const [metadataThumbnailPrompt, setMetadataThumbnailPrompt] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false);
  const [thumbnailProgress, setThumbnailProgress] = useState('');
  const [generatingThumbnailPrompt, setGeneratingThumbnailPrompt] = useState(false);
  const [thumbnailBgColor, setThumbnailBgColor] = useState('');

  // Step 7: Assemble
  const [assembling, setAssembling] = useState(false);
  const assembleAbortRef = useRef<AbortController | null>(null);
  const [speed, setSpeed] = useState<number>(1.0);
  const [bgColor, setBgColor] = useState<string>('black');
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({
    enabled: true,
    fontFamily: 'Arial',
    fontSize: 48,
    fontColor: '#FFFFFF',
    fontWeight: 'bold',
    strokeColor: '#000000',
    strokeWidth: 2,
    bgColor: '#000000',
    bgOpacity: 0.5,
    position: 'bottom',
    alignment: 'center',
    marginX: 40,
    marginBottom: 60,
    uppercase: false,
    animation: 'none',
  });
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [assembleProgress, setAssembleProgress] = useState<string[]>([]);
  const audioLogRef = useRef<HTMLDivElement>(null);
  const promptLogRef = useRef<HTMLDivElement>(null);
  const assembleLogRef = useRef<HTMLDivElement>(null);
  const [assembleStep, setAssembleStep] = useState<string>('');
  const [assembleClipProgress, setAssembleClipProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [result, setResult] = useState<{ filename: string; url: string; sizeKB: number; duration: number } | null>(null);

  // Auto-scroll progress logs
  useEffect(() => {
    if (audioLogRef.current) {
      const el = audioLogRef.current;
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [audioProgress]);
  useEffect(() => {
    if (promptLogRef.current) {
      const el = promptLogRef.current;
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [promptProgress]);
  useEffect(() => {
    if (assembleLogRef.current) {
      const el = assembleLogRef.current;
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [assembleProgress]);

  const allEffects: MotionEffect[] = ['static', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'];
  const [randomEffects, setRandomEffects] = useState<Set<MotionEffect>>(new Set(['zoom-in', 'zoom-out', 'pan-left', 'pan-right']));
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [playingSegment, setPlayingSegment] = useState<number | null>(null);
  const [playheadTime, setPlayheadTime] = useState<number | null>(null);
  const segAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgMusicAudioRef = useRef<HTMLAudioElement | null>(null);
  const segAudioTimerRef = useRef<number | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // Drag & drop reorder
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragAllowed = useRef(false);
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    if (!dragAllowed.current) { e.preventDefault(); return; }
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };
  const handleDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    dragAllowed.current = false;
    if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    setSegments(prev => {
      const copy = [...prev];
      const fromImg = copy[dragIdx].imageFilename;
      const fromUrl = copy[dragIdx].imageUrl;
      copy[dragIdx] = { ...copy[dragIdx], imageFilename: copy[toIdx].imageFilename, imageUrl: copy[toIdx].imageUrl };
      copy[toIdx] = { ...copy[toIdx], imageFilename: fromImg, imageUrl: fromUrl };
      return copy;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // Auto-merge: when segment time extends past neighbor, absorb it
  const updateSegmentTimeAutoMerge = (idx: number, field: 'startTime' | 'endTime', value: number) => {
    setSegments(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      while (field === 'endTime' && idx < copy.length - 1 && value >= copy[idx + 1].endTime) {
        copy[idx] = { ...copy[idx], endTime: copy[idx + 1].endTime, text: [copy[idx].text, copy[idx + 1].text].filter(Boolean).join(' ') };
        copy.splice(idx + 1, 1);
      }
      while (field === 'startTime' && idx > 0 && value <= copy[idx - 1].startTime) {
        copy[idx] = { ...copy[idx], startTime: copy[idx - 1].startTime, text: [copy[idx - 1].text, copy[idx].text].filter(Boolean).join(' ') };
        copy.splice(idx - 1, 1);
        idx--;
      }
      return copy;
    });
  };

  // Drag edge on overview track
  const trackEdgeRef = useRef<{ idx: number; startX: number; origTime: number; pxPerSec: number; raf: number | null } | null>(null);
  const handleTrackEdgeDrag = (e: React.MouseEvent, boundaryIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const segs = segmentsRef.current;
    if (boundaryIdx < 0 || boundaryIdx >= segs.length - 1) return;
    const scrollEl = timelineTrackRef.current;
    if (!scrollEl) return;
    const totalDur = segs[segs.length - 1]?.endTime || 1;
    const trackInnerW = scrollEl.scrollWidth;
    const pxPerSec = trackInnerW / totalDur;
    const origTime = segs[boundaryIdx].endTime;
    trackEdgeRef.current = { idx: boundaryIdx, startX: e.clientX, origTime, pxPerSec, raf: null };

    let pendingTime: number | null = null;

    const applyUpdate = () => {
      if (trackEdgeRef.current) trackEdgeRef.current.raf = null;
      if (pendingTime === null) return;
      const t = pendingTime;
      pendingTime = null;
      setSegments(prev => {
        const copy = [...prev];
        const idx = trackEdgeRef.current?.idx ?? boundaryIdx;
        if (idx < 0 || idx >= copy.length - 1) return prev;
        copy[idx] = { ...copy[idx], endTime: t };
        copy[idx + 1] = { ...copy[idx + 1], startTime: t };
        return copy;
      });
    };

    const onMove = (me: MouseEvent) => {
      if (!trackEdgeRef.current) return;
      const { startX, origTime: ot, pxPerSec: pps, idx } = trackEdgeRef.current;
      const dx = me.clientX - startX;
      const dtSec = dx / pps;
      const curSegs = segmentsRef.current;
      const minDur = 0.3;
      const minBound = curSegs[idx].startTime + minDur;
      const maxBound = curSegs[idx + 1].endTime - minDur;
      pendingTime = Math.round(Math.max(minBound, Math.min(maxBound, ot + dtSec)) * 100) / 100;
      if (!trackEdgeRef.current.raf) {
        trackEdgeRef.current.raf = requestAnimationFrame(applyUpdate);
      }
    };
    const onUp = () => {
      if (trackEdgeRef.current?.raf) cancelAnimationFrame(trackEdgeRef.current.raf);
      if (pendingTime !== null) {
        pendingTime = Math.round(pendingTime * 10) / 10;
        applyUpdate();
      }
      setSegments(prev => prev.map(s => ({
        ...s,
        startTime: Math.round(s.startTime * 10) / 10,
        endTime: Math.round(s.endTime * 10) / 10,
      })));
      trackEdgeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Drag-to-resize on card duration bar
  const cardResizeRef = useRef<{ idx: number; startX: number; origEnd: number; origStart: number; maxEnd: number; barWidth: number } | null>(null);
  const handleCardResizeStart = (e: React.MouseEvent, idx: number, barEl: HTMLDivElement) => {
    e.preventDefault();
    const seg = segments[idx];
    const maxEnd = idx < segments.length - 1 ? segments[segments.length - 1].endTime : seg.endTime + 10;
    const barRect = barEl.getBoundingClientRect();
    cardResizeRef.current = { idx, startX: e.clientX, origEnd: seg.endTime, origStart: seg.startTime, maxEnd, barWidth: barRect.width };
    const onMove = (me: MouseEvent) => {
      if (!cardResizeRef.current) return;
      const { startX, origEnd, origStart, maxEnd: mEnd, barWidth } = cardResizeRef.current;
      const dx = me.clientX - startX;
      const totalRange = mEnd - origStart;
      const dtSec = (dx / barWidth) * totalRange;
      const minDur = 0.3;
      const newEnd = Math.round(Math.max(origStart + minDur, Math.min(mEnd, origEnd + dtSec)) * 10) / 10;
      updateSegmentTimeAutoMerge(cardResizeRef.current.idx, 'endTime', newEnd);
    };
    const onUp = () => {
      cardResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const [isAudioPaused, setIsAudioPaused] = useState(false);

  // Background music sync
  const syncBgMusic = useCallback((time: number, play: boolean) => {
    if (!bgMusicFilename) {
      if (bgMusicAudioRef.current) { bgMusicAudioRef.current.pause(); bgMusicAudioRef.current = null; }
      return;
    }
    if (!bgMusicAudioRef.current) {
      bgMusicAudioRef.current = new Audio();
      bgMusicAudioRef.current.loop = true;
    }
    const bgAudio = bgMusicAudioRef.current;
    const streamUrl = musicApi.streamUrl(bgMusicFilename);
    if (!bgAudio.src.includes(encodeURIComponent(bgMusicFilename))) {
      bgAudio.src = streamUrl;
    }
    bgAudio.volume = musicVolume;
    if (bgAudio.duration && isFinite(bgAudio.duration)) {
      bgAudio.currentTime = time % bgAudio.duration;
    } else {
      bgAudio.currentTime = 0;
    }
    if (play) bgAudio.play().catch(() => {});
    else bgAudio.pause();
  }, [bgMusicFilename, musicVolume]);

  useEffect(() => {
    if (bgMusicAudioRef.current) bgMusicAudioRef.current.volume = musicVolume;
  }, [musicVolume]);

  useEffect(() => {
    if (segAudioRef.current) segAudioRef.current.volume = voiceVolume;
  }, [voiceVolume]);

  // Playback polling
  const startPlaybackPoll = useCallback(() => {
    if (segAudioTimerRef.current) clearInterval(segAudioTimerRef.current);
    const audio = segAudioRef.current;
    if (!audio) return;
    segAudioTimerRef.current = window.setInterval(() => {
      const segs = segmentsRef.current;
      const endTime = segs[segs.length - 1]?.endTime || 0;
      if (audio.currentTime >= endTime) {
        audio.pause();
        bgMusicAudioRef.current?.pause();
        if (segAudioTimerRef.current) clearInterval(segAudioTimerRef.current);
        segAudioTimerRef.current = null;
        setPlayingSegment(null);
        setPlayheadTime(null);
        setIsAudioPaused(false);
      } else {
        const ct = audio.currentTime;
        setPlayheadTime(ct);
        const activeIdx = segs.findIndex((s, si) =>
          ct >= s.startTime && (si === segs.length - 1 ? ct <= s.endTime : ct < s.endTime)
        );
        if (activeIdx >= 0) setPlayingSegment(activeIdx);
        if (!manualScrolling.current) {
          const scrollEl = timelineTrackRef.current;
          if (scrollEl) {
            const playheadX = (ct / endTime) * scrollEl.scrollWidth;
            scrollEl.scrollLeft = playheadX - scrollEl.clientWidth / 2;
          }
        }
      }
    }, 50);
  }, []);

  const playSegmentAudio = useCallback((idx: number) => {
    if (!audioFile) return;
    const seg = segments[idx];
    if (!seg) return;
    if (segAudioTimerRef.current) { clearInterval(segAudioTimerRef.current); segAudioTimerRef.current = null; }
    if (playingSegment === idx && !isAudioPaused) {
      segAudioRef.current?.pause();
      syncBgMusic(0, false);
      setPlayingSegment(null);
      setPlayheadTime(null);
      setIsAudioPaused(false);
      return;
    }
    if (!segAudioRef.current) {
      segAudioRef.current = new Audio();
    }
    const audio = segAudioRef.current;
    audio.src = audioFile.url;
    audio.volume = voiceVolume;
    audio.currentTime = seg.startTime;
    audio.play();
    syncBgMusic(seg.startTime, true);
    setPlayingSegment(idx);
    setPlayheadTime(seg.startTime);
    setIsAudioPaused(false);
    startPlaybackPoll();
  }, [audioFile, segments, playingSegment, isAudioPaused, startPlaybackPoll, syncBgMusic, voiceVolume]);

  const pauseAudio = useCallback(() => {
    if (!segAudioRef.current) return;
    segAudioRef.current.pause();
    bgMusicAudioRef.current?.pause();
    if (segAudioTimerRef.current) { clearInterval(segAudioTimerRef.current); segAudioTimerRef.current = null; }
    setIsAudioPaused(true);
  }, []);

  const resumeAudio = useCallback(() => {
    const audio = segAudioRef.current;
    if (!audio || !audioFile) return;
    audio.play();
    bgMusicAudioRef.current?.play().catch(() => {});
    setIsAudioPaused(false);
    startPlaybackPoll();
  }, [audioFile, startPlaybackPoll]);

  const stopAudio = useCallback(() => {
    if (segAudioTimerRef.current) { clearInterval(segAudioTimerRef.current); segAudioTimerRef.current = null; }
    segAudioRef.current?.pause();
    bgMusicAudioRef.current?.pause();
    setPlayingSegment(null);
    setPlayheadTime(null);
    setIsAudioPaused(false);
  }, []);

  const skipSegment = useCallback((dir: -1 | 1) => {
    if (!audioFile || segments.length === 0) return;
    const current = playingSegment ?? 0;
    const next = Math.max(0, Math.min(segments.length - 1, current + dir));
    playSegmentAudio(next);
  }, [audioFile, segments, playingSegment, playSegmentAudio]);

  const seekToTime = useCallback((time: number) => {
    if (!audioFile) return;
    if (!segAudioRef.current) {
      segAudioRef.current = new Audio();
    }
    const audio = segAudioRef.current;
    audio.src = audioFile.url;
    audio.volume = voiceVolume;
    audio.currentTime = time;
    setPlayheadTime(time);
    const segs = segmentsRef.current;
    const activeIdx = segs.findIndex((s, si) =>
      time >= s.startTime && (si === segs.length - 1 ? time <= s.endTime : time < s.endTime)
    );
    if (activeIdx >= 0) setPlayingSegment(activeIdx);
    audio.play();
    syncBgMusic(time, true);
    setIsAudioPaused(false);
    startPlaybackPoll();
  }, [audioFile, startPlaybackPoll, syncBgMusic, voiceVolume]);

  // Check if Google Flow extension bridge is available
  useEffect(() => {
    const onPong = () => setFlowAvailable(true);
    window.addEventListener('Han2YT_flow_pong', onPong);
    window.dispatchEvent(new CustomEvent('Han2YT_flow_ping'));
    const timer = setTimeout(() => window.dispatchEvent(new CustomEvent('Han2YT_flow_ping')), 1500);
    return () => {
      window.removeEventListener('Han2YT_flow_pong', onPong);
      clearTimeout(timer);
    };
  }, []);

  // Cleanup segment audio on unmount
  useEffect(() => {
    return () => {
      if (segAudioTimerRef.current) clearInterval(segAudioTimerRef.current);
      segAudioRef.current?.pause();
      bgMusicAudioRef.current?.pause();
      bgMusicAudioRef.current = null;
      setPlayheadTime(null);
    };
  }, []);

  const [error, setError] = useState<string | null>(null);
  const projectPromptsRef = useRef<Record<string, string>>({});

  const [savedPromptStage, setSavedPromptStage] = useState<string | null>(null);
  const handleSaveStagePrompt = async (stage: string, prompt: string) => {
    setSavingPrompt(stage);
    setSavedPromptStage(null);
    try {
      if (projectTemplateId) {
        await storyboardApi.saveTemplatePrompt(projectTemplateId, stage, prompt);
      } else {
        await storyboardApi.savePrompt(stage, prompt);
      }
      const projectKeyMap: Record<string, string> = {
        topics: 'topicsPrompt', script: 'scriptPrompt',
        prompts: 'imagePromptPrompt', metadata: 'metadataPrompt',
      };
      if (projectKeyMap[stage]) {
        saveProject({ [projectKeyMap[stage]]: prompt, stageParts: templateStageParts });
        projectPromptsRef.current[stage] = prompt;
      }
      setSavedPromptStage(stage);
      setTimeout(() => setSavedPromptStage(null), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingPrompt(null);
    }
  };

  // Voices query
  const { data: voices } = useQuery({
    queryKey: ['tts', 'voices'],
    queryFn: ttsApi.voices,
  });

  // Settings query — apply voice defaults once
  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  const [settingsApplied, setSettingsApplied] = useState(false);
  useEffect(() => {
    if (!appSettings || settingsApplied || projectLoaded) return;
    if (appSettings.default_voice) setVoice(appSettings.default_voice);
    if (appSettings.default_tts_rate) setTtsRate(Number(appSettings.default_tts_rate) || 0);
    if (appSettings.default_tts_pitch) setTtsPitch(Number(appSettings.default_tts_pitch) || 0);
    if (appSettings.default_tts_volume) setTtsVolume(Number(appSettings.default_tts_volume) || 0);
    if (appSettings.default_tts_style) setTtsStyle(appSettings.default_tts_style);
    setSettingsApplied(true);
  }, [appSettings, settingsApplied, projectLoaded]);

  // Track which template this project uses
  const [projectTemplateId, setProjectTemplateId] = useState<string | null>(null);

  const { data: linkedTemplate } = useQuery({
    queryKey: ['storyboard', 'templates', projectTemplateId],
    queryFn: () => storyboardApi.getTemplateById(projectTemplateId!),
    enabled: !!projectTemplateId,
    staleTime: 0,
  });

  // Shared: apply parsed sections + stageParts to state
  const applySections = useCallback((sections: Record<string, string>, stageParts?: Record<string, StagePart[]>) => {
    setTemplateSections(sections);
    setTemplateStageParts(prev => {
      const tpl = stageParts || {};
      const merged = { ...tpl };
      for (const key of Object.keys(prev)) {
        if (prev[key]?.length) merged[key] = prev[key];
      }
      return merged;
    });
    setTemplateLoaded(true);
    const pp = projectPromptsRef.current;
    if (sections.topicsSystemPrompt && !pp.topics) setTopicsPrompt(sections.topicsSystemPrompt);
    if (sections.scriptSystemPrompt && !pp.script) setScriptPrompt(sections.scriptSystemPrompt);
    if (sections.imagePromptSystemPrompt && !pp.prompts) setImagePromptPrompt(sections.imagePromptSystemPrompt);
    if (sections.metadataSystemPrompt && !pp.metadata) setMetadataPrompt(sections.metadataSystemPrompt);
  }, []);

  // Apply linked template
  const [linkedTemplateApplied, setLinkedTemplateApplied] = useState(false);
  useEffect(() => {
    if (!linkedTemplate || linkedTemplateApplied || !projectLoaded) return;
    const sp = linkedTemplate.stagePrompts;
    const hasContent = linkedTemplate.templateText || sp?.topics || sp?.script || sp?.prompts || sp?.metadata;
    if (!hasContent) return;
    if (linkedTemplate.templateText) {
      setTemplateText(linkedTemplate.templateText);
      setTemplateSections(linkedTemplate.sections);
      setTemplateStageParts(prev => {
        const tpl = linkedTemplate.stageParts || {};
        const merged = { ...tpl };
        for (const key of Object.keys(prev)) {
          if (prev[key]?.length) merged[key] = prev[key];
        }
        return merged;
      });
    }
    setTemplateLoaded(true);
    setLinkedTemplateApplied(true);
    const pp = projectPromptsRef.current;
    if (!pp.topics) setTopicsPrompt(sp?.topics || linkedTemplate.sections.topicsSystemPrompt || '');
    if (!pp.script) setScriptPrompt(sp?.script || linkedTemplate.sections.scriptSystemPrompt || '');
    if (!pp.prompts) setImagePromptPrompt(sp?.prompts || linkedTemplate.sections.imagePromptSystemPrompt || '');
    if (!pp.metadata) setMetadataPrompt(sp?.metadata || linkedTemplate.sections.metadataSystemPrompt || '');
  }, [linkedTemplate, linkedTemplateApplied, projectLoaded]);

  // Fallback: apply global template if linked template is empty or absent
  const linkedTemplateEmpty = linkedTemplate && !linkedTemplate.templateText
    && !linkedTemplate.stagePrompts?.topics && !linkedTemplate.stagePrompts?.script
    && !linkedTemplate.stagePrompts?.prompts && !linkedTemplate.stagePrompts?.metadata;
  const { data: savedTemplate } = useQuery({
    queryKey: ['storyboard', 'template'],
    queryFn: storyboardApi.getTemplate,
    enabled: !projectTemplateId || !!linkedTemplateEmpty,
  });
  useEffect(() => {
    if (projectLoaded && (!projectTemplateId || linkedTemplateEmpty) && savedTemplate?.template && !templateLoaded) {
      setTemplateText(savedTemplate.template);
      applySections(savedTemplate.sections, savedTemplate.stageParts);
    }
  }, [savedTemplate, projectTemplateId, projectLoaded, templateLoaded, applySections, linkedTemplateEmpty]);

  // Load project from DB on mount (with retry on transient failures)
  const [loadRetries, setLoadRetries] = useState(0);
  useEffect(() => {
    if (!projectId || projectLoaded) return;
    (async () => {
      try {
        const p = await storyboardApi.getProject(projectId);
        setProjectName(p.name);
        if (p.templateId) setProjectTemplateId(p.templateId);
        setStep(p.currentStep as WorkflowStep);
        if (p.topic) setScriptTopic(p.topic);
        if (p.script) setScriptText(p.script);
        if (p.scriptDuration) setScriptDuration(p.scriptDuration);
        if (p.voice) setVoice(p.voice);
        if (p.audioFilename) setAudioFile({ filename: p.audioFilename, url: `/api/tts/audio/${p.audioFilename}`, duration: p.audioDuration || 0 });
        if (p.transcriptEntries?.length) setTranscriptEntries(p.transcriptEntries);
        if (p.prompts?.length) setPrompts(p.prompts);
        if (p.generatedImages?.length) {
          if (p.prompts?.length && p.generatedImages.length !== p.prompts.length) {
            setGeneratedImages([]);
          } else {
            setGeneratedImages(p.generatedImages.map((img) => ({ ...img, status: img.status === 'generating' ? 'pending' : (img.status as 'done' | 'pending' | 'error') })));
          }
        }
        if (p.segments?.length) setSegments(p.segments.map((s) => ({ ...s, motion: s.motion || 'static' })));
        if (p.metadataTitle) setMetadataTitle(p.metadataTitle);
        if (p.metadataDesc) setMetadataDesc(p.metadataDesc);
        if (p.metadataTags?.length) setMetadataTags(p.metadataTags);
        if (p.thumbnailUrl) setThumbnailUrl(p.thumbnailUrl);
        if (p.thumbnailPrompt) setMetadataThumbnailPrompt(p.thumbnailPrompt);
        if (p.thumbnailBgColor) setThumbnailBgColor(p.thumbnailBgColor);
        if (p.resultFilename) setResult({ filename: p.resultFilename, url: p.resultUrl || '', sizeKB: p.resultSizeKB || 0, duration: p.audioDuration || 0 });
        if (p.bgMusicFilename) setBgMusicFilename(p.bgMusicFilename);
        if (p.voiceVolume != null) setVoiceVolume(p.voiceVolume);
        if (p.musicVolume != null) setMusicVolume(p.musicVolume);
        setSpeed(p.speed ?? 1.0);
        setBgColor(p.bgColor ?? 'black');
        if (p.subtitleStyle) setSubtitleStyle(prev => ({ ...prev, ...p.subtitleStyle }));
        if (p.topicsPrompt) setTopicsPrompt(p.topicsPrompt);
        if (p.scriptPrompt) setScriptPrompt(p.scriptPrompt);
        if (p.imagePromptPrompt) setImagePromptPrompt(p.imagePromptPrompt);
        if (p.metadataPrompt) setMetadataPrompt(p.metadataPrompt);
        if (p.stageParts && Object.keys(p.stageParts).length) setTemplateStageParts(p.stageParts);
        projectPromptsRef.current = {
          topics: p.topicsPrompt || '',
          script: p.scriptPrompt || '',
          prompts: p.imagePromptPrompt || '',
          metadata: p.metadataPrompt || '',
        };
        setProjectLoaded(true);
      } catch (err: unknown) {
        const is404 = err instanceof Error && 'response' in err && (err as { response?: { status?: number } }).response?.status === 404;
        if (is404) {
          // Project truly doesn't exist — go back
          navigate('/storyboard');
        } else if (loadRetries < 3) {
          // Transient error (server busy, network hiccup) — retry after delay
          setTimeout(() => setLoadRetries(r => r + 1), 1500 * (loadRetries + 1));
        } else {
          // Exhausted retries — show error instead of silently redirecting
          setError(`Failed to load project. The server may be busy. Please try again.`);
          setProjectLoaded(true);
        }
      }
    })();
  }, [projectId, projectLoaded, navigate, loadRetries]);

  // Sync background image generation task into local state
  useEffect(() => {
    if (!bgTask) return;
    setGeneratedImages(bgTask.images);
    if (!bgTask.running && bgTask.images.some((i) => i.status === 'done')) {
      setStep('images');
    }
    if (bgTask.running) {
      const genIdx = bgTask.images.findIndex((i) => i.status === 'generating');
      if (genIdx >= 0) {
        imageCardRefs.current[genIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [bgTask]);

  // Auto-save project state
  const saveProject = useCallback(async (updates: Record<string, unknown>) => {
    if (!projectId) return;
    try {
      await storyboardApi.updateProject(projectId, updates as never);
    } catch { /* silent */ }
  }, [projectId]);

  // Save template to backend + reload parsed sections
  const saveAndApplyTemplate = async (text: string) => {
    setSavingTemplate(true);
    try {
      if (projectTemplateId) {
        await storyboardApi.updateTemplate(projectTemplateId, { templateText: text.trim() } as never);
        const loaded = await storyboardApi.getTemplateById(projectTemplateId);
        setTemplateText(loaded.templateText);
        applySections(loaded.sections, loaded.stageParts);
        const sp = loaded.stagePrompts;
        if (sp?.topics) setTopicsPrompt(sp.topics);
        if (sp?.script) setScriptPrompt(sp.script);
        if (sp?.prompts) setImagePromptPrompt(sp.prompts);
        if (sp?.metadata) setMetadataPrompt(sp.metadata);
      } else {
        await storyboardApi.saveTemplate(text.trim());
        const loaded = await storyboardApi.getTemplate();
        setTemplateText(loaded.template);
        applySections(loaded.sections, loaded.stageParts);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSaveTemplate = () => {
    if (!templateText.trim()) return;
    saveAndApplyTemplate(templateText);
  };

  const handleTemplateFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setTemplateText(text);
      setShowTemplate(true);
      saveAndApplyTemplate(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // ── Step 0: Generate Topics ──
  const handleGenerateTopics = async () => {
    setGeneratingTopics(true);
    setError(null);
    try {
      const topics = await storyboardApi.generateTopics(5, topicsPrompt.trim() || undefined, projectTemplateId, topicIdeas);
      setTopicIdeas(prev => [...prev, ...topics]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingTopics(false);
    }
  };

  const handlePickTopic = (topic: string) => {
    setScriptTopic(topic);
    setStep('script');
    saveProject({ topic, currentStep: 'script' });
  };

  // ── Step 1: Generate Script ──
  const handleGenerateScript = async () => {
    if (!scriptTopic.trim()) return;
    setGeneratingScript(true);
    setError(null);
    try {
      const script = await storyboardApi.generateScript({
        topic: scriptTopic.trim(),
        duration: scriptDuration,
        systemPrompt: scriptPrompt.trim() || undefined,
      });
      setScriptText(script);
      saveProject({ script, scriptDuration });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingScript(false);
    }
  };

  // ── Step 2: Generate TTS + Transcribe ──
  const fmtRate = ttsRate >= 0 ? `+${ttsRate}%` : `${ttsRate}%`;
  const fmtPitch = ttsPitch >= 0 ? `+${ttsPitch}Hz` : `${ttsPitch}Hz`;
  const fmtVolume = ttsVolume >= 0 ? `+${ttsVolume}%` : `${ttsVolume}%`;

  const handleVoicePreview = async () => {
    if (voicePreviewPlaying && voicePreviewRef.current) {
      voicePreviewRef.current.pause();
      voicePreviewRef.current = null;
      setVoicePreviewPlaying(false);
      return;
    }
    setVoicePreviewLoading(true);
    try {
      const blob = await ttsApi.preview({
        voice,
        rate: fmtRate,
        pitch: fmtPitch,
        volume: fmtVolume,
        style: ttsStyle || undefined,
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      voicePreviewRef.current = audio;
      audio.onended = () => { setVoicePreviewPlaying(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setVoicePreviewPlaying(false); URL.revokeObjectURL(url); };
      await audio.play();
      setVoicePreviewPlaying(true);
    } catch (err) {
      console.error('Voice preview failed:', err);
    } finally {
      setVoicePreviewLoading(false);
    }
  };

  const handleGenerateAudio = async () => {
    if (!scriptText.trim()) return;
    setGeneratingAudio(true);
    setAudioProgress([]);
    setError(null);
    try {
      const { audio, entries } = await storyboardApi.generateTts(
        {
          text: scriptText.trim(),
          voice,
          rate: fmtRate,
          pitch: fmtPitch,
          volume: fmtVolume,
          style: ttsStyle || undefined,
        },
        (_step, detail) => { if (detail) setAudioProgress((p) => [...p, detail]); },
      );
      setAudioFile(audio);
      const mergedEntries = mergeToSentences(entries);
      setTranscriptEntries(mergedEntries);
      setStep('audio');
      saveProject({ voice, audioFilename: audio.filename, audioDuration: audio.duration, transcriptEntries: mergedEntries, currentStep: 'audio' });

      if (segments.length > 0 && entries.length > 0) {
        if (generatedImages.length > 0) {
          try {
            const matched = await storyboardApi.match({
              segments: entries.map((e) => ({ startMs: e.startMs, endMs: e.endMs, text: e.text })),
              images: generatedImages.map((img) => ({ filename: img.filename || '', url: img.url || '', timestamp: img.timestamp })),
            });
            const synced = matched.map((seg, i) => ({
              ...seg,
              motion: segments[i]?.motion || seg.motion,
            }));
            setSegments(synced);
            saveProject({ segments: synced });
          } catch { /* silent */ }
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingAudio(false);
    }
  };

  const handleSplitEntry = (entryIndex: number, maxSec: number) => {
    setTranscriptEntries(prev => {
      const idx = prev.findIndex(e => e.index === entryIndex);
      if (idx === -1) return prev;
      const target = prev[idx];
      const splits = splitSegment(target, maxSec * 1000);
      const next = [...prev];
      next.splice(idx, 1, ...splits);
      for (let i = 0; i < next.length; i++) {
        next[i].index = i + 1;
        next[i].startTime = msToTimeStr(next[i].startMs);
        next[i].endTime = msToTimeStr(next[i].endMs);
      }
      saveProject({ transcriptEntries: next });
      return next;
    });
  };

  const handleMergeEntry = (entryIndex: number, direction: 'prev' | 'next') => {
    setTranscriptEntries(prev => {
      const idx = prev.findIndex(e => e.index === entryIndex);
      if (idx === -1) return prev;
      const targetIdx = direction === 'prev' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const keptIdx = direction === 'prev' ? targetIdx : idx;
      const removedIdx = direction === 'prev' ? idx : targetIdx;
      const merged = {
        ...prev[keptIdx],
        text: prev[keptIdx].text + ' ' + prev[removedIdx].text,
        startMs: Math.min(prev[keptIdx].startMs, prev[removedIdx].startMs),
        endMs: Math.max(prev[keptIdx].endMs, prev[removedIdx].endMs),
      };
      const next = prev.filter((_, i) => i !== removedIdx);
      next[keptIdx] = merged;
      for (let i = 0; i < next.length; i++) {
        next[i] = { ...next[i], index: i + 1 };
        next[i].startTime = msToTimeStr(next[i].startMs);
        next[i].endTime = msToTimeStr(next[i].endMs);
      }
      saveProject({ transcriptEntries: next });
      return next;
    });
  };

  const handleSplitAtCursor = (entryIndex: number, cursorPos: number, currentText?: string) => {
    setTranscriptEntries(prev => {
      const idx = prev.findIndex(e => e.index === entryIndex);
      if (idx === -1) return prev;
      const target = prev[idx];
      const text = currentText ?? target.text;
      const textBefore = text.slice(0, cursorPos).trim();
      const textAfter = text.slice(cursorPos).trim();
      if (!textBefore || !textAfter) return prev;
      const totalMs = target.endMs - target.startMs;
      const ratio = textBefore.length / text.length;
      const splitMs = Math.round(target.startMs + totalMs * ratio);
      const next = [...prev];
      next.splice(idx, 1, {
        ...target, text: textBefore, endMs: splitMs,
      }, {
        ...target, text: textAfter, startMs: splitMs,
      });
      for (let i = 0; i < next.length; i++) {
        next[i].index = i + 1;
        next[i].startTime = msToTimeStr(next[i].startMs);
        next[i].endTime = msToTimeStr(next[i].endMs);
      }
      saveProject({ transcriptEntries: next });
      return next;
    });
  };

  const handleUpdateEntryText = (entryIndex: number, text: string) => {
    setTranscriptEntries(prev => {
      const next = prev.map(e => e.index === entryIndex ? { ...e, text } : e);
      saveProject({ transcriptEntries: next });
      return next;
    });
  };

  const handleRetranscribe = () => {
    setTranscriptEntries(prev => {
      // Flatten all entries into one continuous block, then re-run smart segmentation
      const flat: TranscriptEntry[] = prev.map((e, i) => ({ ...e, index: i + 1 }));
      const result = mergeToSentences(flat);
      saveProject({ transcriptEntries: result });
      return result;
    });
  };

  const handleAutoSeparate = (maxSec = 3) => {
    const maxMs = maxSec * 1000;
    setTranscriptEntries(prev => {
      let changed = false;
      const next: TranscriptEntry[] = [];
      for (const e of prev) {
        const dur = e.endMs - e.startMs;
        const remainder = dur % maxMs;
        // Only split if remainder >= 2s, otherwise the last piece would be too short
        if (remainder >= 2000 ? dur > maxMs : dur > maxMs + maxMs) {
          // If remainder < 2s, use fewer splits so no piece is under maxSec
          const splitMs = remainder >= 2000 ? maxMs : Math.ceil(dur / Math.floor(dur / maxMs));
          const splits = splitSegment(e, splitMs);
          next.push(...splits);
          changed = true;
        } else {
          next.push(e);
        }
      }
      if (!changed) return prev;
      for (let i = 0; i < next.length; i++) {
        next[i].index = i + 1;
        next[i].startTime = msToTimeStr(next[i].startMs);
        next[i].endTime = msToTimeStr(next[i].endMs);
      }
      saveProject({ transcriptEntries: next });
      return next;
    });
  };

  // ── Step 3: Generate Image Prompts ──
  const handleGeneratePrompts = async () => {
    if (!transcriptEntries.length) return;
    const abort = new AbortController();
    promptAbortRef.current = abort;
    setGeneratingPrompts(true);
    setPromptProgress([]);
    setError(null);

    const segs = transcriptEntries.map((e) => {
      const ms = e.startMs;
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return {
        timestamp: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
        text: e.text,
      };
    });

    try {
      const result = await storyboardApi.generatePrompts(
        { segments: segs, styleTemplate: imagePromptPrompt.trim() || undefined, visualStyle: linkedTemplate?.visualStyle || undefined, aspectRatio },
        (_step, detail) => { if (detail) setPromptProgress((p) => [...p, detail]); },
        abort.signal,
      );
      setPrompts(result);
      setGeneratedImages([]);
      setStep('prompts');
      saveProject({ prompts: result, generatedImages: [], currentStep: 'prompts' });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
      }
    } finally {
      promptAbortRef.current = null;
      setGeneratingPrompts(false);
    }
  };

  const handleStopPrompts = () => {
    promptAbortRef.current?.abort();
    promptAbortRef.current = null;
  };

  const [regenPromptIdx, setRegenPromptIdx] = useState<number | null>(null);
  const regenQueueRef = useRef<number[]>([]);
  const regenProcessingRef = useRef(false);

  const processRegenQueue = async () => {
    if (regenProcessingRef.current) return;
    regenProcessingRef.current = true;
    while (regenQueueRef.current.length > 0) {
      const idx = regenQueueRef.current.shift()!;
      setRegenPromptIdx(idx);
      try {
        // Read latest prompts from state via updater pattern
        let currentPrompt: { timestamp: string; text: string; prompt: string } | null = null;
        setPrompts(prev => { currentPrompt = prev[idx] || null; return prev; });
        if (!currentPrompt) continue;
        const p = currentPrompt as { timestamp: string; text: string; prompt: string };
        const result = await storyboardApi.generatePrompts(
          { segments: [{ timestamp: p.timestamp, text: p.text }], styleTemplate: imagePromptPrompt.trim() || undefined, visualStyle: linkedTemplate?.visualStyle || undefined, aspectRatio },
          () => {},
        );
        if (result.length > 0 && result[0].prompt) {
          setPrompts(prev => {
            const updated = prev.map((pp, j) => j === idx ? { ...pp, prompt: result[0].prompt } : pp);
            saveProject({ prompts: updated });
            return updated;
          });
        }
      } catch (err) {
        setError((err as Error).message);
      }
    }
    setRegenPromptIdx(null);
    regenProcessingRef.current = false;
  };

  const handleRegenPrompt = (idx: number) => {
    if (regenQueueRef.current.includes(idx)) return;
    regenQueueRef.current.push(idx);
    processRegenQueue();
  };

  // ── Step 4: Batch Generate Images ──
  const handleGenerateImages = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    imageGenStore.startGeneration(
      projectId,
      prompts.map((p) => ({ timestamp: p.timestamp, prompt: p.prompt })),
      aspectRatio,
      provider,
      imageModel || undefined,
    );
  };

  const handleGenerateVideos = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    imageGenStore.startFlowGeneration(
      projectId,
      prompts.map((p) => ({ timestamp: p.timestamp, prompt: p.prompt })),
      'video',
      undefined,
      flowProvider,
    );
  };

  const handleStopImages = () => {
    if (projectId) imageGenStore.stopGeneration(projectId);
  };

  const handleUploadZip = async (file: File) => {
    if (!file || !projectId) return;
    setUploadingZip(true);
    setError(null);
    try {
      const { images } = await imageApi.uploadZip(file);
      const mapped: GenImage[] = images.map((img, i) => ({
        timestamp: prompts[i]?.timestamp || `${String(i + 1).padStart(3, '0')}`,
        filename: img.filename,
        url: img.url,
        status: 'done' as const,
      }));
      setGeneratedImages(mapped);
      saveProject({ generatedImages: mapped, currentStep: 'images' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingZip(false);
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  };

  // Extension-based generation
  const handleFlowGenerate = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    if (generatedImages.length > 0 && generatedImages.some((i) => i.status === 'done')) {
      const pendingPrompts = prompts
        .filter((_, i) => {
          const img = generatedImages[i];
          return !img || img.status !== 'done';
        })
        .map((p) => ({ timestamp: p.timestamp, prompt: p.prompt }));
      if (!pendingPrompts.length) return;
      imageGenStore.startFlowGeneration(projectId, pendingPrompts, 'image', generatedImages, flowProvider);
    } else {
      imageGenStore.startFlowGeneration(
        projectId,
        prompts.map((p) => ({ timestamp: p.timestamp, prompt: p.prompt })),
        'image',
        undefined,
        flowProvider,
      );
    }
  };

  const handleFlowRegenerateAll = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    const promptTexts = prompts.map(p => p.prompt).filter(Boolean);
    if (promptTexts.length) imageApi.clearPromptCache(promptTexts);
    imageGenStore.startFlowGeneration(
      projectId,
      prompts.map((p) => ({ timestamp: p.timestamp, prompt: p.prompt })),
      'image',
      undefined,
      flowProvider,
    );
  };

  const failedImageCount = generatedImages.filter((i) => i.status === 'error' || i.status === 'pending').length;
  const handleFlowResume = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    const failedPrompts = prompts
      .filter((_, i) => {
        const img = generatedImages[i];
        return !img || img.status === 'error' || img.status === 'pending';
      })
      .map((p) => ({ timestamp: p.timestamp, prompt: p.prompt }));
    if (!failedPrompts.length) return;
    imageGenStore.startFlowGeneration(projectId, failedPrompts, 'image', generatedImages, flowProvider);
    const idx = generatedImages.findIndex((i) => i.status === 'error' || i.status === 'pending');
    if (idx >= 0) {
      requestAnimationFrame(() => {
        imageCardRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  };

  // Regenerate single image
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [editingImageIdx, setEditingImageIdx] = useState<number | null>(null);
  const [editingImagePrompt, setEditingImagePrompt] = useState('');

  const handleRegenSingle = (idx: number, overrideProvider?: 'google-flow' | 'grok' | 'chatgpt') => {
    if (!projectId || !prompts[idx]) return;
    const useProvider = overrideProvider ?? flowProvider;
    if (regenIndex !== null) {
      setGeneratedImages((prev) =>
        prev.map((img, i) => i === regenIndex && img.status === 'generating' ? { ...img, status: 'error' as const } : img),
      );
    }
    setRegenIndex(idx);
    setGeneratedImages((prev) =>
      prev.map((img, i) => i === idx ? { ...img, status: 'generating' as const } : img),
    );

    const onProgress = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.index !== 0) return;
    };
    const onImage = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.index !== 0) return;
      if (d.status === 'done') {
        setGeneratedImages((prev) => {
          const updated = prev.map((img, i) => i === idx ? { ...img, filename: d.filename, url: d.url, status: 'done' as const } : img);
          saveProject({ generatedImages: updated });
          return updated;
        });
      } else {
        setGeneratedImages((prev) =>
          prev.map((img, i) => i === idx ? { ...img, status: 'error' as const } : img),
        );
      }
    };
    const cleanup = () => {
      window.removeEventListener('Han2YT_flow_progress', onProgress);
      window.removeEventListener('Han2YT_flow_image', onImage);
      window.removeEventListener('Han2YT_flow_done', onDone);
      window.removeEventListener('Han2YT_flow_error', onError);
      setRegenIndex(null);
    };
    const onDone = () => { cleanup(); };
    const onError = () => {
      setGeneratedImages((prev) =>
        prev.map((img, i) => i === idx ? { ...img, status: 'error' as const } : img),
      );
      cleanup();
    };

    window.addEventListener('Han2YT_flow_progress', onProgress);
    window.addEventListener('Han2YT_flow_image', onImage);
    window.addEventListener('Han2YT_flow_done', onDone);
    window.addEventListener('Han2YT_flow_error', onError);

    window.dispatchEvent(new CustomEvent('Han2YT_flow_start', {
      detail: {
        prompts: [{ timestamp: prompts[idx].timestamp, prompt: prompts[idx].prompt }],
        delayMin: 0,
        delayMax: 0,
        mediaType,
        provider: useProvider,
      },
    }));
  };

  const handleDropImage = (idx: number) => {
    setGeneratedImages((prev) => {
      const updated = prev.map((img, i) =>
        i === idx ? { ...img, filename: '', url: '', status: 'pending' as const } : img,
      );
      saveProject({ generatedImages: updated });
      return updated;
    });
  };

  const handleImportFromUrl = (idx: number) => {
    const url = prompt(t('storyboard.importFromUrlPrompt'));
    if (!url || !/^https?:\/\//i.test(url)) return;
    setGeneratedImages((prev) => {
      const updated = prev.map((img, i) =>
        i === idx ? { ...img, status: 'generating' as const } : img,
      );
      return updated;
    });
    imageApi.importFromUrl(url)
      .then((result) => {
        setGeneratedImages((prev) => {
          const updated = prev.map((img, i) =>
            i === idx ? { ...img, filename: result.filename, url: result.url, status: 'done' as const } : img,
          );
          saveProject({ generatedImages: updated });
          return updated;
        });
      })
      .catch((err) => {
        setGeneratedImages((prev) => {
          const updated = prev.map((img, i) =>
            i === idx ? { ...img, status: 'error' as const } : img,
          );
          return updated;
        });
        alert(t('storyboard.importFromUrlError') + ': ' + (err?.response?.data?.error || err.message));
      });
  };

  // ── Step 5: Auto-match to timeline ──
  const handleBuildTimeline = async () => {
    if (!generatedImages.length) return;
    setError(null);

    try {
      let segSource: Array<{ startMs: number; endMs: number; text: string }>;

      if (generatedImages.length > transcriptEntries.length && prompts.length >= generatedImages.length) {
        const audioDurationMs = (audioFile?.duration || 0) * 1000;
        segSource = prompts.map((p, i) => {
          const parts = p.timestamp.split(':').map(Number);
          const startMs = parts.length === 3 ? (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
            : (parts[0] * 60 + parts[1]) * 1000;
          const nextP = prompts[i + 1];
          let endMs: number;
          if (nextP) {
            const np = nextP.timestamp.split(':').map(Number);
            endMs = np.length === 3 ? (np[0] * 3600 + np[1] * 60 + np[2]) * 1000
              : (np[0] * 60 + np[1]) * 1000;
          } else {
            endMs = audioDurationMs || startMs + 5000;
          }
          return { startMs, endMs: Math.max(endMs, startMs + 500), text: p.text };
        });
      } else if (transcriptEntries.length > 0) {
        segSource = transcriptEntries.map((e) => ({ startMs: e.startMs, endMs: e.endMs, text: e.text }));
      } else {
        const totalMs = (audioFile?.duration || generatedImages.length * 5) * 1000;
        const stepMs = totalMs / generatedImages.length;
        segSource = generatedImages.map((_, i) => ({
          startMs: Math.round(i * stepMs),
          endMs: Math.round((i + 1) * stepMs),
          text: prompts[i]?.text || '',
        }));
      }

      if (frameTransition === 'voice') {
        segSource = segSource.map((seg, i, arr) => {
          const nextStart = arr[i + 1]?.startMs;
          return { ...seg, endMs: nextStart != null ? nextStart : seg.endMs };
        });
      } else if (frameTransition === 'hold' && frameHoldTime > 0) {
        const holdMs = frameHoldTime * 1000;
        segSource = segSource.map((seg, i, arr) => {
          const voiceEnd = seg.endMs;
          const nextStart = arr[i + 1]?.startMs;
          const maxEnd = nextStart != null ? nextStart : voiceEnd + holdMs;
          return { ...seg, endMs: Math.min(voiceEnd + holdMs, maxEnd) };
        });
      }

      const matched = await storyboardApi.match({
        segments: segSource,
        images: generatedImages.map((img) => {
          const isVideo = img.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(img.filename || '');
          return {
            filename: img.filename || '', url: img.url || '', timestamp: img.timestamp,
            mediaType: isVideo ? 'video' as const : img.mediaType,
            videoFilename: isVideo ? img.filename : undefined,
            videoUrl: isVideo ? img.url : undefined,
          };
        }),
      });
      setSegments(matched);
      setStep('timeline');
      saveProject({ segments: matched, currentStep: 'timeline' });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Segment adjustment helpers
  const updateSegmentMotion = (idx: number, motion: MotionEffect) => {
    setSegments((prev) => {
      const updated = prev.map((s, i) => i === idx ? { ...s, motion } : s);
      saveProject({ segments: updated });
      return updated;
    });
  };

  // ── Step 6: Generate Metadata ──
  const handleGenerateMetadata = async () => {
    if (!scriptText.trim()) return;
    setGeneratingMetadata(true);
    setError(null);
    try {
      const meta = await storyboardApi.generateMetadata({
        projectId: projectId || undefined,
        script: scriptText.trim(),
        topic: scriptTopic.trim() || undefined,
        systemPrompt: metadataPrompt.trim() || undefined,
      }) as any;
      setMetadataTitle(meta.title);
      setMetadataDesc(meta.description);
      setMetadataTags(meta.tags);
      if (meta.thumbnailPrompt) setMetadataThumbnailPrompt(meta.thumbnailPrompt);
      saveProject({
        metadataTitle: meta.title,
        metadataDesc: meta.description,
        metadataTags: meta.tags,
        thumbnailPrompt: meta.thumbnailPrompt || '',
        currentStep: 'metadata'
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingMetadata(false);
    }
  };

  const handleGenerateThumbnail = async () => {
    if (!metadataThumbnailPrompt.trim()) return;
    setGeneratingThumbnail(true);
    setThumbnailProgress('Initializing...');
    setError(null);
    try {
      const basePrompt = metadataThumbnailPrompt.trim();
      const bgSuffix = thumbnailBgColor === 'transparent'
        ? '. Transparent/no background, subject isolated on transparent background'
        : thumbnailBgColor
          ? `. Background color: ${thumbnailBgColor}`
          : '';
      const finalPrompt = basePrompt + bgSuffix;
      const result = await imageApi.generate(
        {
          prompt: finalPrompt,
          aspectRatio: '16:9',
          count: 1,
          provider: provider === 'auto' ? undefined : provider,
        },
        (step, detail) => {
          setThumbnailProgress(`${step}: ${detail || ''}`);
        }
      );
      if (result.length > 0) {
        setThumbnailUrl(result[0].url);
        saveProject({ thumbnailUrl: result[0].url, thumbnailPrompt: metadataThumbnailPrompt.trim() });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingThumbnail(false);
      setThumbnailProgress('');
    }
  };

  const handleAutoGenerateThumbnailPrompt = async () => {
    if (!projectId) return;
    setGeneratingThumbnailPrompt(true);
    setError(null);
    try {
      const res = await storyboardApi.generateThumbnailPrompt({
        projectId,
        title: metadataTitle || undefined,
        script: scriptText || undefined,
        topic: scriptTopic || undefined,
      });
      if (res.thumbnailPrompt) {
        setMetadataThumbnailPrompt(res.thumbnailPrompt);
        saveProject({ thumbnailPrompt: res.thumbnailPrompt });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingThumbnailPrompt(false);
    }
  };

  // ── Step 7: Assemble ──
  const handleAssemble = async () => {
    if (!segments.length || !audioFile) return;
    const abort = new AbortController();
    assembleAbortRef.current = abort;
    setAssembling(true);
    setAssembleProgress([]);
    setAssembleStep('');
    setAssembleClipProgress({ current: 0, total: 0 });
    setResult(null);
    setError(null);

    try {
      const res = await storyboardApi.assemble(
        { segments, audioFilename: audioFile.filename, aspectRatio, bgMusicFilename: bgMusicFilename || undefined, voiceVolume, musicVolume, outputName: scriptTopic.trim() || projectName.trim() || undefined, speed, bgColor, subtitleStyle: subtitleStyle.enabled ? subtitleStyle : undefined },
        (step, detail) => {
          if (step) setAssembleStep(step);
          if (detail) {
            setAssembleProgress((p) => [...p, detail]);
            const clipMatch = detail.match(/clip (\d+)\/(\d+)/i);
            if (clipMatch) setAssembleClipProgress({ current: parseInt(clipMatch[1]), total: parseInt(clipMatch[2]) });
          }
        },
        abort.signal,
      );
      setResult(res);
      setStep('assemble');
      saveProject({ resultFilename: res.filename, resultUrl: res.url, resultSizeKB: res.sizeKB, currentStep: 'assemble', status: 'completed' });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
      }
    } finally {
      assembleAbortRef.current = null;
      setAssembling(false);
    }
  };

  // ── Step navigation ──
  const allSteps: Array<{ key: WorkflowStep; label: string; icon: React.ElementType; done: boolean }> = [
    { key: 'topics', label: t('storyboard.stepTopics'), icon: Wand2, done: !!scriptTopic.trim() },
    { key: 'script', label: t('storyboard.stepScript'), icon: FileText, done: !!scriptText.trim() },
    { key: 'audio', label: t('storyboard.stepAudio'), icon: Mic, done: !!audioFile },
    { key: 'prompts', label: t('storyboard.stepPrompts'), icon: Wand2, done: prompts.length > 0 },
    { key: 'images', label: t('storyboard.stepImages'), icon: Image, done: generatedImages.some((i) => i.status === 'done') },
    { key: 'timeline', label: t('storyboard.stepTimeline'), icon: Clock, done: segments.length > 0 },
    { key: 'metadata', label: t('storyboard.stepMetadata'), icon: Tag, done: !!metadataTitle },
    { key: 'assemble', label: t('storyboard.stepAssemble'), icon: Film, done: !!result },
  ];
  const stepOrder: WorkflowStep[] = allSteps.map((s) => s.key);
  const currentIdx = stepOrder.indexOf(step);

  // ── Build context value ──
  const contextValue = {
    t, projectId, step, setStep, error, setError, saveProject,
    projectName, projectLoaded,
    templateText, setTemplateText, templateLoaded, templateSections,
    templateStageParts, setTemplateStageParts,
    showTemplate, setShowTemplate, savingTemplate,
    templateFileRef, handleSaveTemplate, handleTemplateFile,
    topicsPrompt, setTopicsPrompt, scriptPrompt, setScriptPrompt,
    imagePromptPrompt, setImagePromptPrompt, metadataPrompt, setMetadataPrompt,
    savingPrompt, savedPromptStage, handleSaveStagePrompt,
    topicIdeas, generatingTopics, handleGenerateTopics, handlePickTopic,
    scriptText, setScriptText, scriptTopic, setScriptTopic,
    scriptDuration, setScriptDuration, generatingScript, handleGenerateScript,
    voice, setVoice, langFilter, setLangFilter,
    ttsRate, setTtsRate, ttsPitch, setTtsPitch, ttsVolume, setTtsVolume,
    ttsStyle, setTtsStyle,
    voicePreviewLoading, voicePreviewPlaying, generatingAudio,
    audioProgress, audioFile, transcriptEntries, setTranscriptEntries,
    handleSplitEntry,
    handleMergeEntry,
    handleSplitAtCursor,
    handleUpdateEntryText,
    handleAutoSeparate, handleRetranscribe,
    voices, handleVoicePreview, handleGenerateAudio, audioLogRef,
    prompts, setPrompts, generatingPrompts, promptProgress,
    editingPromptIdx, setEditingPromptIdx, handleGeneratePrompts, handleStopPrompts, handleRegenPrompt, regenPromptIdx, regenQueueRef, promptLogRef,
    linkedTemplate: linkedTemplate as { visualStyle?: string } | undefined,
    generatedImages, setGeneratedImages, generatingImages, imageProgress,
    provider, setProvider, imageModel, setImageModel, aspectRatio, setAspectRatio,
    uploadingZip, zipInputRef, imageCardRefs,
    imageTab, setImageTab, flowAvailable, flowProvider, setFlowProvider,
    mediaType, setMediaType, videoDuration, setVideoDuration,
    imageProviders, selectedProviderInfo,
    handleGenerateImages, handleGenerateVideos, handleStopImages, handleUploadZip,
    handleFlowGenerate, handleFlowRegenerateAll, handleFlowResume,
    handleRegenSingle, handleDropImage, handleImportFromUrl, regenIndex,
    failedImageCount,
    editingImageIdx, setEditingImageIdx, editingImagePrompt, setEditingImagePrompt,
    segments, setSegments,
    hoveredSegment, setHoveredSegment,
    playingSegment, setPlayingSegment,
    playheadTime, setPlayheadTime,
    isAudioPaused, segAudioRef, segmentsRef,
    timeFormat, setTimeFormat, frameTransition, setFrameTransition,
    frameHoldTime, setFrameHoldTime,
    segmentRefs, timelineTrackRef,
    trackZoom, setTrackZoom, trackHeight, setTrackHeight,
    trackGrabbing, setTrackGrabbing, trackDragRef, manualScrolling,
    allEffects, randomEffects, setRandomEffects,
    bgMusicFilename, setBgMusicFilename,
    voiceVolume, setVoiceVolume, musicVolume, setMusicVolume,
    dragIdx, dragOverIdx, dragAllowed,
    handleDragStart, handleDragOver, handleDrop,
    setDragIdx, setDragOverIdx,
    updateSegmentTimeAutoMerge, handleTrackEdgeDrag, handleCardResizeStart,
    updateSegmentMotion, playSegmentAudio, pauseAudio, resumeAudio, stopAudio,
    skipSegment, seekToTime, handleBuildTimeline,
    subtitleStyle, setSubtitleStyle,
    generatingMetadata, metadataTitle, setMetadataTitle,
    metadataDesc, setMetadataDesc, metadataTags, setMetadataTags,
    metadataThumbnailPrompt, setMetadataThumbnailPrompt,
    thumbnailUrl, setThumbnailUrl, generatingThumbnail, thumbnailProgress,
    generatingThumbnailPrompt, thumbnailBgColor, setThumbnailBgColor,
    handleGenerateMetadata, handleGenerateThumbnail, handleAutoGenerateThumbnailPrompt,
    assembling, assembleAbortRef, speed, setSpeed, bgColor, setBgColor,
    lightboxUrl, setLightboxUrl,
    assembleProgress, assembleLogRef, assembleStep, assembleClipProgress,
    result, handleAssemble,
  };

  return (
    <StoryboardProvider value={contextValue}>
      <div className="flex flex-col h-full overflow-hidden">
        <TopBar title={projectName || t('storyboard.title')} subtitle={t('storyboard.subtitle')} />

        {/* Project name & niche badge */}
        {projectId && (
          <div className="border-b border-c-border bg-c-surface/50 px-4 py-2">
            <div className="max-w-7xl mx-auto flex items-center gap-2.5">
              <Film className="w-4 h-4 text-cyan-400 shrink-0" />
              <span className="text-sm font-medium text-c-text truncate">{projectName || t('storyboard.untitled')}</span>
              {linkedTemplate && (
                <>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full border shrink-0"
                    style={{
                      borderColor: `${linkedTemplate.color || '#6366f1'}50`,
                      backgroundColor: `${linkedTemplate.color || '#6366f1'}15`,
                      color: linkedTemplate.color || '#6366f1',
                    }}
                  >
                    {linkedTemplate.niche || linkedTemplate.name}
                  </span>
                  {linkedTemplate.visualStyle && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-400 shrink-0">
                      {linkedTemplate.visualStyle}
                    </span>
                  )}
                </>
              )}
              {scriptTopic && (
                <>
                  <span className="text-c-dim text-xs">·</span>
                  <span className="text-xs text-c-muted truncate max-w-md" title={scriptTopic}>{scriptTopic}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step indicator */}
        <nav className="border-b border-c-border bg-c-surface px-4 py-2.5 overflow-x-auto" aria-label="Workflow steps">
          <div className="max-w-7xl mx-auto flex items-center gap-1">
            {allSteps.map((s, i) => {
              const isAccessible = i <= currentIdx || s.done;
              return (
                <div key={s.key} className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => isAccessible ? setStep(s.key) : undefined}
                    aria-current={step === s.key ? 'step' : undefined}
                    disabled={!isAccessible}
                    className={clsx(
                      'flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full transition-colors whitespace-nowrap',
                      step === s.key
                        ? 'bg-cyan-900/40 text-cyan-300 font-medium'
                        : s.done
                          ? 'text-green-400 cursor-pointer hover:bg-green-900/20'
                          : 'text-c-dim cursor-default disabled:opacity-50',
                    )}
                  >
                    {s.done && step !== s.key ? <CheckCircle className="w-3.5 h-3.5" /> : <s.icon className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                  {i < allSteps.length - 1 && <ArrowRight className="w-2.5 h-2.5 text-c-dim shrink-0" />}
                </div>
              );
            })}
          </div>
        </nav>

        <div className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-6 space-y-5">

            {/* TEMPLATE */}
            <div className="border border-c-border rounded-xl bg-c-surface overflow-hidden">
              <button
                onClick={() => setShowTemplate(!showTemplate)}
                className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-c-elevated/50 transition-colors"
                aria-expanded={showTemplate}
              >
                <FileUp className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-medium text-c-text flex-1">
                  {t('storyboard.template')}
                  {templateLoaded && (
                    <span className="ml-2 text-[10px] text-green-400 font-normal">
                      ({Object.keys(templateSections).filter((k) => !k.endsWith('SystemPrompt')).length} {t('storyboard.sectionsLoaded')})
                    </span>
                  )}
                </span>
                {showTemplate ? <ChevronUp className="w-3.5 h-3.5 text-c-dim" /> : <ChevronDown className="w-3.5 h-3.5 text-c-dim" />}
              </button>

              {showTemplate && (
                <div className="px-4 pb-4 space-y-3 border-t border-c-border">
                  <div className="text-[11px] text-c-dim mt-3">{t('storyboard.templateHint')}</div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => templateFileRef.current?.click()}
                      className="btn-secondary text-xs flex items-center gap-1.5"
                    >
                      <Upload className="w-3 h-3" /> {t('storyboard.loadFile')}
                    </button>
                    <input ref={templateFileRef} type="file" accept=".txt,.md,.text" onChange={handleTemplateFile} className="hidden" />
                    <span className="flex-1" />
                    <button
                      onClick={handleSaveTemplate}
                      disabled={!templateText.trim() || savingTemplate}
                      className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {savingTemplate ? <Spinner size="sm" /> : <Save className="w-3 h-3" />}
                      {t('storyboard.saveTemplate')}
                    </button>
                  </div>
                  <textarea
                    value={templateText}
                    onChange={(e) => setTemplateText(e.target.value)}
                    placeholder={t('storyboard.templatePlaceholder')}
                    rows={12}
                    className="input text-[11px] w-full font-mono resize-y min-h-[150px]"
                  />
                  {Object.keys(templateSections).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {Object.keys(templateSections).filter((k) => !k.endsWith('SystemPrompt')).map((key) => (
                        <span key={key} className="text-[9px] bg-cyan-900/30 text-cyan-300/80 px-2 py-0.5 rounded-full">
                          {key}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step content */}
            {step === 'topics' && <TopicsStep />}
            {step === 'script' && <ScriptStep />}
            {step === 'audio' && <AudioStep />}
            {step === 'prompts' && <PromptsStep />}
            {step === 'images' && <ImagesStep />}
            {step === 'timeline' && <TimelineStep />}
            {step === 'metadata' && <MetadataStep />}
            {step === 'assemble' && <AssembleStep />}

            {/* Error */}
            {error && (
              <div className="border border-red-800/30 rounded-xl p-3 bg-red-900/10 text-sm text-red-300 flex items-center gap-2">
                <X className="w-4 h-4 shrink-0" />
                {error}
                <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        </div>

        {/* Lightbox modal */}
        {lightboxUrl && (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center animate-in fade-in duration-200"
            onClick={() => setLightboxUrl(null)}
            onKeyDown={(e) => { if (e.key === 'Escape') setLightboxUrl(null); }}
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
          >
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }}
              className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors"
              aria-label="Close preview"
              autoFocus
            >
              <X className="w-6 h-6" />
            </button>
            {/\.(mp4|webm|mov)(\?|$)/i.test(lightboxUrl) ? (
              <video src={lightboxUrl} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" controls autoPlay onClick={(e) => e.stopPropagation()} />
            ) : (
              <img src={lightboxUrl} alt="Preview" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
            )}
            <div className="absolute bottom-4 flex gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = lightboxUrl; a.download = lightboxUrl.split('/').pop() || (/\.(mp4|webm|mov)/i.test(lightboxUrl) ? 'video.mp4' : 'image.png'); a.click(); }}
                className="px-3 py-2 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> {t('common.download')}
              </button>
            </div>
          </div>
        )}
      </div>
    </StoryboardProvider>
  );
}
