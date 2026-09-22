import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Download, Copy, Check, BookOpen, AlertTriangle, CheckCircle, BarChart2, Sparkles, Music2, Shield } from 'lucide-react';
import { useAppStore } from '../../store';

const TEMPLATE_MD = `# VIDEO #1 — Your Video Title Here

# Written 2026-01 | 25 scenes | full_ai | 5:00 target
# This line is a comment — ignored by the parser

[CHARACTER: narrator | wise elderly professor, silver beard, tweed jacket, warm expression]
[CHARACTER: hero | young woman with short black hair, determined eyes, leather jacket]
[VOICE_GROUP: main | engine:edge-tts | voice:en-US-GuyNeural | rate:-5%]
[VOICE_GROUP: dramatic | engine:edge-tts | voice:en-US-ChristopherNeural | rate:-10%]
[VOICE: en-US-GuyNeural | rate:-5%]

## SEGMENT 1 — COLD OPEN (0:00–0:25)

### SCENE 1
[PEXELS: dark ocean waves crashing against rocks at night]
[PACE: slow]
Your hook narration paragraph goes here. This is the first thing viewers hear — make it count. Ask a question or state a surprising fact.

### SCENE 2
[FLOW: cinematic wide shot of @narrator standing at the edge of a cliff overlooking a vast ancient city at sunset, dramatic lighting, 8K]
[TEXT ON SCREEN: "Key statistic or quote"]
Second narration paragraph with supporting detail.

## SEGMENT 2 — MAIN TOPIC (0:25–1:30)

### SCENE 1
[PEXELS: concrete subject related to topic]
[VOICE: group:dramatic | emotion:serious]
According to the World Bank, global GDP reached [STAT: global GDP | $105 trillion | currency] in 2024 — a record high.

### SCENE 2
[CHART: bars | USA:28.8, China:18.5, Japan:4.2, Germany:4.5, India:3.9 | "GDP by country ($ trillions, 2024)" | World Bank]
The United States still leads the world economy, but the gap is narrowing.

### SCENE 3
[PEXELS: city traffic aerial view highway cars]
[SCREEN_EFFECT: confetti]
[SFX: celebration cheer]
The numbers paint a clear picture of where the world is headed.

### SCENE 4
[FLOW: auto]
[PACE: fast]
Main body narration paragraph — when set to auto, the system builds an AI image prompt from this narration text automatically.

## SEGMENT 3 — CONCLUSION (1:30–2:00)

### SCENE 1
[PEXELS: closing visual matching the mood]
[VOICE: pause-before:600ms | rate:-15% | pause-after:300ms]
Wrap-up narration paragraph. End with a call to action or thought-provoking statement.

---

# PRODUCTION NOTES

## Stats used & sources
- World Bank GDP data 2024: https://data.worldbank.org/indicator/NY.GDP.MKTP.CD
- UN Population estimates: https://population.un.org/wpp/

## Chapter markers
0:00 Cold Open
0:25 Main Topic
1:30 Conclusion

## Thumbnail concept
Description of the thumbnail layout, text, and visual elements.
`;

