import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2 } from 'lucide-react';
import { QuickMode } from './QuickMode';
import { SetupPanel } from './AdvancedMode/SetupPanel';
import { SegmentList } from './AdvancedMode/SegmentList';
import { AssemblePanel } from './AdvancedMode/AssemblePanel';

export function TransformStudio() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'quick' | 'advanced'>('quick');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Wand2 className="w-6 h-6 text-purple-400" />
          <h1 className="text-2xl font-bold">{t('transformStudio.title')}</h1>
        </div>
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          <button
            onClick={() => setMode('quick')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'quick' ? 'bg-purple-600 text-white' : 'bg-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t('transformStudio.quickMode')}
          </button>
          <button
            onClick={() => setMode('advanced')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'advanced' ? 'bg-purple-600 text-white' : 'bg-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t('transformStudio.advancedMode')}
          </button>
        </div>
      </div>

      {mode === 'quick' && (
        <QuickMode
          onSendToAdvanced={(projectId) => {
            setActiveProjectId(projectId);
            setMode('advanced');
          }}
        />
      )}
      {mode === 'advanced' && (
        <div className="space-y-6">
          <SetupPanel activeProjectId={activeProjectId} onProjectCreated={setActiveProjectId} />
          {activeProjectId && (
            <>
              <SegmentList projectId={activeProjectId} />
              <AssemblePanel projectId={activeProjectId} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
