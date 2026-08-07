import React, { useState, useEffect } from 'react';
import { Building2, Hash, Globe, Layers, ArrowRight, AlertCircle } from 'lucide-react';

interface OrganizationSectionProps {
  data: any;
  lookupResult?: any;
  onComplete: (data: any) => void;
  errors: Record<string, string>;
}

const inputClass = 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-dssg-blue focus:border-transparent transition-all outline-none';
const selectClass = inputClass;

export default function OrganizationSection({ data, lookupResult, onComplete, errors }: OrganizationSectionProps) {
  const [orgName, setOrgName] = useState(data.orgName || '');
  const [orgType, setOrgType] = useState(data.orgType || 'nonprofit');
  const [orgEin, setOrgEin] = useState(data.orgEin || '');
  const [orgIndustry, setOrgIndustry] = useState(data.orgIndustry || '');
  const [orgWebsite, setOrgWebsite] = useState(data.orgWebsite || '');

  // Pre-fill from lookup result when available
  useEffect(() => {
    if (lookupResult) {
      setOrgName(lookupResult.orgName || orgName);
      setOrgType(lookupResult.orgType || orgType);
      setOrgEin(lookupResult.ein || orgEin);
      setOrgWebsite(lookupResult.website || orgWebsite);
    }
  }, [lookupResult]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (orgName && orgType) {
      onComplete({ orgName, orgType, orgEin, orgIndustry, orgWebsite });
    }
  };

  return (
    <div>
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-xl mb-4">
          <Building2 className="text-dssg-blue" size={24} />
        </div>
        <h2 className="text-2xl font-display font-bold text-dssg-blue tracking-tight mb-2">Your Organization</h2>
        <p className="text-slate-500 text-sm font-medium">
          {lookupResult ? 'Review and edit your organization details' : 'Tell us about your organization'}
        </p>
      </div>

      {lookupResult && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex gap-3">
          <AlertCircle className="text-blue-600 flex-shrink-0" size={18} />
          <p className="text-xs font-medium text-blue-700">
            Information auto-filled from {lookupResult.source.toUpperCase()}. Edit as needed.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Organization Name *</label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className={inputClass + ' pl-10'}
              placeholder="Community Services Inc"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Organization Type *</label>
          <div className="relative">
            <Layers className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <select
              value={orgType}
              onChange={(e) => setOrgType(e.target.value)}
              className={selectClass + ' pl-10'}
            >
              <option value="nonprofit">Nonprofit</option>
              <option value="small_business">Small Business</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">EIN (if nonprofit)</label>
          <div className="relative">
            <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              value={orgEin}
              onChange={(e) => setOrgEin(e.target.value)}
              className={inputClass + ' pl-10'}
              placeholder="12-3456789"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Industry</label>
          <input
            type="text"
            value={orgIndustry}
            onChange={(e) => setOrgIndustry(e.target.value)}
            className={inputClass}
            placeholder="e.g. Education, Healthcare, Community Development"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Website</label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="url"
              value={orgWebsite}
              onChange={(e) => setOrgWebsite(e.target.value)}
              className={inputClass + ' pl-10'}
              placeholder="https://example.org"
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
