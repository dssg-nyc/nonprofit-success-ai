import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import { motion } from "motion/react";

// Components
import Login from "../components/auth/Login";
import { GoogleLogo } from "../components/auth/GoogleLogo";
import { admitSignIn, clearLoginIntent, readLoginIntent, setLoginNotice } from "../lib/loginIntent";
import Dashboard from "../components/dashboard/Dashboard";
import BusinessPortal from "../components/business/BusinessPortal";
import ScoutIntakeForm from "../components/scout/ScoutIntakeForm";
import AdminReview from "../components/admin/AdminReview";
import ArchitectAssessment from "../components/architect/ArchitectAssessment";
import ArchitectPlan from "../components/architect/ArchitectPlan";
import OngoingProjects from "../components/architect/OngoingProjects";
import FirstTimeIntakeGate from "../components/onboarding/FirstTimeIntakeGate";
import NonprofitValidationGate from "../components/onboarding/NonprofitValidationGate";
import SiteHeader from "../components/layout/SiteHeader";
import SiteFooter from "../components/layout/SiteFooter";

import type { AppUser, AppRole } from "../lib/supabase";

export default function App() {
  const initialUser = getStoredUser();
  const [user, setUser] = useState<AppUser | null>(initialUser);
  const [isDemo, setIsDemo] = useState(false);
  const [role, setRole] = useState<AppRole | null>(getStoredRole());
  const [provider, setProvider] = useState<string | null>(getStoredProvider());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange(async (u) => {
      // The Google redirect lands here with a session. Check the tab the person chose
      // against the profile role before letting the session in. The initial callback has
      // no session, so the intent is kept until a session actually arrives.
      if (u) {
        const nextRole = await fetchRole();
        const verdict = admitSignIn(readLoginIntent(), nextRole, u.email);
        clearLoginIntent();
        if (!verdict.allowed) {
          setLoginNotice(verdict.notice ?? "Sign-in was refused.");
          void signOut();
          setUser(null);
          setRole(null);
          setProvider(null);
          setLoading(false);
          return;
        }
        setUser(u);
        setRole(nextRole);
      } else {
        setUser(null);
        setRole(null);
      }
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
  // Only a session Supabase issued through Google counts as Google-verified.
  const isGoogle = provider === "google" || user?.provider === "google";

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
        <SiteHeader
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
                ) : isAdmin ? (
                  // Staff are not applicants: the 501(c)(3) check is the IRS registry block on
                  // each application in Admin Review, filed server-side with the Scout intake.
                  <Dashboard isDemo={effectiveIsDemo} />
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

        <SiteFooter />
      </div>
    </BrowserRouter>
  );
}
