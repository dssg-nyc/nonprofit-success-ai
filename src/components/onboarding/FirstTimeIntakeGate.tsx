import { useEffect, useState, type ReactNode } from 'react';
import type { AppUser } from '../../lib/supabase';
import NonprofitValidationGate from './NonprofitValidationGate';

const gateKey = (uid: string) => `dssg_intake_gate_cleared_${uid}`;

interface FirstTimeIntakeGateProps {
  user?: AppUser | null;
  isDemo?: boolean;
  children: ReactNode;
}

/**
 * Post-Authentication Onboarding Gate:
 * Immediately after account creation (Google or credentials), intercepts
 * the user with the 501(c)(3) nonprofit validation stage.
 * If 501(c)(3) registered, pulls ProPublica IRS filing records to auto-fill the profile.
 * If non-501(c)(3), scrapes the website to extract mission & category.
 * Generates structured Salesforce Lead & Agentforce AI CRM records before granting access.
 */
export default function FirstTimeIntakeGate({
  user,
  isDemo,
  children,
}: FirstTimeIntakeGateProps) {
  const [status, setStatus] = useState<'checking' | 'needs-validation' | 'cleared'>('checking');

  useEffect(() => {
    const uid = user?.uid || 'guest';
    const isCleared =
      localStorage.getItem(gateKey(uid)) === 'true' ||
      localStorage.getItem('dssg_onboarding_completed') === 'true';

    if (isCleared) {
      setStatus('cleared');
    } else {
      setStatus('needs-validation');
    }
  }, [user]);

  if (status === 'checking') {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-dssg-blue rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'needs-validation') {
    return (
      <NonprofitValidationGate
        user={user || null}
        isDemo={isDemo}
        onComplete={() => {
          const uid = user?.uid || 'guest';
          localStorage.setItem(gateKey(uid), 'true');
          localStorage.setItem('dssg_onboarding_completed', 'true');
          setStatus('cleared');
        }}
      />
    );
  }

  return <>{children}</>;
}
