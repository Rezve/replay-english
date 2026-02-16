import React, { useEffect, useState } from 'react';
import { Users, Trash2, Plus } from 'lucide-react';
import { api } from '../lib/api';
import type { Profile } from '../../shared/types';

const PROFILE_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f97316',
  '#22c55e', '#06b6d4', '#eab308', '#ef4444',
];

export function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PROFILE_COLORS[0]);

  const loadProfiles = async () => {
    try {
      const data = await api.listProfiles();
      setProfiles(data);
    } catch (err) {
      console.error('Failed to load profiles:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await api.createProfile(newName.trim(), selectedColor);
    setNewName('');
    setShowCreate(false);
    loadProfiles();
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this profile? Meetings will keep their data but lose the profile tag.')) {
      await api.deleteProfile(id);
      loadProfiles();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-400">Loading profiles...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Profiles</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          Create Profile
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Profile name (e.g., Acme Corp Weekly)"
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <div className="flex gap-1">
              {PROFILE_COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${
                    selectedColor === color ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(''); }}
              className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
            <Users size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-400">No profiles created yet</p>
          <p className="text-slate-500 text-sm mt-1">
            Create profiles to organize meetings by client or project
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {profiles.map(profile => (
            <div
              key={profile.id}
              className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: profile.color || '#6b7280' }}
                />
                <div>
                  <p className="text-white font-medium">{profile.name}</p>
                  <p className="text-slate-500 text-xs">
                    Created {new Date(profile.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(profile.id)}
                className="p-2 text-slate-500 hover:text-red-400 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
