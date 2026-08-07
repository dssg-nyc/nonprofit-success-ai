import React, { useState } from 'react';
import { Target, DollarSign, Calendar, ArrowRight } from 'lucide-react';

interface ProgramSectionProps {
  data: any;
  onComplete: (data: any) => void;
  errors: Record<string, string>;
}

const selectClass = 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-dssg-blue focus:border-transparent transition-all outline-none';

export default function ProgramSection({ data, onComplete, errors }: ProgramSectionProps) {
  const [programInterest, setProgramInterest] = useState(data.programInterest || 'grant');
  const [fundingRange, setFundingRange] = useState(data.fundingRange || 'unsure');
  const [projectTimeline, setProjectTimeline] = useState(data.projectTimeline || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (programInterest && projectTimeline) {
      onComplete({ programInterest, fundingRange, projectTimeline });
    }
  };

  return (
    <div>
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-xl mb-4">
          <Target className="text-dssg-blue" size={24} />
        </div>
        <h2 className="text-2xl font-display font-bold text-dssg-blue tracking-tight mb-2">Program Interest</h2>
        <p className="text-slate-500 text-sm font-medium">What are you most interested in?</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Program Interest *</label>
          <div className="relative">
            <Target className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
            <select
              value={programInterest}
              onChange={(e) => setProgramInterest(e.target.value)}
              className={selectClass + ' pl-10'}
            >
              <option value="grant">Data-driven grant project</option>
              <option value="hackathon">Hackathon engagement</option>
              <option value="ongoing">Ongoing consulting / partnership</option>
              <option value="consulting">Custom consulting engagement</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Funding Range</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
            <select
              value={fundingRange}
              onChange={(e) => setFundingRange(e.target.value)}
              className={selectClass + ' pl-10'}
            >
              <option value="0_50k">$0–50K</option>
              <option value="50_150k">$50K–150K</option>
              <option value="150_500k">$150K–500K</option>
              <option value="500k_plus">$500K+</option>
              <option value="unsure">Not sure yet</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Project Timeline *</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              required
              value={projectTimeline}
              onChange={(e) => setProjectTimeline(e.target.value)}
              className={selectClass + ' pl-10'}
              placeholder="e.g. This quarter, before Q2 2026"
            />
          </div>
        </div>

        <button type="submit" className="w-full py-3 bg-dssg-orange text-white rounded-xl font-bold hover:bg-dssg-orange-light transition-all flex items-center justify-center gap-2">
          Continue
          <ArrowRight size={18} />
        </button>
      </form>
    </div>
  );
}
