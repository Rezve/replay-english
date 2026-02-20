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
    <aside className="w-56 bg-navy-950 border-r border-navy-800 flex flex-col">
      <nav className="flex-1 p-3 space-y-1 pt-4">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-navy-800'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-navy-800">
        <p className="text-xs text-slate-600">v1.0.0 MVP</p>
      </div>
    </aside>
  );
}
