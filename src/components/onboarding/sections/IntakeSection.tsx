import React, { useState } from 'react';
import { Compass, Send } from 'lucide-react';
import { PRIMARY_NEED_OPTIONS } from '../../../types';

interface IntakeSectionProps {
  data: any;
  onComplete: (data: any) => void;
  onSubmit: () => void;
  errors: Record<string, string>;
  loading: boolean;
}

const inputClass = 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-dssg-blue focus:border-transparent transition-all outline-none';
const textareaClass = inputClass + ' h-24 resize-none';

export default function IntakeSection({ data, onComplete, onSubmit, errors, loading }: IntakeSectionProps) {
  const [mission, setMission] = useState(data.mission || '');
  const [scale, setScale] = useState(data.scale || '');
  const [primaryNeed, setPrimaryNeed] = useState(data.primaryNeed || 'analyze_data');
  const [primaryNeedOther, setPrimaryNeedOther] = useState(data.primaryNeedOther || '');
  const [problemDescription, setProblemDescription] = useState(data.problemDescription || '');
  const [currentSystems, setCurrentSystems] = useState(data.currentSystems || '');
  const [referralSource, setReferralSource] = useState(data.referralSource || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onComplete({
      mission,
      scale,
      primaryNeed,
      primaryNeedOther: primaryNeed === 'something_else' ? primaryNeedOther : '',
      problemDescription,
      currentSystems,
      referralSource,
    });
    onSubmit();
  };

  return (
    <div>
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-xl mb-4">
          <Compass className="text-dssg-blue" size={24} />
        </div>
        <h2 className="text-2xl font-display font-bold text-dssg-blue tracking-tight mb-2">Intake Assessment</h2>
        <p className="text-slate-500 text-sm font-medium">Tell us about your data challenge</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">What does your organization do? *</label>
          <textarea
            required
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            className={textareaClass}
            placeholder="Describe your mission in one or two sentences"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Scale (beneficiaries, staff)</label>
          <input
            type="text"
            value={scale}
            onChange={(e) => setScale(e.target.value)}
            className={inputClass}
            placeholder="~400 clients/year, 18 staff"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">What brings you to DSSG NYC? *</label>
          <select
            value={primaryNeed}
            onChange={(e) => setPrimaryNeed(e.target.value)}
            className={inputClass}
          >
            {PRIMARY_NEED_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {primaryNeed === 'something_else' && (
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Tell us more *</label>
            <input
              type="text"
              required
              value={primaryNeedOther}
              onChange={(e) => setPrimaryNeedOther(e.target.value)}
              className={inputClass}
              placeholder="Describe your specific need"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Describe the problem or opportunity *</label>
          <textarea
            required
            value={problemDescription}
            onChange={(e) => setProblemDescription(e.target.value)}
            className={textareaClass}
            placeholder="What's the specific challenge you're trying to solve?"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">What data or systems do you currently work with? *</label>
          <input
            type="text"
            required
            value={currentSystems}
            onChange={(e) => setCurrentSystems(e.target.value)}
            className={inputClass}
            placeholder="e.g. Salesforce, spreadsheets, nothing yet"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">How did you hear about us?</label>
          <input
            type="text"
            value={referralSource}
            onChange={(e) => setReferralSource(e.target.value)}
            className={inputClass}
            placeholder="e.g. Friend, conference, Google search"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-dssg-blue text-white rounded-xl font-bold hover:bg-dssg-blue-light transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              Submit Application
              <Send size={18} />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
