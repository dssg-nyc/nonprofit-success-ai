import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase credentials not configured. CRM features disabled.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder-key'
);

export enum SupabaseTable {
  CLIENTS = 'clients',
  INTAKE_RESPONSES = 'intake_responses',
  ONBOARDING_PROGRESS = 'onboarding_progress',
}

// Client operations
export async function createClient(data: {
  firebaseUid: string;
  email: string;
  status?: string;
  source?: string;
}) {
  const { data: result, error } = await supabase
    .from(SupabaseTable.CLIENTS)
    .insert([{
      firebase_uid: data.firebaseUid,
      email: data.email,
      status: data.status || 'active',
      source: data.source || 'web_portal',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }])
    .select()
    .single();

  if (error) throw new Error(`Failed to create client: ${error.message}`);
  return result;
}

export async function getClientByFirebaseUid(firebaseUid: string) {
  const { data, error } = await supabase
    .from(SupabaseTable.CLIENTS)
    .select('*')
    .eq('firebase_uid', firebaseUid)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data;
}

export async function getClientByEmail(email: string) {
  const { data, error } = await supabase
    .from(SupabaseTable.CLIENTS)
    .select('*')
    .eq('email', email)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateClient(clientId: string, updates: Record<string, any>) {
  const { data, error } = await supabase
    .from(SupabaseTable.CLIENTS)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update client: ${error.message}`);
  return data;
}

// Intake responses
export async function createIntakeResponse(data: {
  clientId: string;
  problemDescription: string;
  currentSystems: string;
  primaryNeed: string;
  mission: string;
  scale: string;
  referralSource?: string;
}) {
  const { data: result, error } = await supabase
    .from(SupabaseTable.INTAKE_RESPONSES)
    .insert([{
      client_id: data.clientId,
      version: 1,
      problem_description: data.problemDescription,
      current_systems: data.currentSystems,
      primary_need: data.primaryNeed,
      mission: data.mission,
      scale: data.scale,
      referral_source: data.referralSource,
      submitted_at: new Date().toISOString(),
    }])
    .select()
    .single();

  if (error) throw new Error(`Failed to create intake: ${error.message}`);
  return result;
}

export async function getIntakeResponsesByClient(clientId: string) {
  const { data, error } = await supabase
    .from(SupabaseTable.INTAKE_RESPONSES)
    .select('*')
    .eq('client_id', clientId)
    .order('submitted_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch intakes: ${error.message}`);
  return data;
}

// Onboarding progress
export async function createOnboardingProgress(clientId: string) {
  const { data: result, error } = await supabase
    .from(SupabaseTable.ONBOARDING_PROGRESS)
    .insert([{
      client_id: clientId,
      auth_completed: false,
      profile_completed: false,
      intake_completed: false,
      fully_onboarded: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }])
    .select()
    .single();

  if (error) throw new Error(`Failed to create onboarding progress: ${error.message}`);
  return result;
}

export async function getOnboardingProgress(clientId: string) {
  const { data, error } = await supabase
    .from(SupabaseTable.ONBOARDING_PROGRESS)
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateOnboardingProgress(clientId: string, updates: Record<string, any>) {
  const { data, error } = await supabase
    .from(SupabaseTable.ONBOARDING_PROGRESS)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('client_id', clientId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update onboarding progress: ${error.message}`);
  return data;
}

// Utility: Ensure client + progress records exist
export async function ensureClientExists(firebaseUid: string, email: string) {
  let client = await getClientByFirebaseUid(firebaseUid).catch(() => null);

  if (!client) {
    client = await createClient({ firebaseUid, email });
    await createOnboardingProgress(client.id);
  }

  return client;
}
