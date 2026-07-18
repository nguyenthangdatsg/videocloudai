import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { ScriptEditor } from './pages/ScriptEditor';
import { SceneLibrary } from './pages/SceneLibrary';
import { VideoEditor } from './pages/VideoEditor';
import { BatchGenerator } from './pages/BatchGenerator';
import { QueueManager } from './pages/QueueManager';
import { Channels } from './pages/Channels';
import { Distributions } from './pages/Distributions';
import { Settings } from './pages/Settings';
import { TextToSpeech } from './pages/TextToSpeech';
import { Transcribe } from './pages/Transcribe';
import { Storyboard } from './pages/storyboard';
import { StoryboardList } from './pages/StoryboardList';
import { DramaList } from './pages/DramaList';
import { DramaProjectPage } from './pages/DramaProject';
import { MediaLibrary } from './pages/MediaLibrary';
import { FrameVideoLibrary } from './pages/FrameVideoLibrary';
import { useSSE } from './hooks/useSSE';
import { ToastContainer } from './components/ui/ToastContainer';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

function AppShell() {
  useSSE();

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/script" element={<ScriptEditor />} />
            <Route path="/library" element={<SceneLibrary />} />
            <Route path="/media-library" element={<MediaLibrary />} />
            <Route path="/frame-video-library" element={<FrameVideoLibrary />} />
            <Route path="/editor" element={<VideoEditor />} />
            <Route path="/batch" element={<BatchGenerator />} />
            <Route path="/queue" element={<QueueManager />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/distributions" element={<Distributions />} />
            <Route path="/tts" element={<TextToSpeech />} />
            <Route path="/transcribe" element={<Transcribe />} />
            <Route path="/storyboard" element={<StoryboardList />} />
            <Route path="/storyboard/:id" element={<ErrorBoundary><Storyboard /></ErrorBoundary>} />
            <Route path="/drama" element={<DramaList />} />
            <Route path="/drama/:id" element={<DramaProjectPage />} />
            <Route path="/image-drama" element={<DramaList />} />
            <Route path="/image-drama/:id" element={<DramaProjectPage />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
      <ToastContainer />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
