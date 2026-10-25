import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Database,
  Bot,
  Copy,
  Check,
  X,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { SalesforceLead } from '../../lib/salesforceLead';
import { dispatchSalesforceWebhook } from '../../lib/salesforceLead';

interface SalesforceLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: SalesforceLead | null;
}

export default function SalesforceLeadModal({
  isOpen,
  onClose,
  lead,
}: SalesforceLeadModalProps) {
  const [activeTab, setActiveTab] = useState<'salesforce' | 'agentforce'>('salesforce');
  const [copied, setCopied] = useState(false);
  const [customWebhookUrl, setCustomWebhookUrl] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<{
    success: boolean;
    message: string;
    timestamp: string;
  } | null>(null);

  if (!isOpen || !lead) return null;

  const handleCopyJson = () => {
    const payload =
      activeTab === 'salesforce'
        ? JSON.stringify(lead, null, 2)
        : JSON.stringify(lead.Agentforce_Context, null, 2);
    navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDispatch = async () => {
    setDispatching(true);
    setDispatchResult(null);
    const result = await dispatchSalesforceWebhook(lead, customWebhookUrl);
    setDispatching(false);
    setDispatchResult(result);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-6 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Database size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-sans font-bold text-base text-white">
                    Salesforce & Agentforce Lead Schema
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    Lead ID: {lead.Id}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Structured CRM schema payload generated automatically from intake validation
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="px-6 pt-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('salesforce')}
                className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                  activeTab === 'salesforce'
                    ? 'border-dssg-blue text-dssg-blue'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <Database size={14} />
                Salesforce Lead sObject
              </button>
              <button
                onClick={() => setActiveTab('agentforce')}
                className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                  activeTab === 'agentforce'
                    ? 'border-dssg-blue text-dssg-blue'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <Bot size={14} />
                Agentforce AI Triage Schema
              </button>
            </div>

            <button
              onClick={handleCopyJson}
              className="mb-3 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-white flex items-center gap-1.5 shadow-sm transition-colors"
            >
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy JSON'}</span>
            </button>
          </div>

          {/* Body Payload Display */}
          <div className="p-6 overflow-y-auto space-y-5 flex-grow">
            {activeTab === 'salesforce' ? (
              <div className="space-y-4">
                {/* Field summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Company</span>
                    <span className="text-xs font-bold text-slate-800 truncate block mt-0.5">{lead.Company}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Status</span>
                    <span className="text-xs font-bold text-emerald-700 truncate block mt-0.5">{lead.Status}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Tax Status</span>
                    <span className="text-xs font-bold text-blue-700 truncate block mt-0.5">{lead.Tax_Status__c}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Annual Revenue</span>
                    <span className="text-xs font-bold text-slate-800 truncate block mt-0.5 font-mono">
                      {lead.AnnualRevenue ? `$${lead.AnnualRevenue.toLocaleString()}` : 'N/A'}
                    </span>
                  </div>
                </div>

                {/* Raw JSON Code block */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                      Lead Object JSON (sObject Schema)
                    </label>
                  </div>
                  <pre className="p-4 rounded-2xl bg-slate-900 text-slate-200 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-64 border border-slate-800">
                    {JSON.stringify(lead, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200/80 space-y-2">
                  <div className="flex items-center gap-2 text-dssg-blue">
                    <Bot size={16} />
                    <span className="text-xs font-bold">Agentforce Autonomous Triage Engine</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    This payload provides the semantic prompt parameters for Salesforce Agentforce to classify incoming nonprofit partner leads, assign priority, and trigger automated intake scheduling workflows.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Readiness Tier</span>
                    <span className="text-xs font-bold text-dssg-blue block mt-0.5 font-mono">
                      {lead.Agentforce_Context.readiness_tier}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Recommended DSSG Track</span>
                    <span className="text-xs font-bold text-dssg-orange block mt-0.5">
                      {lead.Agentforce_Context.recommended_dssg_track}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block mb-1.5">
                    Agentforce Context Prompt Schema
                  </label>
                  <pre className="p-4 rounded-2xl bg-slate-900 text-slate-200 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-64 border border-slate-800">
                    {JSON.stringify(lead.Agentforce_Context, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Webhook Dispatch & Sync section */}
            <div className="pt-4 border-t border-slate-200">
              <label className="text-xs font-bold text-slate-800 block mb-1">
                Salesforce Webhook & Lead Sync Endpoint
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://your-salesforce-instance.my.salesforce.com/services/apexrest/LeadSync"
                  value={customWebhookUrl}
                  onChange={(e) => setCustomWebhookUrl(e.target.value)}
                  className="flex-grow text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue"
                />
                <button
                  onClick={handleDispatch}
                  disabled={dispatching}
                  className="px-4 py-2.5 bg-dssg-blue text-white rounded-xl text-xs font-bold hover:bg-dssg-blue-light transition-all flex items-center gap-1.5 shrink-0 shadow-sm"
                >
                  {dispatching ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  <span>{dispatching ? 'Syncing...' : 'Test Sync'}</span>
                </button>
              </div>

              {dispatchResult && (
                <div
                  className={`mt-3 p-3.5 rounded-xl text-xs flex items-start gap-2.5 border ${
                    dispatchResult.success
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}
                >
                  <ShieldCheck size={16} className="shrink-0 mt-0.5 text-emerald-600" />
                  <div className="space-y-0.5">
                    <span className="font-bold block">{dispatchResult.message}</span>
                    <span className="text-[10px] text-slate-500 font-mono block">
                      Confirmed at: {new Date(dispatchResult.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer Action */}
          <div className="p-4 px-6 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">
              Lead payload saved in local schema storage
            </span>
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors"
            >
              Close Inspector
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
