-- Onboarding CRM Schema for Supabase
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(50) DEFAULT 'active',

  contact_name VARCHAR(255),
  contact_role VARCHAR(255),
  contact_phone VARCHAR(20),

  org_name VARCHAR(255) NOT NULL,
  org_type VARCHAR(50),
  org_ein VARCHAR(20),
  org_industry VARCHAR(255),
  org_website VARCHAR(255),

  program_interest VARCHAR(50),
  funding_range VARCHAR(50),
  project_timeline VARCHAR(255),

  scout_intake_id VARCHAR(255),
  scout_bucket VARCHAR(100),
  scout_status VARCHAR(50) DEFAULT 'pending',

  source VARCHAR(50) DEFAULT 'web_portal',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  onboarded_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_clients_firebase_uid ON clients(firebase_uid);
CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_clients_status ON clients(status);

-- ============================================================================

CREATE TABLE IF NOT EXISTS intake_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  version INT DEFAULT 1,

  problem_description TEXT,
  current_systems TEXT,
  primary_need VARCHAR(50),
  primary_need_other VARCHAR(255),
  referral_source VARCHAR(255),
  mission TEXT,
  scale TEXT,

  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by VARCHAR(255)
);

CREATE INDEX idx_intake_client_id ON intake_responses(client_id);
CREATE INDEX idx_intake_submitted_at ON intake_responses(submitted_at DESC);

-- ============================================================================

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,

  auth_completed BOOLEAN DEFAULT FALSE,
  auth_completed_at TIMESTAMP WITH TIME ZONE,

  profile_completed BOOLEAN DEFAULT FALSE,
  profile_completed_at TIMESTAMP WITH TIME ZONE,

  intake_completed BOOLEAN DEFAULT FALSE,
  intake_completed_at TIMESTAMP WITH TIME ZONE,

  fully_onboarded BOOLEAN DEFAULT FALSE,
  fully_onboarded_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_onboarding_client_id ON onboarding_progress(client_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Users can view/edit own records
CREATE POLICY "Users can view own client" ON clients
  FOR SELECT USING (auth.uid()::text = firebase_uid);

CREATE POLICY "Users can create client" ON clients
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update own client" ON clients
  FOR UPDATE USING (auth.uid()::text = firebase_uid);

CREATE POLICY "Users can view own intake" ON intake_responses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE id = client_id AND firebase_uid = auth.uid()::text)
  );

CREATE POLICY "Users can create intake" ON intake_responses
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can view own progress" ON onboarding_progress
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE id = client_id AND firebase_uid = auth.uid()::text)
  );

CREATE POLICY "Users can update own progress" ON onboarding_progress
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM clients WHERE id = client_id AND firebase_uid = auth.uid()::text)
  );
