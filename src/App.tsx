import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { LogOut, User as UserIcon, LayoutDashboard, Building2, Layers, Compass, ClipboardList } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Components
import Login from './components/auth/Login';
import Dashboard from './components/dashboard/Dashboard';
import BusinessPortal from './components/business/BusinessPortal';
import ScoutIntakeForm from './components/scout/ScoutIntakeForm';
import ScoutReviewQueue from './components/scout/ScoutReviewQueue';

function Navbar({ user, isAdmin, onLogout }: { user: any, isAdmin: boolean, onLogout: () => void }) {
  return (
    <nav className="h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-6 group">
            <div className="flex items-center gap-3">
              {/* Logo Icon Pattern */}
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center p-1.5 shadow-sm border border-slate-100 group-hover:shadow-md transition-all">
                <img 
                  src="/logo.png" 
                  alt="DSSG" 
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement!.innerHTML = `
                      <div class="flex flex-col items-center justify-center -space-y-1">
                        <div class="text-[14px] font-black italic text-dssg-blue">DS</div>
                        <div class="text-[8px] font-bold text-dssg-orange">NYC</div>
                      </div>
                    `;
                  }}
                />
              </div>
              {/* Brand Typography Pattern */}
              <div className="flex bg-white px-2 py-1 items-center gap-2">
                <span className="font-sans font-black text-2xl tracking-tighter text-dssg-blue uppercase">DSSG</span>
                <span className="font-sans font-black text-2xl tracking-tighter text-dssg-orange italic uppercase">NYC</span>
              </div>
            </div>
            <div className="hidden lg:flex flex-col -gap-0.5 border-l border-slate-100 pl-6">
              <span className="font-sans font-bold text-[10px] uppercase tracking-[0.3em] text-slate-300">Success Portal</span>
              <span className="font-display italic text-xs text-slate-400">Client Console</span>
            </div>
          </Link>
        </div>
        
        {user ? (
          <div className="flex items-center gap-8">
            <Link to="/dashboard" className="text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-dssg-blue transition-colors flex items-center gap-2">
              <LayoutDashboard size={14} />
              Overview
            </Link>
            {isAdmin && (
              <Link to="/scout/review" className="text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-dssg-blue transition-colors flex items-center gap-2">
                <ClipboardList size={14} />
                Review Queue
              </Link>
            )}
            <Link to="/apply" className="text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-dssg-blue transition-colors flex items-center gap-2">
              <Compass size={14} />
              Apply
            </Link>
            <div className="h-6 w-px bg-slate-200" />
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-sm font-bold text-slate-800">{user.email?.split('@')[0]}</span>
                <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider">Active Client</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-dssg-blue font-bold text-sm">
                {user.email?.[0] || 'U'}
              </div>
              <button 
                onClick={onLogout}
                className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                title="Logout"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-6">
            <Link to="/apply" className="text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-dssg-blue transition-colors flex items-center gap-2">
              <Compass size={14} />
              Apply
            </Link>
            <Link
              to="/login"
              className="btn-primary flex items-center gap-2"
            >
              Client Access
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [role, setRole] = useState<'client' | 'admin' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (isDemo) return;
      setUser(u);
      if (u) {
        try {
          const profile = await getDoc(doc(db, 'users', u.uid));
          setRole(profile.exists() ? profile.data().role : null);
        } catch (err) {
          setRole(null);
          try {
            handleFirestoreError(err, OperationType.GET, `users/${u.uid}`);
          } catch {
            // handleFirestoreError logs then rethrows by design; swallowed here
            // so a profile-fetch failure doesn't strand the app on the loading spinner.
          }
        }
      } else {
        setRole(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [isDemo]);

  const handleDemoMode = () => {
    setIsDemo(true);
    setUser({
      uid: 'demo-user-123',
      email: 'demo@nyc-dssg.org',
      displayName: 'Demo Account'
    });
    // Demo Mode intentionally grants admin so the Scout Review Queue is
    // demoable without a real Firebase project + manual role promotion.
    setRole('admin');
  };

  const handleLogout = () => {
    if (isDemo) {
      setIsDemo(false);
      setUser(null);
      setRole(null);
    } else {
      signOut(auth);
    }
  };

  const isAdmin = role === 'admin';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-base">
        <motion.div 
          animate={{ scale: [1, 1.1, 1], rotate: [0, 90, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="w-12 h-12 bg-dssg-blue rounded-xl"
        />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        {user && isDemo && (
          <div className="bg-amber-500 text-white text-[10px] font-bold uppercase tracking-[0.2em] py-1.5 text-center">
            Demo Mode Active • Live database writes are disabled
          </div>
        )}
        <Navbar user={user} isAdmin={isAdmin} onLogout={handleLogout} />
        <main className="flex-grow">
          <Routes>
            <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login onDemoMode={handleDemoMode} />} />
            <Route
              path="/dashboard"
              element={user ? <Dashboard isDemo={isDemo} /> : <Navigate to="/login" />}
            />
            <Route
              path="/business/:id"
              element={user ? <BusinessPortal isDemo={isDemo} /> : <Navigate to="/login" />}
            />
            <Route path="/apply" element={<ScoutIntakeForm isDemo={isDemo} />} />
            <Route
              path="/scout/review"
              element={user && isAdmin ? <ScoutReviewQueue isDemo={isDemo} /> : <Navigate to={user ? "/dashboard" : "/login"} />}
            />
            <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} />} />
          </Routes>
        </main>
        
        <footer className="bg-dssg-blue text-white py-20 px-4 mt-auto">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-12">
            <div className="md:col-span-5">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-white text-dssg-blue rounded-xl flex items-center justify-center font-black italic">DSSG</div>
                <span className="font-display font-bold text-2xl tracking-tight">NYC DSSG</span>
              </div>
              <p className="text-blue-100 text-sm max-w-sm mb-8 leading-relaxed">
                Empowering small businesses and nonprofits across New York City through data-driven insights and strategic technological transformation.
              </p>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer" />
                <div className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer" />
                <div className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer" />
              </div>
            </div>
            
            <div className="md:col-span-7 grid grid-cols-2 md:grid-cols-3 gap-8">
              <div>
                <h5 className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300 mb-6">Programs</h5>
                <ul className="space-y-4 text-sm font-medium text-blue-50">
                  <li className="hover:text-white cursor-pointer transition-colors">Grant Projects</li>
                  <li className="hover:text-white cursor-pointer transition-colors">NYC Hackathons</li>
                  <li className="hover:text-white cursor-pointer transition-colors">Data Fellows</li>
                </ul>
              </div>
              <div>
                <h5 className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300 mb-6">Resources</h5>
                <ul className="space-y-4 text-sm font-medium text-blue-50">
                  <li className="hover:text-white cursor-pointer transition-colors">Client Portal</li>
                  <li className="hover:text-white cursor-pointer transition-colors">Partner Docs</li>
                  <li className="hover:text-white cursor-pointer transition-colors">Open Data</li>
                </ul>
              </div>
              <div className="col-span-2 md:col-span-1">
                <h5 className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300 mb-6">DSSG Local</h5>
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                  <p className="text-[10px] font-bold leading-relaxed text-blue-200">
                    JOIN THE NETWORK OF 250+ NYC BASED VOLUNTEERS
                  </p>
                  <button className="mt-3 text-xs font-bold text-white hover:text-dssg-orange transition-colors">
                    Learn more →
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-[10px] font-bold text-blue-300 tracking-widest uppercase">
              © 2026 DATA SCIENCE FOR SOCIAL GOOD NEW YORK CITY
            </p>
            <div className="flex gap-8 text-[10px] font-bold uppercase tracking-widest text-blue-300">
              <a href="#" className="hover:text-white">Privacy Policy</a>
              <a href="#" className="hover:text-white">Terms of Service</a>
            </div>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
