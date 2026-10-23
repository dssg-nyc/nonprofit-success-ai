import React from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { ScoutBucket, SCOUT_BUCKETS } from '../../types';

/**
 * One confirm dialog for every review decision that needs a word from the reviewer —
 * change bucket, needs more info, decline, reopen. The caller says which fields it wants
 * and what the confirm button commits to; the dialog only collects.
 */
export interface ReviewModalProps {
  title: string;
  /** One sentence on what confirming does, shown under the title. */
  intro: string;
  bucket?: { label: string; value: ScoutBucket | ''; onChange: (b: ScoutBucket) => void };
  notes: { label: string; value: string; onChange: (v: string) => void; required: boolean; placeholder?: string };
  confirmLabel: string;
  /** A decline reads differently from an approval. */
  danger?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ReviewModal({ title, intro, bucket, notes, confirmLabel, danger, busy, onConfirm, onClose }: ReviewModalProps) {
  const ready = (!bucket || bucket.value !== '') && (!notes.required || notes.value.trim().length > 0) && !busy;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden p-8"
      >
        <div className="flex justify-between items-start mb-2">
          <h2 className="text-xl font-display italic font-black">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X />
          </button>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed mb-6">{intro}</p>

        <div className="space-y-4">
          {bucket && (
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">{bucket.label}</label>
              <select
                value={bucket.value}
                onChange={e => bucket.onChange(e.target.value as ScoutBucket)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-dssg-blue"
              >
                <option value="" disabled>Choose a bucket…</option>
                {SCOUT_BUCKETS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">
              {notes.label} {notes.required ? '' : '(optional)'}
            </label>
            <textarea
              value={notes.value}
              onChange={e => notes.onChange(e.target.value)}
              placeholder={notes.placeholder}
              className="w-full h-24 p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-dssg-blue resize-none"
            />
          </div>

          <button
            onClick={onConfirm}
            disabled={!ready}
            className={`w-full py-4 text-white rounded-xl font-bold shadow-lg transition-all disabled:opacity-50 ${
              danger ? 'bg-rose-600 shadow-rose-100 hover:bg-rose-700' : 'bg-dssg-blue shadow-blue-100 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
