import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import {
  onAuthChange,
  fetchRole,
  signOut,
  isSupabaseConfigured,
  getStoredUser,
  getStoredRole,
  getStoredProvider,
  setStoredUser,
} from "../lib/supabase";
import { LogOut, LayoutDashboard, Compass, ShieldCheck, Rocket, Building2 } from "lucide-react";
import { motion } from "motion/react";

// Components
import Login from "../components/auth/Login";
import { GoogleLogo } from "../components/auth/GoogleAuthModal";
import Dashboard from "../components/dashboard/Dashboard";
import BusinessPortal from "../components/business/BusinessPortal";
import ScoutIntakeForm from "../components/scout/ScoutIntakeForm";
import AdminReview from "../components/admin/AdminReview";
import ArchitectAssessment from "../components/architect/ArchitectAssessment";
import ArchitectPlan from "../components/architect/ArchitectPlan";
import OngoingProjects from "../components/architect/OngoingProjects";
import FirstTimeIntakeGate from "../components/onboarding/FirstTimeIntakeGate";
import NonprofitValidationGate from "../components/onboarding/NonprofitValidationGate";

import type { AppUser, AppRole } from "../lib/supabase";

function Navbar({
  user,
  isAdmin,
  isGoogle,
  onLogout,
}: {
  user: AppUser | null;
  isAdmin: boolean;
  isGoogle?: boolean;
  onLogout: () => void;
}) {
  return (
    <nav className="site-header">
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
                    e.currentTarget.style.display = "none";
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
                <span className="font-sans font-black text-2xl tracking-tighter text-dssg-blue uppercase">
                  DSSG
                </span>
                <span className="font-sans font-black text-2xl tracking-tighter text-dssg-orange italic uppercase">
                  NYC
                </span>
              </div>
            </div>
            <div className="hidden lg:flex flex-col -gap-0.5 border-l border-slate-100 pl-6">
              <span className="font-sans font-bold text-[10px] uppercase tracking-[0.3em] text-slate-300">
                Success Portal
              </span>
              <span className="font-display italic text-xs text-slate-400">
                Client Console
              </span>
            </div>
          </Link>
        </div>

        {user ? (
          <div className="flex items-center gap-8">
            <Link
              to="/dashboard"
              className="nav-link"
            >
              <LayoutDashboard size={14} />
              Overview
            </Link>
            <Link
              to="/onboarding"
              className="nav-link"
            >
              <Building2 size={14} />
              501(c)(3) Intake
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                className="nav-link"
              >
                <ShieldCheck size={14} />
                Admin Review
              </Link>
            )}
            {isAdmin && (
              <Link
                to="/projects"
                className="nav-link"
              >
                <Rocket size={14} />
                Ongoing Projects
              </Link>
            )}
            <Link
              to="/apply"
              className="nav-link"
            >
              <Compass size={14} />
              Apply
            </Link>
            <div className="h-6 w-px bg-slate-200" />
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">
                    {user.email}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider">
                    {isAdmin ? "DSSG Admin" : "Active Client"}
                  </span>
                  {isGoogle && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                      <GoogleLogo className="w-2.5 h-2.5" />
                      Google Verified
                    </span>
                  )}
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-dssg-blue font-bold text-sm relative shadow-sm">
                {user.email?.[0]?.toUpperCase() || "U"}
                {isGoogle && (
                  <div className="absolute -bottom-1 -right-1 bg-white p-0.5 rounded-full shadow-sm border border-slate-200">
                    <GoogleLogo className="w-3.5 h-3.5" />
                  </div>
                )}
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
            <Link
              to="/apply"
              className="nav-link"
            >
              <Compass size={14} />
              Apply
            </Link>
            <Link to="/login" className="btn-nav">
              Client Access
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}

