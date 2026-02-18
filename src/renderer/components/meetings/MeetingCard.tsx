import React from 'react';
import { Trash2, Clock, AlertTriangle } from 'lucide-react';
import type { Meeting } from '../../../shared/types';

const statusColors: Record<string, string> = {
  recording: 'bg-red-500/20 text-red-400',
  transcribing: 'bg-yellow-500/20 text-yellow-400',
  analyzing: 'bg-blue-500/20 text-blue-400',
  transcribed: 'bg-orange-500/20 text-orange-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

interface MeetingCardProps {
  meeting: Meeting;
  profileColor?: string | null;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onClick: (id: string) => void;
}

export function MeetingCard({ meeting, profileColor, onDelete, onClick }: MeetingCardProps) {
  return (
    <div
      onClick={() => onClick(meeting.id)}
      className="bg-slate-800 hover:bg-slate-750 rounded-lg p-4 cursor-pointer transition-colors border border-slate-700 hover:border-slate-600"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            {profileColor && (
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: profileColor }}
              />
            )}
            <h3 className="text-white font-medium truncate">{meeting.title}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusColors[meeting.status] || ''}`}>
              {meeting.status}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-sm text-slate-400">
            <span>{formatDate(meeting.startedAt)}</span>
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {formatDuration(meeting.durationSeconds)}
            </span>
            {meeting.status === 'completed' && (
              <>
                <span className="flex items-center gap-1">
                  <AlertTriangle size={14} />
                  {meeting.totalMistakes} mistake{meeting.totalMistakes !== 1 ? 's' : ''}
                </span>
                {meeting.overallScore !== null && (
                  <span>Score: {Math.round(meeting.overallScore)}/100</span>
                )}
              </>
            )}
          </div>
        </div>
        <button
          onClick={(e) => onDelete(e, meeting.id)}
          className="p-2 text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
