import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import { LogOut, User as UserIcon, LayoutDashboard, Building2, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Components
import Login from './components/auth/Login';
import Dashboard from './components/dashboard/Dashboard';
import BusinessPortal from './components/business/BusinessPortal';

function Navbar({ user, onLogout }: { user: any, onLogout: () => void }) {
  return (
    <nav className="h-16 bg-white border-b border-border-mute sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-8 h-8 bg-dssg-blue rounded flex items-center justify-center text-white font-bold text-xs italic">DSSG</div>
            <span className="font-bold tracking-tight text-xl text-slate-800">NYC-DSSG <span className="text-dssg-blue">Portal</span></span>
          </Link>
        </div>
        
        {user ? (
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="text-sm font-semibold text-slate-600 hover:text-dssg-blue transition-colors flex items-center gap-2">
              <LayoutDashboard size={18} />
              Dashboard
            </Link>
            <div className="h-6 w-px bg-border-mute" />
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-sm font-semibold">{user.email?.split('@')[0]}</span>
                <span className="text-[10px] text-slate-500 italic font-medium">Verified User</span>
              </div>
              <div className="w-9 h-9 rounded-full bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center text-dssg-blue font-bold text-sm uppercase">
                {user.email?.[0] || 'U'}
              </div>
              <button 
                onClick={onLogout}
                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                title="Logout"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        ) : (
          <Link 
            to="/login" 
            className="px-5 py-2 bg-dssg-blue text-white rounded-lg text-sm font-bold shadow-md shadow-blue-100 hover:bg-blue-700 transition-all"
          >
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (!isDemo) setUser(u);
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
  };

  const handleLogout = () => {
    if (isDemo) {
      setIsDemo(false);
      setUser(null);
    } else {
      signOut(auth);
    }
  };

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
        <Navbar user={user} onLogout={handleLogout} />
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
            <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} />} />
          </Routes>
        </main>
        
        <footer className="bg-white border-t border-border-mute py-8">
          <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2 opacity-50">
              <span className="font-display italic text-lg uppercase tracking-tight">NYC DSSG</span>
              <span className="text-xs font-mono">© 2026 Success Portal</span>
            </div>
            <div className="flex gap-6 text-[10px] uppercase tracking-widest font-semibold text-gray-400">
              <a href="#" className="hover:text-dssg-blue">Privacy</a>
              <a href="#" className="hover:text-dssg-blue">Terms</a>
              <a href="#" className="hover:text-dssg-blue">Support</a>
            </div>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
