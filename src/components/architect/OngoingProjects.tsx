import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { ArchitectAssessment } from '../../types';
import { demoAssessments } from '../../lib/demoStore';
import { businessIdForAssessment } from '../../lib/graduation';
import {
  Rocket, Building2, CalendarRange, FileText, ArrowRight, UserSquare2,
} from 'lucide-react';

interface Props {
  isDemo?: boolean;
}

const COMPOSITE_COLOR: Record<string, string> = {
  Foundational: 'bg-rose-50 text-rose-600 border-rose-100',
  Developing: 'bg-amber-50 text-amber-600 border-amber-100',
  Established: 'bg-emerald-50 text-emerald-600 border-emerald-100',
};

export default function OngoingProjects({ isDemo }: Props) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ArchitectAssessment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isDemo) {
      setProjects(Array.from(demoAssessments.values()));
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(collection(db, 'architectAssessments'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ArchitectAssessment));
      setProjects(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'architectAssessments');
    });

    return unsubscribe;
  }, [isDemo]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-bold uppercase tracking-widest mb-4">
          <Rocket size={12} />
          Ongoing Projects
        </div>
        <h1 className="text-4xl font-display font-bold text-dssg-blue tracking-tight leading-[1.1]">
          Active <span className="italic">Engagements</span>
        </h1>
        <p className="text-slate-500 font-medium mt-3 max-w-2xl">
          Organizations that have graduated from Architect assessment with a shipped charter and 90-day plan.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-48 bg-slate-100 rounded-2xl animate-pulse" />
          <div className="h-48 bg-slate-100 rounded-2xl animate-pulse" />
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-16 text-center shadow-sm">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Rocket size={40} className="text-slate-300" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900">No ongoing projects yet</h3>
          <p className="text-slate-500 mt-2 max-w-sm mx-auto">
            Once an organization completes Architect assessment and receives a charter and 90-day plan, it'll show up here.
          </p>
          <button onClick={() => navigate('/scout/review')} className="mt-8 btn-primary">
            Go to Review Queue
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {projects.map(project => (
            <div
              key={project.id}
              onClick={() => navigate(`/architect/plan/${project.id}`)}
              className="bento-card p-8 flex flex-col gap-5 cursor-pointer hover:border-dssg-blue transition-all group"
            >
              <div className="flex justify-between items-start gap-4">
                <div>
                  <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <Building2 size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{project.scoutBucket}</span>
                  </div>
                  <h3 className="text-xl font-display font-bold text-dssg-blue leading-tight">{project.org_name}</h3>
                </div>
                <span className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border shrink-0 ${COMPOSITE_COLOR[project.compositeLevel]}`}>
                  {project.compositeLevel}
                </span>
              </div>

              <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">
                {project.ninetyDayPlan?.headline}
              </p>

              <div className="flex items-center gap-4 pt-4 border-t border-slate-50">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <CalendarRange size={13} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">{project.points}/21 pts</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <FileText size={13} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">{project.ninetyDayPlan?.shape.replace(/_/g, ' ')}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/business/${businessIdForAssessment(project.id)}`); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-blue-50 hover:text-dssg-blue border border-slate-100 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-all"
                >
                  <UserSquare2 size={13} /> Client Account
                </button>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-dssg-blue transition-colors">
                  90-Day Plan <ArrowRight size={14} className="group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
