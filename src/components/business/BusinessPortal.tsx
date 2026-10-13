import { useState, useEffect } from 'react';
import { ErrorBanner } from '../ErrorBanner';
import { reportSupabaseError } from '../supabaseErrors';
import { useParams, useNavigate } from 'react-router-dom';
import {
  supabase, liveQuery, toColumns, rowToDomain, handleSupabaseError, OperationType,
} from '../../lib/supabase';
import type { TablesInsert } from '../../lib/database.types';
import { Business, Engagement, EngagementStage } from '../../types';
import type { LucideIcon } from 'lucide-react';
import {
  History,
  DollarSign,
  ShieldCheck,
  Target,
  Code2,
  CheckCircle,
  ChevronLeft,
  RefreshCcw,
  Save,
  Building2
} from 'lucide-react';

const STAGES: { id: EngagementStage; label: string; short: string; icon: LucideIcon; color: string }[] = [
  { id: 'initial_meeting', label: 'Initial Meeting', short: 'Meeting', icon: History, color: 'text-blue-600 bg-blue-100' },
  { id: 'budget_check', label: 'Budget Check', short: 'Budget', icon: DollarSign, color: 'text-emerald-600 bg-emerald-100' },
  { id: 'data_ethics_committee', label: 'Data Ethics Committee', short: 'Ethics', icon: ShieldCheck, color: 'text-amber-600 bg-amber-100' },
  { id: 'scoping', label: 'Scoping', short: 'Scoping', icon: Target, color: 'text-indigo-600 bg-indigo-100' },
  { id: 'hackathon_ready', label: 'Hackathon Ready', short: 'Hackathon', icon: Code2, color: 'text-rose-600 bg-rose-100' },
  { id: 'membership', label: 'Membership', short: 'Membership', icon: CheckCircle, color: 'text-purple-600 bg-purple-100' },
];

interface StageNote { id: string; detail: string; createdAt: string }