export function FormatGuide({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { pushNotification } = useAppStore();
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  const copyTemplate = async () => {
    await navigator.clipboard.writeText(TEMPLATE_MD);
    setCopiedTemplate(true);
    pushNotification({ id: `copy-tmpl-${Date.now()}`, type: 'success', title: t('scriptStudio.guide.templateCopied') });
    setTimeout(() => setCopiedTemplate(false), 2000);
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_MD], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in" onClick={onClose}>
      <div
        className="card w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-c-border shrink-0">
          <h2 className="text-lg font-bold text-c-text flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-c-accent" />
            {t('scriptStudio.guide.title')}
          </h2>
          <button onClick={onClose} className="text-c-dim hover:text-c-text p-1.5 rounded-lg hover:bg-c-elevated transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Section 1: Anatomy */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-3">
              {t('scriptStudio.guide.anatomyTitle')}
            </h3>
            <div className="font-mono text-sm bg-c-elevated rounded-lg p-4 space-y-1 overflow-x-auto leading-relaxed">
              <p><span className="text-purple-400"># VIDEO #1 — Title</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoTitle')}</span></p>
              <p><span className="text-c-dim"># comment line (ignored)</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoComment')}</span></p>
              <p><span className="text-pink-400">[CHARACTER: id | description]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoChar')}</span></p>
              <p><span className="text-teal-400">[VOICE_GROUP: id | engine:X | voice:Y]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoVoiceGroup')}</span></p>
              <p><span className="text-cyan-400">[VOICE: voice-name | rate:X%]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoVoiceDoc')}</span></p>
              <p className="mt-2"><span className="text-blue-400">## SEGMENT 1 — COLD OPEN (0:00–0:25)</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoSegment')}</span></p>
              <p><span className="text-orange-400">### SCENE 1</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoScene')}</span></p>
              <p><span className="text-green-400">[PEXELS: elderly japanese man shop tokyo]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoPexels')}</span></p>
              <p><span className="text-rose-400">[FLOW: cinematic prompt or auto]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoFlow')}</span></p>
              <p><span className="text-purple-400">[CHART: type | data | &quot;title&quot; | source]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoChart')}</span></p>
              <p><span className="text-c-text">Narration paragraph text...</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoNarration')}</span></p>
              <p><span className="text-amber-400">[TEXT ON SCREEN: &quot;overlay text&quot;]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoOverlay')}</span></p>
              <p><span className="text-cyan-400">[PACE: slow]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoPace')}</span></p>
              <p><span className="text-cyan-400">[VOICE: group:X | emotion:Y]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoVoiceBlock')}</span></p>
              <p><span className="text-amber-400/70">[STAT: label | fallback | type]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoStat')}</span></p>
              <p><span className="text-amber-400">[SCREEN_EFFECT: effect-name]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoScreenEffect')}</span></p>
              <p><span className="text-green-400/70">[SFX: sound description]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoSfx')}</span></p>
              <p className="mt-2"><span className="text-c-dim">---</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoRule')}</span></p>
              <p className="mt-2"><span className="text-red-400"># PRODUCTION NOTES</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.annoNotes')}</span></p>
              <p><span className="text-red-300/70">## Stats used & sources</span></p>
              <p><span className="text-red-300/70">## Chapter markers</span></p>
              <p><span className="text-red-300/70">## Thumbnail concept</span></p>
            </div>
          </section>

          {/* Section 2: Rules */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-3">
              {t('scriptStudio.guide.rulesTitle')}
            </h3>
            <ul className="space-y-2.5 text-sm text-c-text">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <li key={n} className="flex items-start gap-2.5">
                  <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                  <span className="leading-relaxed">{t(`scriptStudio.guide.rule${n}`)}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Section 3: Common mistakes */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-3">
              {t('scriptStudio.guide.mistakesTitle')}
            </h3>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-c-border">
                    <th className="text-left p-3 text-red-400 font-medium">
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t('scriptStudio.guide.wrong')}
                      </span>
                    </th>
                    <th className="text-left p-3 text-green-400 font-medium">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5" />
                        {t('scriptStudio.guide.right')}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4].map((n) => (
                    <tr key={n} className="border-b border-c-border">
                      <td className="p-3 text-c-text font-mono text-xs whitespace-pre-line leading-relaxed">{t(`scriptStudio.guide.mistake${n}Wrong`)}</td>
                      <td className="p-3 text-c-text font-mono text-xs whitespace-pre-line leading-relaxed">{t(`scriptStudio.guide.mistake${n}Right`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 4: Pace Override */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-1">
              {t('scriptStudio.guide.paceTitle')}
            </h3>
            <p className="text-sm text-c-muted mb-3">{t('scriptStudio.guide.paceHint')}</p>
            <div className="font-mono text-sm bg-c-elevated rounded-lg p-4 space-y-1 overflow-x-auto leading-relaxed">
              <p><span className="text-cyan-400">[PACE: slow]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.paceSlowHint')}</span></p>
              <p><span className="text-cyan-400">[PACE: fast]</span> <span className="text-c-dim text-xs ml-2">← {t('scriptStudio.guide.paceFastHint')}</span></p>
            </div>
          </section>

          {/* Section 5: Animated Charts */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-1 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-purple-400" />
              {t('scriptStudio.guide.chartsTitle5')}
            </h3>
            <p className="text-sm text-c-muted mb-3">{t('scriptStudio.guide.chartsHint')}</p>

            {/* Syntax block */}
            <div className="font-mono text-sm bg-c-elevated rounded-lg p-4 space-y-1 overflow-x-auto leading-relaxed mb-3">
              <p className="text-purple-400">[CHART: type | data | &quot;title&quot; | source]</p>
              <p className="text-c-dim text-xs mt-1">{t('scriptStudio.guide.chartTypes')}</p>
              <p className="text-amber-400/80 text-xs mt-2">{t('scriptStudio.guide.chartStatTag')}</p>
            </div>

            {/* Examples */}
            <div className="space-y-3">
              {(['chartEx1', 'chartEx2', 'chartEx3', 'chartEx4'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <p className="text-xs font-medium text-purple-400">
                    {t(`scriptStudio.guide.${key}Label`)}
                  </p>
                  <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                    {t(`scriptStudio.guide.${key}`)}
                  </pre>
                </div>
              ))}
            </div>
          </section>

          {/* Section 6: Scene Markers */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-1">
              {t('scriptStudio.guide.sceneTitle')}
            </h3>
            <p className="text-sm text-c-muted mb-3">{t('scriptStudio.guide.sceneHint')}</p>
            <div className="font-mono text-sm bg-c-elevated rounded-lg p-4 space-y-1 overflow-x-auto leading-relaxed">
              <p><span className="text-orange-400">### SCENE 1</span></p>
              <p><span className="text-green-400">[PEXELS: query for this scene]</span></p>
              <p><span className="text-c-text">Narration for scene one...</span></p>
              <p className="mt-1"><span className="text-orange-400">### SCENE 2</span></p>
              <p><span className="text-green-400">[PEXELS: different query]</span></p>
              <p><span className="text-c-text">Narration for scene two...</span></p>
            </div>
          </section>

          {/* Section 7: AI Image Generation (FLOW) */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-rose-400" />
              {t('scriptStudio.guide.flowTitle')}
            </h3>
            <p className="text-sm text-c-muted mb-3">{t('scriptStudio.guide.flowHint')}</p>

            <div className="font-mono text-sm bg-c-elevated rounded-lg p-4 space-y-2 overflow-x-auto leading-relaxed mb-3">
              <p className="text-rose-400">{t('scriptStudio.guide.flowSyntax')}</p>
            </div>

            <div className="space-y-3">
              {(['flowEx1', 'flowEx2', 'flowEx3'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <p className="text-xs font-medium text-rose-400">
                    {t(`scriptStudio.guide.${key}Label`)}
                  </p>
                  <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                    {t(`scriptStudio.guide.${key}`)}
                  </pre>
                </div>
              ))}
            </div>

            <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <p className="text-xs text-rose-300">{t('scriptStudio.guide.flowNote')}</p>
            </div>
          </section>

          {/* Section 8: Screen Effects */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              {t('scriptStudio.guide.screenEffectTitle')}
            </h3>
            <p className="text-sm text-c-muted mb-3">{t('scriptStudio.guide.screenEffectHint')}</p>

            <div className="font-mono text-sm bg-c-elevated rounded-lg p-4 space-y-1 overflow-x-auto leading-relaxed mb-3">
              <p className="text-amber-400">[SCREEN_EFFECT: effect-name]</p>
              <p className="text-c-dim text-xs mt-1">{t('scriptStudio.guide.screenEffectTypes')}</p>
            </div>

            <div className="space-y-3">
              {(['screenEffectEx1', 'screenEffectEx2', 'screenEffectEx3'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <p className="text-xs font-medium text-amber-400">
                    {t(`scriptStudio.guide.${key}Label`)}
                  </p>
                  <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                    {t(`scriptStudio.guide.${key}`)}
                  </pre>
                </div>
              ))}
            </div>

            <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-300">{t('scriptStudio.guide.screenEffectNote')}</p>
            </div>
          </section>

          {/* Section 9: Sound Effects */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-1 flex items-center gap-2">
              <Music2 className="w-4 h-4 text-green-400" />
              {t('scriptStudio.guide.sfxTitle')}
            </h3>
            <p className="text-sm text-c-muted mb-3">{t('scriptStudio.guide.sfxHint')}</p>

            <div className="font-mono text-sm bg-c-elevated rounded-lg p-4 space-y-1 overflow-x-auto leading-relaxed mb-3">
              <p className="text-green-400">[SFX: sound description]</p>
            </div>

            <div className="space-y-3">
              {(['sfxEx1', 'sfxEx2'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <p className="text-xs font-medium text-green-400">
                    {t(`scriptStudio.guide.${key}Label`)}
                  </p>
                  <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                    {t(`scriptStudio.guide.${key}`)}
                  </pre>
                </div>
              ))}
            </div>
          </section>

          {/* Section 10: Real Statistics & Trusted Sources */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-1 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              {t('scriptStudio.guide.statsTitle')}
            </h3>
            <p className="text-sm text-c-muted mb-3">{t('scriptStudio.guide.statsHint')}</p>

            <div className="space-y-2 mb-3">
              <p className="text-xs font-medium text-blue-400">{t('scriptStudio.guide.statsTrustedLabel')}</p>
              <div className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {t('scriptStudio.guide.statsTrustedList')}
              </div>
            </div>

            <div className="space-y-3">
              {(['statsEx1', 'statsEx2'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <p className="text-xs font-medium text-blue-400">
                    {t(`scriptStudio.guide.${key}Label`)}
                  </p>
                  <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                    {t(`scriptStudio.guide.${key}`)}
                  </pre>
                </div>
              ))}
            </div>

            <div className="mt-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <p className="text-xs text-blue-300">{t('scriptStudio.guide.statsNote')}</p>
            </div>
          </section>

          {/* Section 11: Advanced Tags */}
          <section>
            <h3 className="text-base font-semibold text-c-text mb-3">
              {t('scriptStudio.guide.advancedTitle11')}
            </h3>

            {/* Characters */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-purple-400 mb-1">{t('scriptStudio.guide.charTitle')}</p>
              <p className="text-sm text-c-muted mb-2">{t('scriptStudio.guide.charHint')}</p>
              <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {t('scriptStudio.guide.charEx')}
              </pre>
            </div>

            {/* Voice Groups */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-teal-400 mb-1">{t('scriptStudio.guide.voiceGroupTitle')}</p>
              <p className="text-sm text-c-muted mb-2">{t('scriptStudio.guide.voiceGroupHint')}</p>
              <p className="text-xs text-c-dim mb-1">{t('scriptStudio.guide.voiceTitle')} — Definition:</p>
              <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto mb-2">
                {t('scriptStudio.guide.voiceGroupDefEx')}
              </pre>
              <p className="text-xs text-c-dim mb-1">{t('scriptStudio.guide.voiceTitle')} — Usage:</p>
              <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {t('scriptStudio.guide.voiceGroupUseEx')}
              </pre>
            </div>

            {/* Voice */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-cyan-400 mb-1">{t('scriptStudio.guide.voiceTitle')}</p>
              <p className="text-sm text-c-muted mb-2">{t('scriptStudio.guide.voiceHint')}</p>
              <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto mb-2">
                {t('scriptStudio.guide.voiceDocEx')}
              </pre>
              <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {t('scriptStudio.guide.voiceBlockEx')}
              </pre>
            </div>

            {/* STAT */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-amber-400 mb-1">{t('scriptStudio.guide.statTitle')}</p>
              <p className="text-sm text-c-muted mb-2">{t('scriptStudio.guide.statHint')}</p>
              <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {t('scriptStudio.guide.statEx')}
              </pre>
            </div>

            {/* Comment lines */}
            <div>
              <p className="text-xs font-semibold text-c-dim mb-1">{t('scriptStudio.guide.commentTitle')}</p>
              <p className="text-sm text-c-muted mb-2">{t('scriptStudio.guide.commentHint')}</p>
              <pre className="font-mono text-xs bg-c-elevated rounded-lg p-3 text-c-text whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {t('scriptStudio.guide.commentEx')}
              </pre>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 p-4 border-t border-c-border shrink-0">
          <button className="btn-primary flex items-center gap-2 text-sm cursor-pointer" onClick={downloadTemplate}>
            <Download className="w-4 h-4" />
            {t('scriptStudio.guide.downloadTemplate')}
          </button>
          <button className="btn-secondary flex items-center gap-2 text-sm cursor-pointer" onClick={copyTemplate}>
            {copiedTemplate ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedTemplate ? t('scriptStudio.copied') : t('scriptStudio.guide.copyExample')}
          </button>
        </div>
      </div>
    </div>
  );
}