export default function App() {
  const initialUser = getStoredUser();
  const [user, setUser] = useState<AppUser | null>(initialUser);
  const [isDemo, setIsDemo] = useState(false);
  const [role, setRole] = useState<AppRole | null>(
    getStoredRole() || (initialUser ? "admin" : null),
  );
  const [provider, setProvider] = useState<string | null>(getStoredProvider());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange(async (u) => {
      setUser(u);
      setRole(u ? await fetchRole() : null);
      setProvider(getStoredProvider());
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleDemoMode = () => {
    setIsDemo(true);
    setProvider("demo");
    const demoUser: AppUser = {
      uid: "demo-user-123",
      email: "demo@nyc-dssg.org",
      displayName: "Demo Account",
    };
    setUser(demoUser);
    setRole("admin");
    setStoredUser(demoUser, "admin", "demo");
  };

  const handleLoginSuccess = (loggedInUser: AppUser, userRole: AppRole = "admin") => {
    setIsDemo(false);
    setUser(loggedInUser);
    setRole(userRole);
    setProvider(getStoredProvider() || "google");
  };

  const handleLogout = () => {
    setIsDemo(false);
    setUser(null);
    setRole(null);
    setProvider(null);
    void signOut();
  };

  const isAdmin = role === "admin";
  const isGoogle =
    provider === "google" ||
    Boolean(user?.uid.startsWith("google-")) ||
    Boolean(user?.email?.includes("datadiplomats"));

  // In preview environment without live Supabase, render with in-memory seeded store
  const effectiveIsDemo = isDemo || !isSupabaseConfigured;

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
        {user && (
          <div
            className={`text-white text-[10px] font-bold uppercase tracking-[0.2em] py-1.5 text-center flex items-center justify-center gap-2 ${
              isGoogle ? "bg-blue-600" : "bg-amber-500"
            }`}
          >
            {isGoogle ? (
              <>
                <GoogleLogo className="w-3.5 h-3.5" />
                <span>
                  Google Authenticated ({user.email}) • DSSG NYC Partner Session
                </span>
              </>
            ) : (
              <span>Demo Mode Active • Live database writes are disabled</span>
            )}
          </div>
        )}
        <Navbar
          user={user}
          isAdmin={isAdmin}
          isGoogle={isGoogle}
          onLogout={handleLogout}
        />
        <main className="flex-grow">
          <Routes>
            <Route
              path="/login"
              element={
                user ? (
                  <Navigate to="/dashboard" />
                ) : (
                  <Login
                    onDemoMode={handleDemoMode}
                    onLoginSuccess={handleLoginSuccess}
                  />
                )
              }
            />
            <Route
              path="/dashboard"
              element={
                !user ? (
                  <Navigate to="/login" />
                ) : (
                  <FirstTimeIntakeGate user={user} isDemo={effectiveIsDemo}>
                    <Dashboard isDemo={effectiveIsDemo} />
                  </FirstTimeIntakeGate>
                )
              }
            />
            <Route
              path="/onboarding"
              element={
                user ? (
                  <NonprofitValidationGate
                    user={user}
                    isDemo={effectiveIsDemo}
                    onComplete={() => {
                      window.location.href = "/dashboard";
                    }}
                  />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/business/:id"
              element={
                user ? (
                  <BusinessPortal isDemo={effectiveIsDemo} />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/apply"
              element={<ScoutIntakeForm isDemo={effectiveIsDemo} />}
            />
            <Route
              path="/admin/:section?"
              element={
                user && isAdmin ? (
                  <AdminReview isDemo={effectiveIsDemo} />
                ) : (
                  <Navigate to={user ? "/dashboard" : "/login"} />
                )
              }
            />
            {/* Pre-2026-10-13 bookmarks: the two Scout screens are now tabs of Admin Review. */}
            <Route path="/scout/review" element={<Navigate to="/admin/applications" replace />} />
            <Route path="/scout/decisions" element={<Navigate to="/admin/applications" replace />} />
            <Route
              path="/projects"
              element={user && isAdmin ? <OngoingProjects isDemo={effectiveIsDemo} /> : <Navigate to={user ? "/dashboard" : "/login"} />}
            />
            <Route
              path="/architect/assess/:intakeId"
              element={
                user && isAdmin ? (
                  <ArchitectAssessment isDemo={effectiveIsDemo} />
                ) : (
                  <Navigate to={user ? "/dashboard" : "/login"} />
                )
              }
            />
            <Route
              path="/architect/plan/:intakeId"
              element={
                user && isAdmin ? (
                  <ArchitectPlan isDemo={effectiveIsDemo} />
                ) : (
                  <Navigate to={user ? "/dashboard" : "/login"} />
                )
              }
            />
            <Route
              path="/"
              element={<Navigate to={user ? "/dashboard" : "/login"} />}
            />
          </Routes>
        </main>

        <footer className="bg-dssg-blue text-white py-20 px-4 mt-auto">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-12">
            <div className="md:col-span-5">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-white text-dssg-blue rounded-xl flex items-center justify-center font-black italic">
                  DSSG
                </div>
                <span className="font-display font-bold text-2xl tracking-tight">
                  NYC DSSG
                </span>
              </div>
              <p className="text-blue-100 text-sm max-w-sm mb-8 leading-relaxed">
                Empowering small businesses and nonprofits across New York City
                through data-driven insights and strategic technological
                transformation.
              </p>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer" />
                <div className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer" />
                <div className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer" />
              </div>
            </div>

            <div className="md:col-span-7 grid grid-cols-2 md:grid-cols-3 gap-8">
              <div>
                <h5 className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300 mb-6">
                  Programs
                </h5>
                <ul className="space-y-4 text-sm font-medium text-blue-50">
                  <li className="hover:text-white cursor-pointer transition-colors">
                    Grant Projects
                  </li>
                  <li className="hover:text-white cursor-pointer transition-colors">
                    NYC Hackathons
                  </li>
                  <li className="hover:text-white cursor-pointer transition-colors">
                    Data Fellows
                  </li>
                </ul>
              </div>
              <div>
                <h5 className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300 mb-6">
                  Resources
                </h5>
                <ul className="space-y-4 text-sm font-medium text-blue-50">
                  <li className="hover:text-white cursor-pointer transition-colors">
                    Client Portal
                  </li>
                  <li className="hover:text-white cursor-pointer transition-colors">
                    Partner Docs
                  </li>
                  <li className="hover:text-white cursor-pointer transition-colors">
                    Open Data
                  </li>
                </ul>
              </div>
              <div className="col-span-2 md:col-span-1">
                <h5 className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300 mb-6">
                  DSSG Local
                </h5>
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
              <a href="#" className="hover:text-white">
                Privacy Policy
              </a>
              <a href="#" className="hover:text-white">
                Terms of Service
              </a>
            </div>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
