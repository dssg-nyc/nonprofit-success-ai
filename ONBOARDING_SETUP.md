# Onboarding Flow Implementation Guide

## Quick Start (3 steps)

### Step 1: Set Up Supabase
1. Go to [supabase.com](https://supabase.com)
2. Create new project
3. Copy `Project URL` and `Anon Key` from Settings > API

### Step 2: Create Database Tables
In Supabase SQL Editor, run: `/ONBOARDING_MIGRATIONS.sql`

### Step 3: Configure Environment
```bash
# Add to .env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxxx
```

## Installation

### 1. Install Supabase Package
```bash
cd /Users/johann/Documents/PROJECTS/nonprofit-success-ai
npm install @supabase/supabase-js
```

### 2. Update .env
```bash
cp .env.example .env
```

Add these lines:
```
VITE_SUPABASE_URL=https://[YOUR-PROJECT].supabase.co
VITE_SUPABASE_ANON_KEY=[YOUR-ANON-KEY]
```

### 3. Update App.tsx
Add route for onboarding (around line 195):
```tsx
<Route path="/onboard" element={<OnboardingFlow isDemo={isDemo} />} />
```

Also update navbar unauthenticated section (around line 90):
```tsx
<Link to="/onboard" className="text-xs font-bold uppercase tracking-widest">
  Start Onboarding
</Link>
```

### 4. Import component in App.tsx
```tsx
import OnboardingFlow from './components/onboarding/OnboardingFlow';
```

### 5. Verify Build
```bash
npm run lint
```

## File Structure

```
src/
├── lib/
│   └── supabase.ts (NEW)
├── types.ts (UPDATED)
├── components/
│   └── onboarding/ (NEW)
│       ├── OnboardingFlow.tsx
│       └── sections/
│           ├── AuthSection.tsx
│           ├── ProfileSection.tsx
│           ├── OrganizationSection.tsx
│           ├── ProgramSection.tsx
│           └── IntakeSection.tsx
```

## Flow Steps

1. **Auth** - Google OAuth or email/password
2. **Profile** - Name, role, phone
3. **Organization** - Org name, type, EIN, industry
4. **Program** - Interest, funding, timeline
5. **Intake** - Scout-style assessment
6. **Success** - Confirmation + dashboard link

## Database Schema

**clients** table:
- firebase_uid (unique)
- email (unique)
- contact_name, contact_role, contact_phone
- org_name, org_type, org_ein, org_industry, org_website
- program_interest, funding_range, project_timeline
- scout_intake_id
- status, onboarded_at

**intake_responses** table:
- client_id (FK)
- problem_description, current_systems, primary_need
- mission, scale, referral_source
- submitted_at, reviewed_at

**onboarding_progress** table:
- client_id (FK)
- auth_completed, profile_completed, intake_completed, fully_onboarded
- timestamps for each step

## Testing

### Demo Mode
```bash
npm run dev
# Visit http://localhost:3000/onboard
# Click "Enter Demo Mode"
```

### Live Test
- Use any email/password
- Watch Firestore + Supabase dashboards for data

## Integration

- **Firebase**: Auth + user profile
- **Firestore**: User records
- **Supabase**: Client CRM data
- **Scout**: Auto-link intake to Scout assessment

## Troubleshooting

**"Supabase credentials not configured"**
- Add both env vars to .env

**Client not created**
- Check Supabase RLS policies
- Verify Firebase auth succeeded first

**Form not advancing**
- Check browser console
- Ensure all required fields filled

## Next Steps

1. Configure Supabase
2. Run SQL migrations
3. Install @supabase/supabase-js
4. Update .env
5. Update App.tsx routes
6. Test flow end-to-end
