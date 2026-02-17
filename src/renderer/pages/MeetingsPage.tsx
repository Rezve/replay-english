import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Trash2, Clock, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import type { Meeting } from '../../shared/types';

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

const statusColors: Record<string, string> = {
  recording: 'bg-red-500/20 text-red-400',
  transcribing: 'bg-yellow-500/20 text-yellow-400',
  analyzing: 'bg-blue-500/20 text-blue-400',
  transcribed: 'bg-orange-500/20 text-orange-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
};

export function MeetingsPage() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMeetings = async () => {
    try {
      const data = await api.listMeetings();
      setMeetings(data);
    } catch (err) {
      console.error('Failed to load meetings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeetings();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this meeting and all its analysis data?')) {
      await api.deleteMeeting(id);
      loadMeetings();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-400">Loading meetings...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Meetings</h2>
        <p className="text-slate-400 text-sm">{meetings.length} meeting{meetings.length !== 1 ? 's' : ''}</p>
      </div>

      {meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
            <List size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-400">No meetings recorded yet</p>
          <p className="text-slate-500 text-sm mt-1">
            Start a recording to see your meetings here
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map((meeting) => (
            <div
              key={meeting.id}
              onClick={() => navigate(`/meetings/${meeting.id}`)}
              className="bg-slate-800 hover:bg-slate-750 rounded-lg p-4 cursor-pointer transition-colors border border-slate-700 hover:border-slate-600"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-medium">{meeting.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[meeting.status] || ''}`}>
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
                  onClick={(e) => handleDelete(e, meeting.id)}
                  className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
