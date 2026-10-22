import { useEffect, useState, type ReactNode } from 'react';
import { supabase, handleSupabaseError, OperationType } from '../../lib/supabase';
import ScoutIntakeForm from '../scout/ScoutIntakeForm';

const INTRO_NOTE =
  'Please submit the following survey if you are interested in partnering with DSSG NYC. ' +
  'We will reach out to you shortly after one of our Data Diplomats has reviewed your survey.';

const gateKey = (uid: string) => `dssg_intake_gate_cleared_${uid}`;

/**
 * Wraps the dashboard for signed-in, non-admin users. An organization with no
 * registered Business yet (i.e. this is their first time through) sees the
 * Scout intake survey before anything else, instead of an empty dashboard.
 * Cleared permanently in this browser once they register a Business or
 * submit the survey, so returning partners are never walled off again.
 */
export default function FirstTimeIntakeGate({ isDemo, children }: { isDemo?: boolean; children: ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<'checking' | 'needs-intake' | 'cleared'>(
    isDemo ? 'cleared' : 'checking'
  );

  useEffect(() => {
    if (isDemo) {
      setStatus('cleared');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setStatus('cleared');
          return;
        }

        setUid(user.id);
        if (localStorage.getItem(gateKey(user.id)) === 'true') {
          setStatus('cleared');
          return;
        }

        // businesses_select_own already restricts this to the caller's rows.
        const { data, error } = await supabase.from('businesses').select('id').limit(1);
        if (cancelled) return;
        if (error) handleSupabaseError(error, OperationType.LIST, 'businesses');

        if (!data || data.length === 0) {
          setStatus('needs-intake');
        } else {
          localStorage.setItem(gateKey(user.id), 'true');
          setStatus('cleared');
        }
      } catch (err) {
        if (cancelled) return;
        try {
          handleSupabaseError(err, OperationType.LIST, 'businesses');
        } catch {
          // handleSupabaseError logs then rethrows by design — swallowed so a
          // failed check doesn't strand a real partner behind a broken gate.
        }
        setStatus('cleared');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  if (status === 'checking') {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-dssg-blue rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'needs-intake') {
    return (
      <ScoutIntakeForm
        isDemo={isDemo}
        introNote={INTRO_NOTE}
        onSubmitted={() => {
          // This gate has no URL of its own — it renders in place of the
          // /dashboard route's element, so there is nothing to navigate to.
          // Clearing local state is what actually reveals the dashboard.
          if (uid) localStorage.setItem(gateKey(uid), 'true');
          setStatus('cleared');
        }}
      />
    );
  }

  return <>{children}</>;
}
