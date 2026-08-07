# Onboarding Implementation Checklist

## Files Created ✅

### Core Implementation
- ✅ `src/types.ts` - Updated with ClientProfile, IntakeResponse, OnboardingState
- ✅ `src/lib/supabase.ts` - Supabase client + database functions
- ✅ `src/components/onboarding/OnboardingFlow.tsx` - Main container component
- ✅ `src/components/onboarding/sections/AuthSection.tsx` - Login/signup
- ✅ `src/components/onboarding/sections/ProfileSection.tsx` - Name, role, phone
- ✅ `src/components/onboarding/sections/OrganizationSection.tsx` - Org details
- ✅ `src/components/onboarding/sections/ProgramSection.tsx` - Program interest
- ✅ `src/components/onboarding/sections/IntakeSection.tsx` - Scout assessment

### Configuration & Documentation
- ✅ `ONBOARDING_DESIGN.md` - Architecture + design decisions
- ✅ `ONBOARDING_SETUP.md` - Step-by-step implementation guide
- ✅ `ONBOARDING_MIGRATIONS.sql` - Database schema (run in Supabase)
- ✅ `IMPLEMENTATION_CHECKLIST.md` - This file

## Quick Start (5 steps)

### 1. Install Supabase
```bash
npm install @supabase/supabase-js
```

### 2. Create Supabase Project
- Go to supabase.com
- Create project
- Copy URL + Anon Key

### 3. Configure Environment
```bash
# Add to .env
VITE_SUPABASE_URL=https://[PROJECT].supabase.co
VITE_SUPABASE_ANON_KEY=[KEY]
```

### 4. Run Database Migrations
- Open Supabase SQL Editor
- Copy content from `ONBOARDING_MIGRATIONS.sql`
- Paste and execute

### 5. Update App.tsx
Add import:
```tsx
import OnboardingFlow from './components/onboarding/OnboardingFlow';
```

Add route (line ~195):
```tsx
<Route path="/onboard" element={<OnboardingFlow isDemo={isDemo} />} />
```

## Setup Checklist

### Supabase Setup
- [ ] Create account at supabase.com
- [ ] Create project
- [ ] Copy Project URL
- [ ] Copy Anon Key

### Install & Configure
- [ ] Run: `npm install @supabase/supabase-js`
- [ ] Add to `.env`: VITE_SUPABASE_URL
- [ ] Add to `.env`: VITE_SUPABASE_ANON_KEY
- [ ] Update `.env.example` (without values)

### Database Setup
- [ ] Open Supabase SQL Editor
- [ ] Run ONBOARDING_MIGRATIONS.sql
- [ ] Verify tables created (clients, intake_responses, onboarding_progress)

### App Integration
- [ ] Add OnboardingFlow import to App.tsx
- [ ] Add /onboard route
- [ ] Add navbar link to onboarding
- [ ] Run: `npm run lint`

### Testing
- [ ] Run: `npm run dev`
- [ ] Visit localhost:3000/onboard
- [ ] Test demo mode
- [ ] Test full flow (auth → profile → org → program → intake → success)
- [ ] Check Supabase dashboard for records

## Data Flow

```
User visits /onboard
  ↓
AuthSection (Google OAuth or email/password)
  → Creates Firebase user
  → Creates Firestore users/{uid}
  → Creates Supabase clients record
  ↓
ProfileSection (name, role, phone)
  → Stored in component state
  ↓
OrganizationSection (org details)
  → Stored in component state
  ↓
ProgramSection (interest, funding, timeline)
  → Stored in component state
  ↓
IntakeSection (Scout questions)
  → Stored in component state
  ↓
Submit
  → Updates Supabase clients record
  → Creates Supabase intake_responses record
  ↓
Success page → Redirect to dashboard
```

## Files Overview

| File | Purpose |
|------|---------|
| `src/types.ts` | Data interfaces (ClientProfile, OnboardingState) |
| `src/lib/supabase.ts` | Supabase client + queries |
| `src/components/onboarding/OnboardingFlow.tsx` | Main orchestrator |
| `src/components/onboarding/sections/*.tsx` | Form sections |
| `ONBOARDING_DESIGN.md` | Architecture + decisions |
| `ONBOARDING_SETUP.md` | Setup guide |
| `ONBOARDING_MIGRATIONS.sql` | Database schema |

## Integration Checklist

- [ ] Firebase auth still works
- [ ] Firestore user records created
- [ ] Supabase clients records created
- [ ] Supabase intake_responses records created
- [ ] Scout form still works
- [ ] Admin review queue still works

## Testing Checklist

- [ ] Build passes: `npm run lint`
- [ ] Dev server starts: `npm run dev`
- [ ] /onboard route accessible
- [ ] Demo mode works
- [ ] Google OAuth flow works
- [ ] Email/password auth works
- [ ] Form validation works
- [ ] All form steps advance
- [ ] Submit works + redirects to success
- [ ] Supabase records created
- [ ] Mobile responsive

## Troubleshooting

**Build error with types**
→ Run `npm run lint` to see details

**Supabase "credentials not configured"**
→ Check .env has both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

**Client not created in Supabase**
→ Check browser console
→ Verify Firebase auth succeeded
→ Check RLS policies

**Form won't advance**
→ Check browser console
→ Fill all required fields
→ Verify onComplete callbacks

## Optional Next Steps

- Add email confirmation
- Create admin dashboard
- Auto-fill Scout form
- Add form progress persistence
- Send team notification webhook
- Export to CSV

## Support

- Design reference: `ONBOARDING_DESIGN.md` (Artifact)
- Setup guide: `ONBOARDING_SETUP.md`
- Database: `ONBOARDING_MIGRATIONS.sql`
- Types: `src/types.ts`
- Supabase client: `src/lib/supabase.ts`
