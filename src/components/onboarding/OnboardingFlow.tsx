import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { ensureClientExists, updateClient, createIntakeResponse } from '../../lib/supabase';
import { ClientProfile, OnboardingState, OnboardingStep, IntakeResponse } from '../../types';
import { motion } from 'motion/react';
import { CheckCircle2, ArrowRight, AlertCircle } from 'lucide-react';

import AuthSection from './sections/AuthSection';
import LookupSection from './sections/LookupSection';
import ProfileSection from './sections/ProfileSection';
import OrganizationSection from './sections/OrganizationSection';
import ProgramSection from './sections/ProgramSection';
import IntakeSection from './sections/IntakeSection';
import { NonprofitLookupResult } from '../../types';

const stepOrder: OnboardingStep[] = ['lookup', 'auth', 'profile', 'organization', 'program', 'intake', 'success'];

interface OnboardingFlowProps {
  isDemo?: boolean;
}

export default function OnboardingFlow({ isDemo }: OnboardingFlowProps) {
  const [state, setState] = useState<OnboardingState>({
    authCompleted: false,
    profileCompleted: false,
    intakeCompleted: false,
    currentStep: 'lookup',
    clientData: {},
    intakeData: {},
    errors: {},
    loading: false,
  });

  const [user, setUser] = useState<User | null>(null);
  const [supabaseClientId, setSupabaseClientId] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<NonprofitLookupResult | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (isDemo) return;
      setUser(u);

      if (u) {
        try {
          const client = await ensureClientExists(u.uid, u.email || '');
          setSupabaseClientId(client.id);

          setState(prev => ({
            ...prev,
            authCompleted: true,
            currentStep: 'profile',
            clientData: {
              ...prev.clientData,
              firebaseUid: u.uid,
              email: u.email || '',
            }
          }));
        } catch (err) {
          console.error('Failed to ensure client exists:', err);
        }
      }
    });

    return unsubscribe;
  }, [isDemo]);

  const handleLookupComplete = (data: any, result?: NonprofitLookupResult) => {
    if (result) {
      setLookupResult(result);
    }
    setState(prev => ({
      ...prev,
      currentStep: 'auth',
      clientData: { ...prev.clientData, ...data }
    }));
  };

  const handleAuthComplete = (email: string) => {
    setState(prev => ({
      ...prev,
      authCompleted: true,
      currentStep: 'profile',
      clientData: { ...prev.clientData, email }
    }));
  };

  const handleSectionComplete = (step: OnboardingStep, data: any) => {
    setState(prev => {
      const newState = { ...prev };

      if (step === 'profile') {
        newState.profileCompleted = true;
        newState.clientData = { ...prev.clientData, ...data };
      } else if (step === 'organization') {
        newState.clientData = { ...prev.clientData, ...data };
      } else if (step === 'program') {
        newState.clientData = { ...prev.clientData, ...data };
      } else if (step === 'intake') {
        newState.intakeCompleted = true;
        newState.intakeData = { ...prev.intakeData, ...data };
      }

      const currentIndex = stepOrder.indexOf(step);
      if (currentIndex < stepOrder.length - 1) {
        newState.currentStep = stepOrder[currentIndex + 1];
      }

      return newState;
    });
  };

  const handleSubmit = async () => {
    if (!supabaseClientId || !user) return;

    setState(prev => ({ ...prev, loading: true, errors: {} }));

    try {
      await updateClient(supabaseClientId, {
        contact_name: state.clientData.contactName,
        contact_role: state.clientData.contactRole,
        contact_phone: state.clientData.contactPhone,
        org_name: state.clientData.orgName,
        org_type: state.clientData.orgType,
        org_ein: state.clientData.orgEin,
        org_industry: state.clientData.orgIndustry,
        org_website: state.clientData.orgWebsite,
        program_interest: state.clientData.programInterest,
        funding_range: state.clientData.fundingRange,
        project_timeline: state.clientData.projectTimeline,
        onboarded_at: new Date().toISOString(),
      });

      if (state.intakeData.problemDescription) {
        await createIntakeResponse({
          clientId: supabaseClientId,
          problemDescription: state.intakeData.problemDescription || '',
          currentSystems: state.intakeData.currentSystems || '',
          primaryNeed: state.intakeData.primaryNeed || 'analyze_data',
          mission: state.intakeData.mission || '',
          scale: state.intakeData.scale || '',
          referralSource: state.intakeData.referralSource,
        });
      }

      setState(prev => ({
        ...prev,
        currentStep: 'success',
        loading: false,
      }));
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        loading: false,
        errors: { submit: err.message || 'Failed to submit onboarding' },
      }));
    }
  };

  if (state.currentStep === 'lookup') {
    return <LookupSection onComplete={handleLookupComplete} />;
  }

  if (state.currentStep === 'auth' && !state.authCompleted) {
    return <AuthSection onComplete={handleAuthComplete} isDemo={isDemo} />;
  }

  if (state.currentStep === 'success') {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-4 bg-slate-50">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-lg bg-white p-10 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 text-center"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-50 rounded-2xl mb-6">
            <CheckCircle2 className="text-emerald-600" size={32} />
          </div>
          <h2 className="text-2xl font-display font-bold text-dssg-blue tracking-tight mb-3">
            Welcome to DSSG NYC
          </h2>
          <p className="text-slate-500 text-sm font-medium leading-relaxed mb-8">
            Your profile is set up and we've received your intake information. A member of the team will review your application and follow up by email soon.
          </p>
          <a
            href="/dashboard"
            className="inline-block px-6 py-3 bg-dssg-orange text-white rounded-xl font-bold hover:bg-dssg-orange-light transition-all"
          >
            Go to Dashboard
          </a>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <span>Step {stepOrder.indexOf(state.currentStep) + 1}</span>
          <span>of {stepOrder.length - 1}</span>
        </div>

        <motion.div
          key={state.currentStep}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="bg-white p-8 sm:p-10 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200"
        >
          {state.errors.submit && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex gap-3">
              <AlertCircle className="text-red-600 flex-shrink-0" size={18} />
              <p className="text-sm font-medium text-red-600">{state.errors.submit}</p>
            </div>
          )}

          {state.currentStep === 'profile' && (
            <ProfileSection
              data={state.clientData}
              onComplete={(data) => handleSectionComplete('profile', data)}
              errors={state.errors}
            />
          )}

          {state.currentStep === 'organization' && (
            <OrganizationSection
              data={state.clientData}
              lookupResult={lookupResult}
              onComplete={(data) => handleSectionComplete('organization', data)}
              errors={state.errors}
            />
          )}

          {state.currentStep === 'program' && (
            <ProgramSection
              data={state.clientData}
              onComplete={(data) => handleSectionComplete('program', data)}
              errors={state.errors}
            />
          )}

          {state.currentStep === 'intake' && (
            <IntakeSection
              data={state.intakeData}
              onComplete={(data) => handleSectionComplete('intake', data)}
              onSubmit={handleSubmit}
              errors={state.errors}
              loading={state.loading}
            />
          )}
        </motion.div>
      </div>
    </div>
  );
}
