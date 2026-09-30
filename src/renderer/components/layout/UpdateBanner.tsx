import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { UpdateStatus } from '../../../shared/types';

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api.getUpdateStatus().then(setStatus).catch(() => {});
    return api.onUpdateStatus((s) => {
      setStatus(s);
      if (s.state === 'downloaded') setDismissed(false);
    });
  }, []);

  if (dismissed || (status.state !== 'downloading' && status.state !== 'downloaded')) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-blue-600/20 border-b border-blue-500/40 text-sm text-slate-200 flex-shrink-0">
      {status.state === 'downloading' ? (
        <>
          <Download size={14} className="text-blue-400" />
          <span>A new version is available and is downloading in the background...</span>
        </>
      ) : (
        <>
          <RefreshCw size={14} className="text-blue-400" />
          <span>Version {status.version} is ready to install.</span>
          <button
            onClick={() => api.installUpdate().catch(() => {})}
            className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
          >
            Restart &amp; update
          </button>
        </>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="ml-auto text-slate-400 hover:text-white"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
