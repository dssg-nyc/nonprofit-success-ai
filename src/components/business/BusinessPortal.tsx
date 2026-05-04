import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, setDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { Business, Engagement, EngagementStage, EngagementStatus } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  History, 
  DollarSign, 
  PlayCircle, 
  Code2, 
  CheckCircle, 
  ChevronLeft, 
  RefreshCcw,
  Calendar,
  Save,
  Clock,
  ExternalLink,
  Building2
} from 'lucide-react';

const STAGES: { id: EngagementStage; label: string; icon: any; color: string }[] = [
  { id: 'initial_meeting', label: 'Initial Meeting', icon: History, color: 'text-blue-600 bg-blue-100' },
  { id: 'budgeting', label: 'Budgeting', icon: DollarSign, color: 'text-emerald-600 bg-emerald-100' },
  { id: 'engagement_tracking', label: 'Engagement Tracking', icon: PlayCircle, color: 'text-amber-600 bg-amber-100' },
  { id: 'hackathon', label: 'DSSG Hackathon', icon: Code2, color: 'text-indigo-600 bg-indigo-100' },
  { id: 'membership_close', label: 'Membership Close', icon: CheckCircle, color: 'text-purple-600 bg-purple-100' },
];

export default function BusinessPortal({ isDemo }: { isDemo?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [business, setBusiness] = useState<Business | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [activeStage, setActiveStage] = useState<EngagementStage>('initial_meeting');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
          stage: 'budgeting',
          status: 'in_progress',
          budget_amount: 12500,
          updatedAt: { seconds: Date.now() / 1000 }
        }
      ]);
      setActiveStage('budgeting');
      setLoading(false);
      return;
    }

    if (!id || !auth.currentUser) return;

    // Fetch Business
    const fetchBusiness = async () => {
      try {
        const d = await getDoc(doc(db, 'businesses', id));
        if (d.exists()) {
          setBusiness({ id: d.id, ...d.data() } as Business);
        } else {
          navigate('/dashboard');
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `businesses/${id}`);
      }
    };

    fetchBusiness();

    // Listen to Engagements
    const q = query(
      collection(db, 'engagements'),
      where('businessId', '==', id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Engagement));
      setEngagements(data);
      
      // If we have engagements, set the latest one as active by default or the first one
      if (data.length > 0) {
        // Find most recent or in_progress stage
        const inProgress = data.find(e => e.status === 'in_progress');
        if (inProgress) setActiveStage(inProgress.stage);
        else setActiveStage(data[data.length - 1].stage);
      }
      
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'engagements');
    });

    return unsubscribe;
  }, [id]);

  const getCurrentEngagement = () => engagements.find(e => e.stage === activeStage);

  const updateStage = async (status: EngagementStatus, extraData: Partial<Engagement> = {}) => {
    if (isDemo) {
      setEngagements(prev => {
        const existing = prev.find(e => e.stage === activeStage);
        if (existing) {
          return prev.map(e => e.id === existing.id ? { ...e, ...extraData, status, updatedAt: { seconds: Date.now() / 1000 } } : e);
        }
        return [...prev, {
          id: `demo-${activeStage}`,
          businessId: id!,
          ownerId: 'demo-user-123',
          stage: activeStage,
          status,
          updatedAt: { seconds: Date.now() / 1000 },
          ...extraData
        }];
      });
      return;
    }

    if (!id || !auth.currentUser) return;
    setSaving(true);
    
    const existing = getCurrentEngagement();
    
    try {
      if (existing) {
        await updateDoc(doc(db, 'engagements', existing.id), {
          ...extraData,
          status,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Create new engagement record for this stage
        const engagementId = `${id}_${activeStage}`;
        await setDoc(doc(db, 'engagements', engagementId), {
          businessId: id,
          ownerId: auth.currentUser.uid,
          stage: activeStage,
          status,
          updatedAt: serverTimestamp(),
          ...extraData
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'engagements');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center">Loading portal...</div>;
  if (!business) return null;

  const currentEngagement = getCurrentEngagement();

  return (
    <div className="bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <button 
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-slate-500 hover:text-dssg-blue transition-colors font-bold text-sm uppercase tracking-wider"
          >
            <ChevronLeft size={16} />
            Back to Overview
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Active Project Portal</span>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Bento Grid Layout */}
        <div className="grid grid-cols-12 grid-rows-6 gap-6 h-auto lg:h-[900px]">
          
          {/* Profile Card (Bento: Small Square/Rectangle) */}
          <div className="col-span-12 lg:col-span-4 row-span-2 bento-card bg-slate-900 text-white p-8 relative overflow-hidden">
            <div className="relative z-10">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-6">Business Profile</h2>
              <p className="text-sm font-light text-slate-300">Certified {business.type === 'nonprofit' ? 'Nonprofit' : 'Small Business'}</p>
              <h1 className="text-3xl font-bold mt-1 mb-8">{business.name}</h1>
              
              <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-500">Industry</span>
                  <span className="font-medium">{business.industry || 'N/A'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-500">Joined</span>
                  <span className="font-medium">{new Date(business.createdAt?.seconds * 1000).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
            <div className="absolute -right-6 -bottom-6 opacity-10">
              <Building2 size={160} />
            </div>
          </div>

          {/* Workflow Status (Bento: Large Horizontal) */}
          <div className="col-span-12 lg:col-span-8 row-span-2 bento-card p-8 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Onboarding Roadmap</h2>
              <span className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                currentEngagement?.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                currentEngagement?.status === 'in_progress' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                'bg-slate-50 text-slate-400 border border-slate-100'
              }`}>
                Current: {STAGES.find(s => s.id === activeStage)?.label}
              </span>
            </div>

            <div className="flex items-center justify-between px-4">
              {STAGES.map((s, idx) => {
                const stageData = engagements.find(e => e.stage === s.id);
                const isCompleted = stageData?.status === 'completed';
                const isActive = activeStage === s.id;
                
                return (
                  <div key={s.id} className="flex flex-col items-center gap-3 relative z-10 group cursor-pointer" onClick={() => setActiveStage(s.id)}>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
                      isCompleted ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' :
                      isActive ? 'bg-white border-4 border-blue-50 ring-2 ring-blue-600 text-blue-600' :
                      'bg-slate-50 text-slate-300'
                    }`}>
                      {isCompleted ? <CheckCircle size={24} /> : <span className="font-bold text-sm">0{idx + 1}</span>}
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-blue-600' : 'text-slate-400'}`}>
                      {s.id.split('_')[0]}
                    </span>
                  </div>
                );
              })}
              {/* Connector Line Base */}
              <div className="absolute left-[30%] right-[10%] top-[45%] h-0.5 bg-slate-100 -z-0 hidden lg:block" />
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
                    <p className="text-[10px] text-slate-400 font-medium">{e.status} • {new Date(e.updatedAt?.seconds * 1000).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full py-3 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] hover:bg-slate-100 transition-colors mt-6">
              View History
            </button>
          </div>

          {/* Budget/Project Detail (Bento: Square/Contextual) */}
          <div className={`col-span-12 lg:col-span-5 row-span-2 bento-card p-8 flex flex-col justify-between ${activeStage === 'hackathon' ? 'bg-indigo-600 text-white border-indigo-500' : ''}`}>
            <div className="flex justify-between items-center">
              <h2 className={`text-[10px] font-bold uppercase tracking-[0.2em] ${activeStage === 'hackathon' ? 'text-indigo-200' : 'text-slate-400'}`}>
                {activeStage === 'hackathon' ? 'Hackathon Spotlight' : activeStage === 'budgeting' ? 'Budget Summary' : 'Current Stage Focus'}
              </h2>
              {activeStage === 'budgeting' && <span className="text-[10px] font-mono text-slate-400">FY2026</span>}
            </div>

            <div className="mt-4">
              {activeStage === 'budgeting' ? (
                <div className="flex items-end gap-6">
                  <div>
                    <p className="text-4xl font-bold font-mono tracking-tighter">${currentEngagement?.budget_amount?.toLocaleString() || '0.00'}</p>
                    <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-wider">DSSG Allocation Grant</p>
                  </div>
                  <div className="flex-grow h-12 flex items-end gap-1 pb-1">
                    <div className="flex-1 bg-blue-100 h-1/2 rounded-t" />
                    <div className="flex-1 bg-blue-200 h-3/4 rounded-t" />
                    <div className="flex-1 bg-blue-600 h-full rounded-t" />
                    <div className="flex-1 bg-slate-100 h-1/3 rounded-t" />
                  </div>
                </div>
              ) : activeStage === 'hackathon' ? (
                <div>
                  <p className="text-2xl font-bold tracking-tight mb-2">{currentEngagement?.hackathon_project || 'Define Project'}</p>
                  <p className="text-sm text-indigo-100 font-medium">Prepare your datasets for the sprint. You are focusing on "Local Commerce Integration".</p>
                </div>
              ) : (
                <div className="flex items-center gap-4 py-4">
                  <div className="p-4 bg-blue-50 rounded-2xl text-blue-600">
                    <History size={32} />
                  </div>
                  <p className="text-sm font-medium text-slate-600">
                    {currentEngagement?.notes?.slice(0, 80) || 'No active notes for this stage. Select an action below to update.'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Action Center (Bento: Large Square) */}
          <div className="col-span-12 lg:col-span-4 row-span-4 bento-card p-8 flex flex-col justify-between hover:border-blue-200 group">
             <div>
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-8">Stage Management</h2>
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:text-blue-600 group-hover:bg-blue-50 transition-colors">
                      <RefreshCcw size={20} />
                    </div>
                    <div className="flex-grow">
                      <p className="text-xs font-bold text-slate-700">Project Status</p>
                      <div className="flex gap-2 mt-2">
                         <button 
                          onClick={() => updateStage('in_progress')}
                          className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                            currentEngagement?.status === 'in_progress' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                         >
                           In Progress
                         </button>
                         <button 
                          onClick={() => updateStage('completed')}
                          className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                            currentEngagement?.status === 'completed' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                         >
                           Complete
                         </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Stage Log</p>
                    <textarea 
                      className="w-full h-32 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-medium focus:ring-2 focus:ring-blue-100 outline-none resize-none"
                      placeholder="Add milestone notes..."
                      value={currentEngagement?.notes || ''}
                      onChange={(e) => updateStage(currentEngagement?.status || 'pending', { notes: e.target.value })}
                    />
                  </div>
                </div>
             </div>

             <button 
              disabled={saving}
              className="w-full py-4 bg-dssg-blue text-white rounded-2xl font-bold flex items-center justify-center gap-3 shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all font-display uppercase tracking-widest text-[11px]"
             >
               {saving ? <RefreshCcw className="animate-spin" size={18} /> : <Save size={18} />}
               Save Lifecycle State
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
