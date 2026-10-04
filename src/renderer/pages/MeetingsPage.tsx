import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Search, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { MeetingCard } from '../components/meetings/MeetingCard';
import type { Meeting, Profile, RecordingMode } from '../../shared/types';

type StatusFilter = 'all' | 'completed' | 'failed' | 'in-progress';
type TimeRangeFilter = 'all' | 'today' | 'week' | 'month';

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'in-progress', label: 'In Progress' },
];

const timeRangeOptions: { value: TimeRangeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
];

const IN_PROGRESS_STATUSES = ['recording', 'transcribing', 'analyzing', 'transcribed'];

export function MeetingsPage() {
  const navigate = useNavigate();

  // Data
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeRange, setTimeRange] = useState<TimeRangeFilter>('all');
  const [profileId, setProfileId] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | RecordingMode>('all');

  // Grouping
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  const loadMeetings = async (pid?: string) => {
    try {
      const filters = pid ? { profileId: pid } : undefined;
      const data = await api.listMeetings(filters);
      setMeetings(data);
    } catch (err) {
      console.error('Failed to load meetings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.listProfiles().then(setProfiles).catch(console.error);
    loadMeetings();
  }, []);

  useEffect(() => {
    setLoading(true);
    loadMeetings(profileId || undefined);
  }, [profileId]);

  const profileMap = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const p of profiles) map.set(p.id, p);
    return map;
  }, [profiles]);

  const filteredMeetings = useMemo(() => {
    let result = meetings;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m => m.title.toLowerCase().includes(q));
    }

    if (statusFilter === 'completed') {
      result = result.filter(m => m.status === 'completed');
    } else if (statusFilter === 'failed') {
      result = result.filter(m => m.status === 'failed');
    } else if (statusFilter === 'in-progress') {
      result = result.filter(m => IN_PROGRESS_STATUSES.includes(m.status));
    }

    if (modeFilter !== 'all') {
      result = result.filter(m => m.recordingMode === modeFilter);
    }

    if (timeRange !== 'all') {
      const now = Date.now();
      const cutoffs: Record<string, number> = {
        today: now - 24 * 60 * 60 * 1000,
        week: now - 7 * 24 * 60 * 60 * 1000,
        month: now - 30 * 24 * 60 * 60 * 1000,
      };
      result = result.filter(m => m.startedAt >= cutoffs[timeRange]);
    }

    return result;
  }, [meetings, searchQuery, statusFilter, modeFilter, timeRange]);

  const groupedByMonth = useMemo(() => {
    if (timeRange !== 'all') return null;

    const groups = new Map<string, Meeting[]>();
    for (const m of filteredMeetings) {
      const key = new Date(m.startedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const existing = groups.get(key);
      if (existing) {
        existing.push(m);
      } else {
        groups.set(key, [m]);
      }
    }
    return groups;
  }, [filteredMeetings, timeRange]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this meeting and all its analysis data?')) {
      await api.deleteMeeting(id);
      loadMeetings(profileId || undefined);
    }
  };

  const toggleMonth = (month: string) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setTimeRange('all');
    setProfileId('');
  };

  if (loading && meetings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-400">Loading meetings...</p>
      </div>
    );
  }

  const renderMeetingCard = (meeting: Meeting) => {
    const profile = meeting.profileId ? profileMap.get(meeting.profileId) : undefined;
    return (
      <MeetingCard
        key={meeting.id}
        meeting={meeting}
        profileColor={profile?.color}
        onDelete={handleDelete}
        onClick={(id) => navigate(`/meetings/${id}`)}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Meetings</h2>
        <p className="text-slate-400 text-sm">
          {filteredMeetings.length === meetings.length
            ? `${meetings.length} meeting${meetings.length !== 1 ? 's' : ''}`
            : `${filteredMeetings.length} of ${meetings.length} meetings`}
        </p>
      </div>

      {/* Filters */}
      {meetings.length > 0 && (
        <div className="space-y-3">
          {/* Search + Profile */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search meetings..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>
            <select
              value={modeFilter}
              onChange={e => setModeFilter(e.target.value as 'all' | RecordingMode)}
              className="px-3 py-1.5 bg-navy-800 border border-navy-700 rounded-lg text-white text-sm"
            >
              <option value="all">All modes</option>
              <option value="solo">Solo practice</option>
              <option value="meeting">Meetings</option>
            </select>
            {profiles.length > 0 && (
              <select
                value={profileId}
                onChange={e => setProfileId(e.target.value)}
                className="px-3 py-1.5 bg-navy-800 border border-navy-700 rounded-lg text-white text-sm"
              >
                <option value="">All profiles</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Status + Time Range pills */}
          <div className="flex items-center gap-3">
            <div className="flex bg-navy-800 rounded-lg p-0.5">
              {statusOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={`px-3 py-1 rounded text-sm transition-colors ${
                    statusFilter === opt.value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex bg-navy-800 rounded-lg p-0.5">
              {timeRangeOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTimeRange(opt.value)}
                  className={`px-3 py-1 rounded text-sm transition-colors ${
                    timeRange === opt.value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-navy-800 flex items-center justify-center mb-4">
            <List size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-400">No meetings recorded yet</p>
          <p className="text-slate-500 text-sm mt-1">
            Start a recording to see your meetings here
          </p>
        </div>
      ) : filteredMeetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-400">No meetings match your filters</p>
          <button
            onClick={clearFilters}
            className="text-blue-400 hover:text-blue-300 text-sm mt-2"
          >
            Clear filters
          </button>
        </div>
      ) : groupedByMonth ? (
        <div className="space-y-4">
          {Array.from(groupedByMonth.entries()).map(([monthLabel, groupMeetings]) => {
            const isCollapsed = collapsedMonths.has(monthLabel);
            return (
              <div key={monthLabel}>
                <button
                  onClick={() => toggleMonth(monthLabel)}
                  className="flex items-center gap-2 w-full py-2 text-left text-slate-400 hover:text-white text-sm font-medium transition-colors"
                >
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                  {monthLabel}
                  <span className="text-slate-600 text-xs">({groupMeetings.length})</span>
                </button>
                {!isCollapsed && (
                  <div className="space-y-2">
                    {groupMeetings.map(renderMeetingCard)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredMeetings.map(renderMeetingCard)}
        </div>
      )}
    </div>
  );
}
