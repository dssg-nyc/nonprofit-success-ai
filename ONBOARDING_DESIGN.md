# Comprehensive Onboarding Flow Design

## Overview
Unified client onboarding combining login + profile intake + Scout assessment into single-page form with collapsible sections. Data flows: Firebase Auth → Firestore (user profile) → Supabase (CRM client record).

## Architecture

### Flow Diagram
```
User arrives at /onboard (unauthenticated)
  ↓
[Login Section - Collapsible]
  - Google OAuth
  - Email/Password signup
  ↓
Auth successful → Firebase user created
  ↓
[Profile Section - Collapsible]
  - Name, role, phone
  - Organization name, type, EIN, industry
  - Program interest, funding type, timeline
  ↓
[Scout Intake Section - Collapsible]
  - Problem description
  - Current systems
  - Primary need category
  - Referral source
  ↓
Submit → Save to Supabase + Firestore
  ↓
Success page + Redirect to dashboard
```

## Data Schema

### Supabase Tables

#### `clients` (CRM core)
```sql
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  onboarded_at TIMESTAMP,
  
  -- Basic Profile
  contact_name VARCHAR(255),
  contact_role VARCHAR(255),
  contact_phone VARCHAR(20),
  
  -- Organization
  org_name VARCHAR(255) NOT NULL,
  org_type VARCHAR(50),
  org_ein VARCHAR(20),
  org_industry VARCHAR(255),
  org_website VARCHAR(255),
  
  -- Program Interest
  program_interest VARCHAR(50),
  funding_range VARCHAR(50),
  project_timeline VARCHAR(100),
  
  -- Scout Integration
  scout_intake_id VARCHAR(255),
  scout_bucket VARCHAR(100),
  scout_status VARCHAR(50) DEFAULT 'pending',
  
  source VARCHAR(50) DEFAULT 'web_portal',
  notes TEXT
);
```

#### `intake_responses` (Versioned audit trail)
```sql
CREATE TABLE intake_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  version INT DEFAULT 1,
  
  problem_description TEXT,
  current_systems TEXT,
  primary_need VARCHAR(50),
  primary_need_other VARCHAR(255),
  referral_source VARCHAR(255),
  mission TEXT,
  scale TEXT,
  
  submitted_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  reviewed_by VARCHAR(255)
);
```

#### `onboarding_progress` (Track multi-step completion)
```sql
CREATE TABLE onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  
  auth_completed BOOLEAN DEFAULT FALSE,
  auth_completed_at TIMESTAMP,
  
  profile_completed BOOLEAN DEFAULT FALSE,
  profile_completed_at TIMESTAMP,
  
  intake_completed BOOLEAN DEFAULT FALSE,
  intake_completed_at TIMESTAMP,
  
  fully_onboarded BOOLEAN DEFAULT FALSE,
  fully_onboarded_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Component Structure

### OnboardingFlow.tsx (Main Container)
- Manages multi-step state
- Handles auth state
- Routes to appropriate section
- Orchestrates Supabase saves

### Sub-Components
1. **AuthSection**: Login/signup (reuse existing Login.tsx logic)
2. **ProfileSection**: Name + role + phone
3. **OrganizationSection**: Org name, type, EIN, industry
4. **ProgramSection**: Interest, funding, timeline
5. **IntakeSection**: Scout-style questions (reuse ScoutIntakeForm fields)
6. **SuccessSection**: Confirmation + next steps

## Data Type Updates

### New TypeScript Interfaces
```typescript
interface ClientProfile {
  id?: string
  firebaseUid: string
  email: string
  
  // Basic
  contactName: string
  contactRole: string
  contactPhone: string
  
  // Organization
  orgName: string
  orgType: 'nonprofit' | 'small_business' | 'other'
  orgEin?: string
  orgIndustry?: string
  orgWebsite?: string
  
