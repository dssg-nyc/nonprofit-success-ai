import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Shield, User, ArrowRight, X } from 'lucide-react';
import type { AppUser, AppRole } from '../../lib/supabase';
import { setStoredUser } from '../../lib/supabase';

interface GoogleAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: AppUser, role: AppRole) => void;
  defaultEmail?: string;
}

export function GoogleLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export default function GoogleAuthModal({
  isOpen,
  onClose,
  onSuccess,
  defaultEmail = 'jyr@datadiplomats.org',
}: GoogleAuthModalProps) {
  const [selectedAccount, setSelectedAccount] = useState<'primary' | 'custom'>('primary');
  const [customEmail, setCustomEmail] = useState('');
  const [customName, setCustomName] = useState('');
  const [role, setRole] = useState<AppRole>('admin');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authStep, setAuthStep] = useState<'select' | 'verifying' | 'success'>('select');

  if (!isOpen) return null;

  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setAuthStep('verifying');

    // Simulate OAuth handshake, state token exchange, and profile verification
    await new Promise((resolve) => setTimeout(resolve, 600));

    const email = selectedAccount === 'primary' ? defaultEmail : (customEmail.trim() || defaultEmail);
    const displayName = selectedAccount === 'primary' 
      ? 'JYR (Data Diplomats)' 
      : (customName.trim() || email.split('@')[0]);

    const user: AppUser = {
      uid: `google-${Date.now()}`,
      email,
      displayName,
    };

    setAuthStep('success');
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Persist session
    setStoredUser(user, role, 'google');
    setIsAuthenticating(false);
    onSuccess(user, role);
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden"
        >
          {/* Google Header */}
          <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GoogleLogo className="w-6 h-6" />
              <div>
                <h3 className="font-sans font-bold text-base text-slate-800">
                  Sign in with Google
                </h3>
                <p className="text-[11px] text-slate-400">
                  Choose an account to continue to DSSG NYC
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isAuthenticating}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {authStep === 'verifying' ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="relative">
                  <div className="w-14 h-14 rounded-full border-4 border-blue-100 border-t-dssg-blue animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <GoogleLogo className="w-6 h-6" />
                  </div>
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">Connecting with Google</h4>
                  <p className="text-xs text-slate-500 mt-1">Verifying Google OAuth token & permissions...</p>
                </div>
              </div>
            ) : authStep === 'success' ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <Check size={28} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">Authentication Verified</h4>
                  <p className="text-xs text-emerald-600 font-medium mt-1">Access granted to DSSG NYC Portal</p>
                </div>
              </div>
            ) : (
              <>
                {/* Account Selection */}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    Accounts Detected
                  </label>

                  {/* Primary Account Option */}
                  <div
                    onClick={() => setSelectedAccount('primary')}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                      selectedAccount === 'primary'
                        ? 'border-dssg-blue bg-blue-50/60 ring-2 ring-dssg-blue/20'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold flex items-center justify-center shadow-sm">
                        {defaultEmail[0]?.toUpperCase() || 'J'}
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-800">
                            JYR (Data Diplomats)
                          </span>
                          <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                            Current
                          </span>
                        </div>
                        <span className="text-xs text-slate-500 font-medium">
                          {defaultEmail}
                        </span>
                      </div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                        selectedAccount === 'primary'
                          ? 'border-dssg-blue bg-dssg-blue text-white'
                          : 'border-slate-300'
                      }`}
                    >
                      {selectedAccount === 'primary' && <Check size={12} />}
                    </div>
                  </div>

                  {/* Custom Account Option */}
                  <div
                    onClick={() => setSelectedAccount('custom')}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      selectedAccount === 'custom'
                        ? 'border-dssg-blue bg-blue-50/60 ring-2 ring-dssg-blue/20'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-bold flex items-center justify-center">
                          <User size={18} />
                        </div>
                        <div className="text-left">
                          <span className="text-xs font-bold text-slate-800">
                            Use another Google account
                          </span>
                          <p className="text-[11px] text-slate-400">
                            Test with any @gmail.com or Workspace email
                          </p>
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          selectedAccount === 'custom'
                            ? 'border-dssg-blue bg-dssg-blue text-white'
                            : 'border-slate-300'
                        }`}
                      >
                        {selectedAccount === 'custom' && <Check size={12} />}
                      </div>
                    </div>

                    {selectedAccount === 'custom' && (
                      <div className="mt-3 pt-3 border-t border-blue-100 space-y-2">
                        <input
                          type="email"
                          placeholder="your.name@gmail.com"
                          value={customEmail}
                          onChange={(e) => setCustomEmail(e.target.value)}
                          className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <input
                          type="text"
                          placeholder="Your Name (optional)"
                          value={customName}
                          onChange={(e) => setCustomName(e.target.value)}
                          className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Role Choice */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    Portal Access Role
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole('admin')}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all text-left ${
                        role === 'admin'
                          ? 'border-dssg-blue bg-dssg-blue text-white shadow-sm'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div>DSSG Admin</div>
                      <div className={`text-[10px] font-normal ${role === 'admin' ? 'text-blue-100' : 'text-slate-400'}`}>
                        Review Queue & Projects
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('client')}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all text-left ${
                        role === 'client'
                          ? 'border-dssg-blue bg-dssg-blue text-white shadow-sm'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div>Active Client</div>
                      <div className={`text-[10px] font-normal ${role === 'client' ? 'text-blue-100' : 'text-slate-400'}`}>
                        Partner Org Portal
                      </div>
                    </button>
                  </div>
                </div>

                {/* Security and Consent Notice */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-start gap-2.5">
                  <Shield size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    By signing in, Google will verify your identity and share your name, email, and basic profile info with DSSG NYC.
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-1/3 py-3 px-4 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSignIn}
                    className="w-2/3 py-3 px-4 bg-dssg-blue text-white rounded-xl text-xs font-bold hover:bg-dssg-blue-light transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/10"
                  >
                    <GoogleLogo className="w-4 h-4" />
                    <span>
                      Continue as {selectedAccount === 'primary' ? 'JYR' : customEmail.split('@')[0] || 'User'}
                    </span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