export default function BusinessPortal({ isDemo }: { isDemo?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [business, setBusiness] = useState<Business | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [activeStage, setActiveStage] = useState<EngagementStage>('initial_meeting');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<StageNote[]>([]);

  useEffect(() => {
    if (isDemo && id) {
      const demoBusinesses: Record<string, Business> = {
        'demo-biz-1': {
          id: 'demo-biz-1',
          name: 'Harlem Tech Solutions',
          type: 'small_business',
          industry: 'IT Consulting',
          ownerId: 'demo-user-123',
          certified: true,
          createdAt: { seconds: Date.now() / 1000 - 1000000 }
        },
        'demo-biz-2': {
          id: 'demo-biz-2',
          name: 'The Bronx Literacy Fund',
          type: 'nonprofit',
          industry: 'Education',
          ownerId: 'demo-user-123',
          certified: false,
          createdAt: { seconds: Date.now() / 1000 - 2000000 }
        },
        'demo-biz-3': {
          id: 'demo-biz-3',
          name: 'Brooklyn Green Eats',
          type: 'small_business',
          industry: 'Food & Beverage',
          ownerId: 'demo-user-123',
          certified: true,
          createdAt: { seconds: Date.now() / 1000 - 3000000 }
        }
      };

      setBusiness(demoBusinesses[id] || demoBusinesses['demo-biz-1']);
      setEngagements([
        {
          id: 'demo-eng-1',
          businessId: id,
          ownerId: 'demo-user-123',
          stage: 'initial_meeting',
          status: 'completed',
          notes: 'Successful discovery call. Defined core data assets.',
          updatedAt: { seconds: Date.now() / 1000 - 86400 }
        },
        {
          id: 'demo-eng-2',
          businessId: id,
          ownerId: 'demo-user-123',
          stage: 'budget_check',
          status: 'in_progress',
          budget_amount: 12500,
          updatedAt: { seconds: Date.now() / 1000 }
        }
      ]);
      setActiveStage('budget_check');
      setLoading(false);
      return;
    }

    if (!id) return;

    // Fetch Business. RLS restricts this to rows the caller owns, so a business belonging
    // to someone else comes back empty and redirects — the same outcome as "not found",
    // which is deliberate: it does not disclose that the row exists.
    const fetchBusiness = async () => {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        setError(
          reportSupabaseError(error, OperationType.GET, `businesses/${id}`, 'Could not load this business. Reload to try again.'),
        );
        setLoading(false);
        return;
      }

      if (data) setBusiness(rowToDomain<Business>(data, ['createdAt', 'updatedAt']));
      else navigate('/dashboard');
    };

    void fetchBusiness();

    const unsubscribe = liveQuery<Engagement>(
      'engagements',
      () => supabase.from('engagements').select('*').eq('business_id', id),
      (data) => {
        setEngagements(data);

      // If we have engagements, set the latest one as active by default or the first one
      if (data.length > 0) {
        // Find most recent or in_progress stage
        const inProgress = data.find(e => e.status === 'in_progress');
        if (inProgress) setActiveStage(inProgress.stage);
        else setActiveStage(data[data.length - 1].stage);
      }

        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setError(
          reportSupabaseError(err, OperationType.LIST, 'engagements', 'Could not load engagements. The stages shown may be incomplete.'),
        );
      },
      ['createdAt', 'updatedAt'],
    );

    return unsubscribe;
  }, [id, isDemo, navigate]);

  const getCurrentEngagement = () => engagements.find(e => e.stage === activeStage);
  const currentEngagementId = engagements.find(e => e.stage === activeStage)?.id;

  // The current stage row's saved notes, newest first, read through RLS. Demo notes live in
  // local state only.
  const loadNotes = async (engagementId: string) => {
    const { data, error: notesError } = await supabase
      .from('engagement_events')
      .select('id, detail, created_at')
      .eq('engagement_id', engagementId)
      .eq('kind', 'note_added')
      .order('created_at', { ascending: false });
    if (notesError) {
      setError(
        reportSupabaseError(notesError, OperationType.LIST, 'engagement_events', 'Could not load saved notes.'),
      );
      return;
    }
    // `detail` is a jsonb object; a note carries its text under `text`.
    setNotes(
      (data ?? []).map(r => ({
        id: r.id,
        detail: (r.detail as { text?: string } | null)?.text ?? '',
        createdAt: r.created_at,
      })),
    );
  };

  useEffect(() => {
    if (isDemo) return;
    if (!currentEngagementId) {
      setNotes([]);
      return;
    }
    void loadNotes(currentEngagementId);
  }, [currentEngagementId, isDemo]);

  // Stage changes are no longer written from the browser: engagements is read-only to
  // partners (0001_core) and stages move only through transition_engagement() (/api/engagement-
  // transition). A partner's note is an append-only `note_added` event on the stage's row.
  const addNote = async () => {
    const text = noteDraft.trim();
    if (!text) return;

    if (isDemo) {
      const existing = getCurrentEngagement();
      if (existing) {
        setEngagements(prev => prev.map(e => e.id === existing.id
          ? { ...e, notes: text, updatedAt: { seconds: Date.now() / 1000 } }
          : e));
        setNotes(prev => [
          { id: `demo-note-${Date.now()}`, detail: text, createdAt: new Date().toISOString() },
          ...prev,
        ]);
      }
      setNoteDraft('');
      return;
    }

    const existing = getCurrentEngagement();
    if (!id || !existing) {
      setError('Notes attach to a started stage. This stage has not started yet.');
      return;
    }

    if (!existing.organizationId) {
      setError('This stage is not linked to an organization yet; ask DSSG staff.');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await supabase.from('engagement_events').insert(
        toColumns<TablesInsert<'engagement_events'>>({
          engagementId: existing.id,
          organizationId: existing.organizationId,
          createdBy: user.id,
          kind: 'note_added',
          detail: { text },
        }),
      );

      if (error) handleSupabaseError(error, OperationType.CREATE, 'engagement_events');
      setNoteDraft('');
      await loadNotes(existing.id);
    } catch (err) {
      console.error('BusinessPortal: note save failed — note not recorded', err);
      setError('Could not save this note. It was not recorded.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center">Loading portal...</div>;
  if (!business) {
    // A failed load used to render nothing at all; show why.
    return error ? (
      <div className="max-w-2xl mx-auto px-4 py-24">
        <ErrorBanner message={error} onDismiss={() => navigate('/dashboard')} />
      </div>
    ) : null;
  }

  const currentEngagement = getCurrentEngagement();

  return (
    <div className="bg-bg-base min-h-screen">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {/* Header Strategy */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-slate-400 hover:text-dssg-blue transition-all font-bold text-[10px] uppercase tracking-[0.2em]"
          >
            <ChevronLeft size={14} />
            Portfolio Index
          </button>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Status</span>
              <span className="text-xs font-bold text-emerald-600 uppercase">Live Collaboration</span>
            </div>
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-sm shadow-emerald-200" />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12 animate-fade-in-up">
        {/* Bento Grid Strategy */}
        <div className="grid grid-cols-12 grid-rows-6 gap-8 h-auto lg:h-[900px]">

          {/* Profile Card — Brand Authority Variant */}
          <div className="col-span-12 lg:col-span-4 row-span-2 bento-card bg-dssg-blue text-white p-10 relative overflow-hidden flex flex-col justify-between">
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest text-blue-100 mb-8">
                <Building2 size={12} />
                Client Profile
              </div>
              <h1 className="text-4xl font-display font-bold text-white leading-tight mb-2 italic">
                {business.name}
              </h1>
              <p className="text-sm font-medium text-blue-200 opacity-80 uppercase tracking-widest">
                {business.type.replace('_', ' ')} Partner
              </p>
            </div>

            <div className="relative z-10 grid grid-cols-2 gap-6 pt-8 border-t border-white/10">
              <div>
                <p className="text-[9px] font-bold text-blue-300 uppercase tracking-widest mb-1">Industry focus</p>
                <p className="text-sm font-bold">{business.industry || 'General'}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-blue-300 uppercase tracking-widest mb-1">NYC Partnership</p>
                <p className="text-sm font-bold">Est. {new Date((business.createdAt?.seconds ?? NaN) * 1000).getFullYear()}</p>
              </div>
            </div>

            <div className="absolute -right-12 -bottom-12 opacity-10 rotate-12 scale-110">
              <Building2 size={240} />
            </div>
          </div>

          {/* Workflow Status — Roadmap Strategy */}
          <div className="col-span-12 lg:col-span-8 row-span-2 bento-card p-10 flex flex-col justify-between accent-stripe-blue">
            <div className="flex justify-between items-start mb-8">
              <div>
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Onboarding Roadmap</h2>
                <p className="text-xl font-display font-medium text-slate-800">Engagement Lifecycle Progress</p>
              </div>
              <span className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-sm ${
                currentEngagement?.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                currentEngagement?.status === 'in_progress' ? 'bg-dssg-orange-light/10 text-dssg-orange border border-dssg-orange/20' :
                'bg-slate-50 text-slate-400 border border-slate-100'
              }`}>
                Current Stage: {STAGES.find(s => s.id === activeStage)?.label}
              </span>
            </div>

            <div className="flex items-center justify-between px-6 relative">
              {STAGES.map((s, idx) => {
                const stageData = engagements.find(e => e.stage === s.id);
                const isCompleted = stageData?.status === 'completed';
                const isActive = activeStage === s.id;

                return (
                  <div key={s.id} className="flex flex-col items-center gap-4 relative z-10 group cursor-pointer" onClick={() => setActiveStage(s.id)}>
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500 border ${
                      isCompleted ? 'bg-dssg-blue text-white shadow-xl shadow-blue-900/20 border-dssg-blue' :
                      isActive ? 'bg-white border-2 border-dssg-blue ring-4 ring-blue-50 text-dssg-blue' :
                      'bg-slate-50 text-slate-300 border-slate-100'
                    }`}>
                      {isCompleted ? <CheckCircle size={28} /> : <span className="font-display font-bold text-lg leading-none">0{idx + 1}</span>}
                    </div>
                    <span className={`text-[9px] font-bold uppercase tracking-[0.3em] ${isActive ? 'text-dssg-blue' : 'text-slate-400 opacity-60'}`}>
                      {s.short}
                    </span>
                  </div>
                );
              })}
              {/* Connector Line Base Pattern */}
              <div className="absolute left-[8%] right-[8%] top-[35%] h-[2px] bg-slate-100 -z-0 hidden lg:block" />
            </div>
          </div>

          {/* Action Log (Bento: Tall) */}
          <div className="col-span-12 lg:col-span-3 row-span-4 bento-card p-6 flex flex-col">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-6">Engagement Feed</h2>
            <div className="space-y-6 flex-grow">
              {engagements.sort((a,b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)).map(e => (
                <div key={e.id} className="flex gap-4 items-start">
                  <div className={`w-1 h-8 rounded-full shrink-0 ${e.status === 'completed' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                  <div>
                    <p className="text-xs font-bold text-slate-800 uppercase tracking-tight">{STAGES.find(s => s.id === e.stage)?.label}</p>
                    <p className="text-[10px] text-slate-400 font-medium">{e.status} • {new Date((e.updatedAt?.seconds ?? NaN) * 1000).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full py-3 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] hover:bg-slate-100 transition-colors mt-6">
              View History
            </button>
          </div>

          {/* Budget/Project Detail — Stat Block Pattern */}
          <div className={`col-span-12 lg:col-span-5 row-span-2 bento-card p-10 flex flex-col justify-between ${
            activeStage === 'hackathon_ready' ? 'bg-slate-900 text-white border-slate-800' : ''
          }`}>
            <div className="flex justify-between items-start">
              <div>
                <h2 className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${
                  activeStage === 'hackathon_ready' ? 'text-blue-300' : 'text-slate-400'
                }`}>
                  {activeStage === 'hackathon_ready' ? 'Spotlight Project' : activeStage === 'budget_check' ? 'Grant Allocation' : 'Strategic Focus'}
                </h2>
                <p className="font-display font-medium italic opacity-70">
                  {activeStage === 'budget_check' ? 'Financial Roadmap' : 'Milestone Detail'}
                </p>
              </div>
              {activeStage === 'budget_check' && <div className="px-2 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded">FY2026 ACTIVE</div>}
            </div>

            <div className="mt-8">
              {activeStage === 'budget_check' ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-display font-bold text-dssg-blue tracking-tighter">
                      ${currentEngagement?.budget_amount?.toLocaleString() || '0.00'}
                    </span>
                    <span className="text-sm font-bold text-slate-300 uppercase tracking-widest">USD</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-grow h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-dssg-orange w-[75%] rounded-full shadow-sm shadow-orange-200" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-400">75% ALLOCATED</span>
                  </div>
                </div>
              ) : activeStage === 'hackathon_ready' ? (
                <div>
                  <p className="text-3xl font-display font-bold text-white mb-3 leading-tight">{currentEngagement?.hackathon_project || 'Define Solution Architecture'}</p>
                  <p className="text-sm text-blue-100/70 font-medium leading-relaxed">Co-developing diagnostic models for local supply chain efficiency.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-lg font-medium text-slate-700 leading-snug italic">
                    "{currentEngagement?.notes?.slice(0, 80) || 'Engagement documentation protocol active. Input milestones below.'}"
                  </p>
                  <div className="flex items-center gap-2 opacity-50">
                    <History size={14} className="text-dssg-blue" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Historical Context Logged</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Center (Bento: Large Square) */}
          <div className="col-span-12 lg:col-span-4 row-span-4 bento-card p-8 flex flex-col justify-between hover:border-blue-200 group">
             <div>
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-8">Stage Management</h2>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Add a note</p>
                    <textarea
                      className="w-full h-32 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-medium focus:ring-2 focus:ring-blue-100 outline-none resize-none"
                      placeholder="Add a note to this stage..."
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                    />
                  </div>
                  {notes.length > 0 && (
                    <ul className="space-y-2 max-h-40 overflow-y-auto">
                      {notes.map(n => (
                        <li key={n.id} className="text-xs text-slate-600 bg-slate-50 rounded-xl p-3">
                          <p className="whitespace-pre-wrap">{n.detail}</p>
                          <p className="text-[9px] text-slate-400 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
             </div>

             <button
              disabled={saving || !noteDraft.trim()}
              onClick={() => void addNote()}
              className="w-full py-4 bg-dssg-blue text-white rounded-2xl font-bold flex items-center justify-center gap-3 shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all font-display uppercase tracking-widest text-[11px]"
             >
               {saving ? <RefreshCcw className="animate-spin" size={18} /> : <Save size={18} />}
               Add Note
             </button>
          </div>

          {/* Account Management (Bento: Small Horizontal) */}
          <div className="col-span-12 lg:col-span-5 row-span-2 bento-card bg-emerald-50 border-emerald-100 p-8 flex items-center justify-between">
            <div>
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600 mb-4">Account Manager</h2>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-emerald-200 flex items-center justify-center font-bold text-emerald-800 text-sm">ER</div>
                <div>
                  <p className="font-bold text-slate-800">Elena Rodriguez</p>
                  <p className="text-[10px] text-emerald-700 font-medium">e.rodriguez@nyc-dssg.org</p>
                </div>
              </div>
            </div>
            <button className="px-6 py-3 bg-white text-emerald-600 border border-emerald-200 rounded-xl text-xs font-bold shadow-sm hover:shadow-md transition-all">
              Message Elena
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
