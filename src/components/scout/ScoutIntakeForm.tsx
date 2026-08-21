import React, { useState } from 'react';
import { supabase, toColumns, handleSupabaseError, OperationType } from '../../lib/supabase';
import { PrimaryNeed, PRIMARY_NEED_OPTIONS } from '../../types';
import { routeScoutIntake } from '../../lib/scoutRouting';
import { motion } from 'motion/react';
import { CheckCircle2, Compass } from 'lucide-react';

interface ScoutIntakeFormProps {
  isDemo?: boolean;
}

const initialForm = {
  org_name: '',
  contact_name_role: '',
  contact_email: '',
  mission: '',
  scale: '',
  primary_need: 'analyze_data' as PrimaryNeed,
  primary_need_other: '',
  problem_description: '',
  current_systems: '',
  timeline: '',
  referral_source: '',
};

export default function ScoutIntakeForm({ isDemo }: ScoutIntakeFormProps) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const update = (field: keyof typeof initialForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const result = routeScoutIntake({
      scale: form.scale,
      primary_need: form.primary_need,
      primary_need_other: form.primary_need_other || undefined,
      problem_description: form.problem_description,
      current_systems: form.current_systems,
      contact_name_role: form.contact_name_role,
      timeline: form.timeline,
    });

    if (isDemo) {
      setSubmitting(false);
      setSubmitted(true);
      return;
    }

    try {
      // Insert runs as `anon` when nobody is signed in — scout_intakes_insert_public allows
      // that, but only for a row that is genuinely new: review_status 'pending' with the
      // review fields unset. A submitter cannot pre-approve their own intake.
      //
      // `submitted_at` is left to the column default rather than sent from the browser, so
      // the timestamp is the server's, not whatever the client's clock says.
      const { error } = await supabase.from('scout_intakes').insert(
        toColumns({
          ...form,
          primary_need_other: form.primary_need === 'something_else' ? form.primary_need_other : '',
          ...result,
          reviewStatus: 'pending',
        }),
      );

      if (error) handleSupabaseError(error, OperationType.CREATE, 'scout_intakes');
      setSubmitted(true);
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'scout_intakes');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-4 bg-slate-50">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-lg bg-white p-10 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 text-center"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-50 rounded-2xl mb-6">
            <CheckCircle2 className="text-emerald-600" size={32} />
          </div>
          <h2 className="text-2xl font-display font-bold text-dssg-blue tracking-tight mb-3">
            Thanks for reaching out
          </h2>
          <p className="text-slate-500 text-sm font-medium leading-relaxed">
            We've received your application. A member of the DSSG NYC team will review it and follow up by email soon.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-4 py-12 bg-slate-50">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-white p-8 sm:p-10 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl mb-4">
            <Compass className="text-dssg-blue" size={28} />
          </div>
          <h2 className="text-3xl font-display font-bold text-dssg-blue tracking-tight">Apply to Work with DSSG NYC</h2>
          <p className="text-slate-500 mt-2 text-sm font-medium">
            Tell us about your organization — takes about 5–7 minutes.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Organization name">
            <input
              required
              value={form.org_name}
              onChange={e => update('org_name', e.target.value)}
              className={inputClass}
              placeholder="e.g. Bronx Literacy Fund"
            />
          </Field>

          <Field label="Your name and role">
            <input
              required
              value={form.contact_name_role}
              onChange={e => update('contact_name_role', e.target.value)}
              className={inputClass}
              placeholder="e.g. Jane Doe, Executive Director"
            />
          </Field>

          <Field label="Best email to reach you">
            <input
              type="email"
              required
              value={form.contact_email}
              onChange={e => update('contact_email', e.target.value)}
              className={inputClass}
              placeholder="name@organization.org"
            />
          </Field>

          <Field label="In one or two sentences, what does your organization do?">
            <textarea
              required
              value={form.mission}
              onChange={e => update('mission', e.target.value)}
              className={`${inputClass} h-20 resize-none`}
            />
          </Field>

          <Field label="Who do you serve, and roughly how many people per year?">
            <input
              required
              value={form.scale}
              onChange={e => update('scale', e.target.value)}
              className={inputClass}
              placeholder="e.g. ~400 clients/year, staff of 18"
            />
          </Field>

          <Field label="What brings you to DSSG?">
            <select
              value={form.primary_need}
              onChange={e => update('primary_need', e.target.value)}
              className={inputClass}
            >
              {PRIMARY_NEED_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </Field>

          {form.primary_need === 'something_else' && (
            <Field label="Tell us more">
              <input
                required
                value={form.primary_need_other}
                onChange={e => update('primary_need_other', e.target.value)}
                className={inputClass}
              />
            </Field>
          )}

          <Field label="Describe the problem or opportunity in your own words">
            <textarea
              required
              value={form.problem_description}
              onChange={e => update('problem_description', e.target.value)}
              className={`${inputClass} h-24 resize-none`}
            />
          </Field>

          <Field label="What data or systems do you currently work with?">
            <input
              required
              value={form.current_systems}
              onChange={e => update('current_systems', e.target.value)}
              className={inputClass}
              placeholder="e.g. Salesforce CRM, spreadsheets, nothing yet"
            />
          </Field>

          <Field label="When would you ideally want to start, and is there a deadline driving this?">
            <input
              required
              value={form.timeline}
              onChange={e => update('timeline', e.target.value)}
              className={inputClass}
              placeholder="e.g. This quarter, before our next cohort in September"
            />
          </Field>

          <Field label="How did you hear about DSSG?">
            <input
              value={form.referral_source}
              onChange={e => update('referral_source', e.target.value)}
              className={inputClass}
            />
          </Field>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 bg-dssg-orange text-white rounded-xl font-bold shadow-lg shadow-orange-900/10 hover:bg-dssg-orange-light active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              'Submit Application'
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

const inputClass = 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-dssg-blue focus:border-transparent transition-all outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">{label}</label>
      {children}
    </div>
  );
}
