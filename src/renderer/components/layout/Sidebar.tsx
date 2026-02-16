import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Mic,
  List,
  BarChart3,
  Users,
  Settings,
} from 'lucide-react';

const navItems = [
  { to: '/record', icon: Mic, label: 'Record' },
  { to: '/meetings', icon: List, label: 'Meetings' },
  { to: '/dashboard', icon: BarChart3, label: 'Dashboard' },
  { to: '/profiles', icon: Users, label: 'Profiles' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside className="w-56 bg-slate-950 border-r border-slate-800 flex flex-col">
      <div className="p-4 border-b border-slate-800">
        <h1 className="text-lg font-bold text-white tracking-tight">
          MemPill Language
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">Improve your speaking</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <p className="text-xs text-slate-500">v1.0.0 MVP</p>
      </div>
    </aside>
  );
}
