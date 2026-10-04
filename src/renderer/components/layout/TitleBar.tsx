import React, { useState, useEffect } from 'react';
import { Minus, Square, X, Maximize2 } from 'lucide-react';
import { api } from '../../lib/api';
import appIcon from '../../../../resources/icon/icon.svg';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    api.windowIsMaximized().then(setIsMaximized).catch(() => {});
  }, []);

  const handleMinimize = () => api.windowMinimize().catch(() => {});
  const handleMaximize = () => {
    api.windowMaximize().then(() => {
      api.windowIsMaximized().then(setIsMaximized).catch(() => {});
    }).catch(() => {});
  };
  const handleClose = () => api.windowClose().catch(() => {});

  return (
    <div
      className="flex items-center justify-between h-9 bg-navy-950 border-b border-navy-800 flex-shrink-0 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App identity */}
      <div className="flex items-center gap-2 px-4">
        <img src={appIcon} alt="" className="w-4 h-4" draggable={false} />
        <span className="text-xs font-semibold text-slate-300 tracking-wide">Replay English</span>
      </div>

      {/* Window controls */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="flex items-center justify-center w-11 h-full text-slate-400 hover:text-white hover:bg-navy-700 transition-colors"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className="flex items-center justify-center w-11 h-full text-slate-400 hover:text-white hover:bg-navy-700 transition-colors"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Square size={12} /> : <Maximize2 size={12} />}
        </button>
        <button
          onClick={handleClose}
          className="flex items-center justify-center w-11 h-full text-slate-400 hover:text-white hover:bg-red-600 transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
