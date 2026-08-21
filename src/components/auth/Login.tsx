import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { motion } from 'motion/react';
import { Mail, Lock, LogIn, UserPlus, Globe, Eye } from 'lucide-react';

interface LoginProps {
  onDemoMode: () => void;
}

export default function Login({ onDemoMode }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // No profile write here. The public.users row is created by the on_auth_user_created
      // trigger (0008_user_provisioning.sql), so it cannot be skipped by a signup path that
      // forgets it — which is exactly how the Google flow used to miss it.
      const { error: authError } = isRegistering
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

      if (authError) throw authError;
    } catch (err: any) {
      setError(err?.message ?? 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      // Redirect flow, not a popup: Supabase OAuth is redirect-based, and the destination
      // must be on the project's allow-list (config.toml additional_redirect_urls locally;
      // Authentication -> URL Configuration on a hosted project).
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (oauthError) throw oauthError;
      // On success the browser navigates away, so `loading` is never cleared here.
    } catch (err: any) {
      setError(
        err?.message ??
          'Google sign-in failed. It must be enabled in the Supabase project (Authentication -> Providers).',
      );
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-4 bg-slate-50">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white border border-slate-100 rounded-2xl mb-4 shadow-xl shadow-slate-200/50 p-2">
            <img src="/logo.png" alt="DSSG NYC" className="w-full h-full object-contain" />
          </div>
          <h2 className="text-3xl font-display font-bold text-dssg-blue tracking-tight">
            {isRegistering ? 'Join the Mission' : 'Client Access'}
          </h2>
          <p className="text-slate-500 mt-2 text-sm font-medium">
            NYC's premier customer success portal
          </p>
        </div>

        <div className="space-y-4">
          <button 
            onClick={handleGoogleLogin}
            className="w-full py-3 px-4 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 hover:bg-slate-50 transition-all flex items-center justify-center gap-3 shadow-sm"
          >
            <Globe className="text-dssg-blue" size={18} />
            Continue with Google
          </button>
          
          <button 
            onClick={onDemoMode}
            className="w-full py-3 px-4 bg-dssg-blue text-white rounded-xl font-bold hover:bg-dssg-blue-light transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-900/10"
          >
            <Eye className="text-blue-300" size={18} />
            Enter Demo Mode
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
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
          <button 
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-colors"
          >
            {isRegistering ? 'Already have an account? Login' : "Request New Account Access"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
