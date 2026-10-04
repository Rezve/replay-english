import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { BarChart3, TrendingDown, TrendingUp, Target } from 'lucide-react';
import { api } from '../lib/api';
import type { AnalyticsData, TimeRange, Profile } from '../../shared/types';

const timeRanges: { value: TimeRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [profileId, setProfileId] = useState<string>('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listProfiles().then(setProfiles).catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    api.getAnalytics(timeRange, profileId || undefined)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [timeRange, profileId]);

  // Axis labels are formatted here; the service returns sortable YYYY-MM-DD.
  const dailyPoints = useMemo(
    () =>
      (data?.dailyTrend ?? []).map(point => ({
        ...point,
        label: new Date(`${point.date}T00:00:00`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
      })),
    [data?.dailyTrend]
  );

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-400">Loading analytics...</p>
      </div>
    );
  }

  if (!data || data.totalMeetings === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-white mb-6">Dashboard</h2>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-navy-800 flex items-center justify-center mb-4">
            <BarChart3 size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-400">No analytics data yet</p>
          <p className="text-slate-500 text-sm mt-1">
            Record and analyze a few meetings to see trends
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <div className="flex items-center gap-3">
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
          <div className="flex bg-navy-800 rounded-lg p-0.5">
            {timeRanges.map(tr => (
              <button
                key={tr.value}
                onClick={() => setTimeRange(tr.value)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  timeRange === tr.value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {tr.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-navy-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs mb-1">Total Meetings</p>
          <p className="text-2xl font-bold text-white">{data.totalMeetings}</p>
        </div>
        <div className="bg-navy-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs mb-1">Avg Mistakes/Meeting</p>
          <p className="text-2xl font-bold text-orange-400">{data.averageMistakes}</p>
        </div>
        <div className="bg-navy-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs mb-1">Sentences Correct</p>
          <p className="text-2xl font-bold text-green-400">
            {data.averageCleanRate === null ? '--' : `${Math.round(data.averageCleanRate)}%`}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">
            {data.sentencesClean} of {data.sentencesChecked} checked
          </p>
        </div>
        <div className="bg-navy-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs mb-1">Most Common Issue</p>
          <p className="text-lg font-medium text-white truncate">{data.mostProblematicCategory || '--'}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        {/* Mistakes trend */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4 flex items-center gap-2">
            <TrendingDown size={16} className="text-blue-400" />
            Mistakes Over Time
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dailyPoints}>
              <CartesianGrid strokeDasharray="3 3" stroke="#162846" />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f1e36', border: '1px solid #162846', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Line type="monotone" dataKey="count" stroke="#f97316" strokeWidth={2} dot={{ fill: '#f97316', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Score trend */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-green-400" />
            Sentences Correct Over Time
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dailyPoints}>
              <CartesianGrid strokeDasharray="3 3" stroke="#162846" />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f1e36', border: '1px solid #162846', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Line type="monotone" dataKey="cleanRate" stroke="#22c55e" strokeWidth={2} dot={{ fill: '#22c55e', r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Category breakdown */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4 flex items-center gap-2">
            <Target size={16} className="text-purple-400" />
            Error Categories
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.mistakesByCategory.slice(0, 8)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#162846" />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis type="category" dataKey="category" width={120} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f1e36', border: '1px solid #162846', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top patterns */}
        <div className="bg-navy-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-medium">What to work on</h3>
            {data.topPatterns.length > 0 && (
              <button
                onClick={() => navigate('/review')}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Open review queue
              </button>
            )}
          </div>
          {data.topPatterns.length === 0 ? (
            <p className="text-slate-500 text-sm">No recurring patterns found yet</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {data.topPatterns.map(p => (
                <button
                  key={p.id}
                  onClick={() => navigate('/review')}
                  className="w-full text-left text-sm hover:bg-navy-700 rounded px-2 py-1.5 -mx-2 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white truncate flex-1">{p.label}</span>
                    <span className="text-slate-500 text-xs flex-shrink-0">
                      {p.occurrenceCount}x in {p.meetingCount}
                    </span>
                  </div>
                  <span className="text-slate-400 text-xs">{p.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
