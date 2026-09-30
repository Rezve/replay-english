import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { api } from '../../lib/api';
import { SystemCheckModal } from '../SystemCheckModal';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { UpdateBanner } from './UpdateBanner';

export function MainLayout() {
  const [startupModels, setStartupModels] = useState<{ whisperModel: string; ollamaModel: string } | null>(null);

  useEffect(() => {
    api.getSettings().then(s => {
      if (!s.skipStartupCheck) {
        setStartupModels({ whisperModel: s.whisperModel, ollamaModel: s.ollamaModel });
      }
    }).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-screen">
      {startupModels && (
        <SystemCheckModal
          whisperModel={startupModels.whisperModel}
          ollamaModel={startupModels.ollamaModel}
          showSkipOption
          onModelsChanged={setStartupModels}
          onClose={() => setStartupModels(null)}
        />
      )}
      <TitleBar />
      <UpdateBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-navy-900 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