  // Program Interest
  programInterest: 'grant' | 'hackathon' | 'ongoing' | 'consulting'
  fundingRange?: string
  projectTimeline: string
  
  // Scout
  scoutIntakeId?: string
  scoutBucket?: ScoutBucket
  scoutStatus: 'pending' | 'reviewed' | 'approved' | 'rejected'
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
  onboardedAt?: Date
}

interface OnboardingState {
  authCompleted: boolean
  profileCompleted: boolean
  intakeCompleted: boolean
  clientData: Partial<ClientProfile>
  intakeData: Partial<IntakeResponse>
  currentStep: 'login' | 'profile' | 'organization' | 'program' | 'intake' | 'success'
  errors: Record<string, string>
  loading: boolean
}
```

## Integration Points

### Firebase ↔ Firestore (Existing)
- User created via Firebase Auth
- User profile stored in Firestore `users` collection
- Firebase UID = primary key linking all systems

### Firestore ↔ Supabase (New)
- Scout intake submitted to Firestore `scoutIntakes` (existing)
- Scout ID stored in Supabase `clients.scout_intake_id`
- Audit trail in Supabase `intake_responses`

### Auth Flow
1. User submits login (Google or email)
2. Firebase Auth handles authentication
3. Firestore user profile created/updated
4. Check Supabase for existing client record
5. If new: create record with firebase_uid, email
6. If existing: update last seen timestamp

## Supabase Setup

### 1. Install Package
```bash
npm install @supabase/supabase-js
```

### 2. Create Supabase Project
- Sign up at https://supabase.com
- Create new project
- Copy URL and anon key to .env

### 3. Run Migrations
Execute SQL in Supabase SQL Editor.

### 4. Environment Variables
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxxx
```

## File Structure

```
src/
├── lib/
│   ├── firebase.ts (existing)
│   └── supabase.ts (NEW - client initialization)
├── types.ts (UPDATE - add ClientProfile interfaces)
├── components/
│   ├── auth/
│   │   └── Login.tsx (existing)
│   ├── onboarding/
│   │   ├── OnboardingFlow.tsx (NEW - main container)
│   │   ├── AuthSection.tsx (NEW - login/signup)
│   │   ├── ProfileSection.tsx (NEW - name, role, phone)
│   │   ├── OrganizationSection.tsx (NEW - org details)
│   │   ├── ProgramSection.tsx (NEW - interest + timeline)
│   │   ├── IntakeSection.tsx (NEW - scout questions)
│   │   ├── SuccessSection.tsx (NEW - confirmation)
│   │   └── onboarding.css (NEW - styles)
│   └── scout/
│       └── ScoutIntakeForm.tsx (existing - can be deprecated)
└── App.tsx (UPDATE - add /onboard route)
```

## Rollout Plan

### Phase 1: Setup (Supabase + Schema)
- [ ] Create Supabase project
- [ ] Run SQL migrations (create 3 tables)
- [ ] Set up RLS policies
- [ ] Add env vars to .env.example

### Phase 2: Core Components
- [ ] Create types/interfaces in types.ts
- [ ] Build supabase.ts client
- [ ] Build OnboardingFlow container
- [ ] Build auth/profile/organization/program/intake section components

### Phase 3: Integration
- [ ] Connect Scout routing to new flow
- [ ] Link Firebase → Supabase in auth flow
- [ ] Update App.tsx routing
- [ ] Redirect: unauthenticated → /onboard

### Phase 4: Polish & Testing
- [ ] E2E test full flow
- [ ] Visual regression (all breakpoints)
- [ ] Admin review queue integration
- [ ] Backward compatibility (old /apply form still works)

## Success Criteria
- ✅ New clients complete onboarding in <10 minutes
- ✅ All data persists to both Firebase and Supabase
- ✅ Admin can view client progress in review queue
- ✅ No duplicate clients (firebase_uid unique)
- ✅ Existing Scout intake still works
- ✅ 80%+ test coverage on onboarding flow
