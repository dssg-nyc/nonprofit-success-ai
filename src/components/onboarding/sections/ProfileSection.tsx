import React, { useState } from 'react';
import { motion } from 'motion/react';
import { User, Phone, Briefcase, ArrowRight } from 'lucide-react';

interface ProfileSectionProps {
  data: any;
  onComplete: (data: any) => void;
  errors: Record<string, string>;
}

const inputClass = 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-dssg-blue focus:border-transparent transition-all outline-none';

export default function ProfileSection({ data, onComplete, errors }: ProfileSectionProps) {
  const [contactName, setContactName] = useState(data.contactName || '');
  const [contactRole, setContactRole] = useState(data.contactRole || '');
  const [contactPhone, setContactPhone] = useState(data.contactPhone || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (contactName && contactRole && contactPhone) {
      onComplete({ contactName, contactRole, contactPhone });
    }
  };

  return (
    <div>
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-xl mb-4">
          <User className="text-dssg-blue" size={24} />
        </div>
        <h2 className="text-2xl font-display font-bold text-dssg-blue tracking-tight mb-2">Your Profile</h2>
        <p className="text-slate-500 text-sm font-medium">Let us know who you are</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Full Name</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              required
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className={inputClass + ' pl-10'}
              placeholder="Jane Doe"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Title / Role</label>
          <div className="relative">
            <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              required
              value={contactRole}
              onChange={(e) => setContactRole(e.target.value)}
              className={inputClass + ' pl-10'}
              placeholder="Executive Director"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Phone</label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="tel"
              required
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className={inputClass + ' pl-10'}
              placeholder="+1 (555) 123-4567"
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
