import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured, setStoredUser, signInWithGoogle } from '../../lib/supabase';
import type { AppUser, AppRole } from '../../lib/supabase';
import { takeLoginNotice, type LoginIntent } from '../../lib/loginIntent';
import { motion } from 'motion/react';
import { Mail, Lock, Eye, Compass } from 'lucide-react';
import { GoogleLogo } from './GoogleLogo';

interface LoginProps {
  onDemoMode: () => void;
  onLoginSuccess?: (user: AppUser, role: AppRole) => void;
}

const TABS: { id: LoginIntent; label: string }[] = [
  { id: 'nonprofit', label: 'For Nonprofits' },
  { id: 'diplomat', label: 'For Data Diplomats' },
];

export default function Login({ onDemoMode, onLoginSuccess }: LoginProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<LoginIntent>('nonprofit');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  // A sign-in refused by App.tsx (for example, a non-team account on the Data Diplomats tab).
  const [error, setError] = useState(() => takeLoginNotice() ?? '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!isSupabaseConfigured) {
        // Safe local session when remote Supabase is not configured
        const cleanEmail = email.trim();
        const user: AppUser = {
          uid: `user-${Date.now()}`,
          email: cleanEmail,
          displayName: cleanEmail.split('@')[0],
        };
        setStoredUser(user, 'client', 'credentials');
        if (onLoginSuccess) {
          onLoginSuccess(user, 'client');
        }
        navigate('/dashboard');
        return;
      }

      // No profile write here. The public.users row is created by the on_auth_user_created
      // trigger (0008_user_provisioning.sql), so it cannot be skipped by a signup path that
      // forgets it — which is exactly how the Google flow used to miss it.
      const { error: authError } = isRegistering
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

      if (authError) throw authError;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  // Redirects to Google. The account is whichever one the person picks in Google's chooser.
  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle(tab);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
      setLoading(false);
    }
  };

  const isDiplomat = tab === 'diplomat';

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-4 bg-slate-50">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200"
      >
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white border border-slate-100 rounded-2xl mb-4 shadow-xl shadow-slate-200/50 p-2">
            <img src="/images/logo3.png" alt="DSSG NYC" className="w-full h-full object-contain" />
          </div>
          <h2 className="text-3xl font-display font-bold text-dssg-blue tracking-tight">
            {isRegistering ? 'Join the Mission' : 'Partner Portal'}
          </h2>
          <p className="text-slate-500 mt-2 text-xs font-medium">
            DSSG NYC's Success Portal for Partner Org and Project Managers
          </p>
        </div>

        <div role="tablist" aria-label="Who is signing in" className="grid grid-cols-2 gap-1 p-1 mb-6 bg-slate-100 rounded-xl">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`login-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls="login-panel"
              onClick={() => {
                setTab(item.id);
                setError('');
              }}
              className={`py-2.5 px-3 rounded-lg text-sm font-bold transition-all ${
                tab === item.id
                  ? 'bg-white text-dssg-blue shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div id="login-panel" role="tabpanel" aria-labelledby={`login-tab-${tab}`} className="space-y-4">
          {isDiplomat ? (
            <p className="text-sm text-slate-600 leading-relaxed">
              For DSSG and Data Diplomats team members. Sign in with your @datadiplomats.org Google
              account. Other email domains are turned away, and DSSG grants team access.
            </p>
          ) : (
            <p className="text-sm text-slate-600 leading-relaxed">
              For partner organizations. Sign in to track your engagement, or start with the
              first-time applicant survey.
            </p>
          )}

          <button
            onClick={handleGoogleLogin}
            type="button"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-white border-2 border-slate-200 hover:border-slate-300 rounded-xl font-bold text-slate-700 hover:bg-slate-50 active:scale-[0.99] transition-all flex items-center justify-center gap-3 shadow-sm group disabled:opacity-50"
          >
            <GoogleLogo className="w-5 h-5 group-hover:scale-105 transition-transform" />
            <span>{isDiplomat ? 'Sign in with Google' : 'Continue with Google'}</span>
          </button>

          {!isDiplomat && (
            <>
              <button
                onClick={onDemoMode}
                type="button"
                className="w-full py-3 px-4 bg-dssg-blue text-white rounded-xl font-bold hover:bg-dssg-blue-light transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-900/10"
              >
                <Eye className="text-blue-300" size={18} />
                Enter Demo Mode
              </button>

              <button
                onClick={() => navigate('/apply')}
                type="button"
                className="w-full py-3 px-4 bg-dssg-orange text-white rounded-xl font-bold hover:bg-dssg-orange-light transition-all flex items-center justify-center gap-3 shadow-lg shadow-orange-900/10"
              >
                <Compass size={18} />
                Get Started with First Time Applicant Survey
              </button>

              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-100"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-4 text-[10px] font-bold uppercase tracking-widest text-slate-300">Account Credentials</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-dssg-blue focus:border-transparent transition-all outline-none"
                      placeholder="name@business.com"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-dssg-blue focus:border-transparent transition-all outline-none"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-red-600 text-[11px] font-bold bg-red-50 p-4 rounded-xl border border-red-100 leading-relaxed"
                  >
                    {error}
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-dssg-orange text-white rounded-xl font-bold shadow-lg shadow-orange-900/10 hover:bg-dssg-orange-light active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    isRegistering ? 'Create Account' : 'Sign In'
                  )}
                </button>
              </form>
            </>
          )}

          {isDiplomat && error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-600 text-[11px] font-bold bg-red-50 p-4 rounded-xl border border-red-100 leading-relaxed"
            >
              {error}
            </motion.div>
          )}
        </div>

        {!isDiplomat && (
          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              type="button"
              className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-colors"
            >
              {isRegistering ? 'Already have an account? Login' : "Request New Account Access"}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
