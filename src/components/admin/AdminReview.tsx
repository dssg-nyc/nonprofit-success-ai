import React from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { ShieldCheck, ClipboardList, DraftingCompass } from 'lucide-react';
import ScoutReviewQueue from '../scout/ScoutReviewQueue';
import ArchitectQueue from '../architect/ArchitectQueue';

/**
 * The one admin surface: each agent's suggestions, lined up for a human decision.
 *
 *   /admin/applications — Scout. Pending · Needs info · Approved · Declined.
 *   /admin/assessments  — Architect. Every approved partner by name, with the drafted
 *                         Current-State Assessment waiting for confirmation.
 *
 * Who sees it is decided in App.tsx (admins today). Clients never reach this route; their
 * view is the Overview and their own partner page.
 */

const SECTIONS = [
  { key: 'applications', label: 'Applications', icon: ClipboardList, agent: 'Scout' },
  { key: 'assessments', label: 'Assessments', icon: DraftingCompass, agent: 'Architect' },
] as const;

type Section = typeof SECTIONS[number]['key'];

const isSection = (s: string | undefined): s is Section => SECTIONS.some(x => x.key === s);

export default function AdminReview({ isDemo }: { isDemo?: boolean }) {
  const { section } = useParams();
  if (!isSection(section)) return <Navigate to="/admin/applications" replace />;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-dssg-blue rounded-full text-[10px] font-bold uppercase tracking-widest mb-4">
            <ShieldCheck size={12} />
            Admin Review
          </div>
          <h1 className="text-4xl font-display font-bold text-dssg-blue tracking-tight leading-[1.1]">
            Agents <span className="italic">suggest</span>, you decide
          </h1>
        </div>
        <div className="flex gap-2 border-b border-slate-200">
          {SECTIONS.map(({ key, label, icon: Icon, agent }) => (
            <NavLink
              key={key}
              to={`/admin/${key}`}
              className={({ isActive }) =>
                `px-4 py-3 -mb-px border-b-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-colors ${
                  isActive ? 'border-dssg-blue text-dssg-blue' : 'border-transparent text-slate-400 hover:text-slate-600'
                }`
              }
            >
              <Icon size={14} /> {label}
              <span className="normal-case tracking-normal font-medium text-slate-300">· {agent}</span>
            </NavLink>
          ))}
        </div>
      </div>

      {section === 'applications' ? <ScoutReviewQueue isDemo={isDemo} /> : <ArchitectQueue isDemo={isDemo} />}
    </div>
  );
}
