# 501(c)(3) Validation Onboarding & Salesforce / Agentforce Lead Generation Journey

A guided post-authentication onboarding experience that validates whether prospective partners are registered 501(c)(3) charities or non-501(c)(3) NGOs, auto-enriches profiles via ProPublica and intelligent website parsing, and synchronizes qualified leads to Salesforce and Agentforce.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following user preferences were established during Phase 1 clarification:
> - **Lead Pipeline Strategy**: Structured Salesforce & Agentforce lead generator with live payload inspector, CRM schema validator, and webhook dispatch.
> - **Website Extraction**: Interactive URL preview parser with editable suggested fields (mission, NTEE/nonprofit category, operational focus, leadership POC) for organizations without 501(c)(3) filings.
> - **Journey Placement**: Dedicated onboarding gate displayed immediately upon authentication (Google or credentials) before reaching the internal dashboard.

---

### 1. Overview & Core Concept

When a new partner or prospective client logs into the DSSG NYC portal (via Google Sign-In or credentials), they are greeted with an onboarding journey tailored to mission-driven organizations:

1. **Mission Alignment & 501(c)(3) Gating**:
   Explains DSSG NYC's mandate ("We work with nonprofit charities and NGOs") and presents three core validation inputs:
   - **Organization Name**
   - **Employer Identification Number (EIN)** (formatted as `XX-XXXXXXX` with instant validation)
   - **Official Website URL** (e.g. `https://example.org`)

2. **Branch A — Registered 501(c)(3) Hit (ProPublica Integration)**:
   - Queries the ProPublica Nonprofit Explorer API (using `api/_propublica.ts` and `src/schemas/nonprofit.ts`).
   - Retrieves IRS Master File data: legal name, 501(c)(3) subsection code verification, NTEE classification, city/state, gross revenue, asset figures, and latest Form 990 filing links.
   - Automatically populates the applicant's profile and populates the Scout intake record with authoritative IRS numbers.

3. **Branch B — Non-501(c)(3) / Grassroots NGO (Interactive Website Parser)**:
   - When no IRS 501(c)(3) record is found, the user enters information manually.
   - Activates an interactive website parser on their provided URL that extracts and auto-suggests:
     - Mission Statement & Impact Summary
     - Nonprofit Category / Cause Domain (e.g., Youth Development, Housing Justice, Environmental Health)
     - Primary Systems & Scale of Operations
   - Allows the applicant to review, adjust, and confirm the suggested data.

4. **Structured Salesforce & Agentforce Lead Generation**:
   - Compiles validated organization and intake data into a standard Salesforce Lead object payload:
     - `Company`: Organization Legal Name
     - `LeadSource`: `"DSSG NYC Portal"`
     - `Status`: `"New - Validated"` (for 501(c)(3)) or `"New - NGO Review"` (for grassroots)
     - `Description`: Mission summary, operational challenges, scale, and ProPublica citation
     - `AnnualRevenue`: Extracted from IRS 990 filing or estimated
     - `Agentforce_Payload`: AI Agent context schema for automated triage, bot routing, and follow-up scheduling
   - Persists the lead locally and provides an interactive payload previewer with mock/live webhook synchronization.

---

### 2. User Experience & Visual Design

#### A. User Flow Walkthrough

```
┌─────────────────────────────────────────────────────────┐
│               1. Sign In / Authentication               │
│        (Google One-Click or Email & Password)           │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│            2. 501(c)(3) Validation Onboarding Gate       │
│  "We work with nonprofit charities and NGOs. If you     │
│   are a registered 501c3, please validate..."           │
│   Inputs: [ Org Name ] [ EIN (XX-XXXXXXX) ] [ Website ] │
└──────────────┬────────────────────────────┬─────────────┘
               │                            │
      [ 501(c)(3) Matched ]        [ No 501(c)(3) Found ]
               │                            │
               ▼                            ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│  3A. ProPublica Verification │ │   3B. Website URL Parser     │
│  • IRS 501(c)(3) Status Badge│ │  • Scrapes & analyzes URL    │
│  • Latest 990 Revenue/Assets │ │  • Suggests Mission & Focus  │
│  • NTEE Category & Location  │ │  • Editable Form Auto-fill   │
└──────────────┬───────────────┘ └──────────────┬───────────────┘
               │                                │
               └────────────────┬───────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────┐
│        4. Salesforce & Agentforce Lead Generation       │
│  • Structured Lead Record created in system             │
│  • Agentforce prompt context & CRM schema payload       │
│  • Real-time Payload Inspector + Webhook Dispatch Sync  │
└───────────────────────────────┬─────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────┐
│               5. Success & Portal Unlock                │
│       Proceed directly to DSSG Success Dashboard        │
└─────────────────────────────────────────────────────────┘
```

#### B. Visual Identity & Design System Compliance
- **Typography**: Playfair Display for authoritative, mission-driven headings; Plus Jakarta Sans/Inter for scannable form fields; tabular JetBrains Mono for EIN numbers and financial metrics.
- **Palette**:
  - Primary: Deep Navy `#002D72` (DSSG Brand Blue)
  - Secondary/Accent: Vibrant Orange `#F47E2D` (DSSG NYC Brand Orange)
  - Validation Surfaces: Crisp white cards with hairline slate borders (`border-slate-200`)
  - Status Indicators: Emerald `#16A34A` for verified 501(c)(3) status; Amber `#D97706` for manual NGO review.
- **No Pill Badges on Static Content**: Unboxed typography with `·` separators for IRS metadata and tax periods.
- **Responsive Architecture**: Clean 1440px desktop balance with centered 680px onboarding card container, ensuring no overflow on laptops and mobile devices.

---

### 3. Technical Architecture & Integration Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client (React SPA)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────┐      ┌───────────────────────────────────────┐  │
│  │ FirstTimeIntakeGate.tsx│ ───► │ NonprofitValidationStep.tsx           │  │
│  │ (Auth Gate Controller) │      │ (Org Name, EIN, Website Entry)        │  │
│  └────────────────────────┘      └──────────────────┬────────────────────┘  │
│                                                     │                       │
│                         ┌───────────────────────────┴────────────────────┐  │
│                         │                                                │  │
│                         ▼                                                ▼  │
│           ┌───────────────────────────┐                    ┌────────────────┐
│           │ ProPublicaMatchCard.tsx   │                    │ UrlParser.tsx  │
│           │ (IRS 990 & Subsection)    │                    │ (Mission/Tags) │
│           └─────────────┬─────────────┘                    └───────┬────────┘
│                         │                                          │        │
│                         └─────────────────────┬────────────────────┘        │
│                                               │                             │
│                                               ▼                             │
│                              ┌───────────────────────────────────┐          │
│                              │ SalesforceAgentforceSync.tsx      │          │
│                              │ (Lead Schema Preview & Webhook)   │          │
│                              └────────────────┬──────────────────┘          │
│                                               │                             │
└───────────────────────────────────────────────┼─────────────────────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Backend & Integration Layer                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  • /api/nonprofits/search & /api/nonprofits/[ein] (ProPublica v2 API)       │
│  • Client-side ProPublica Fallback Resolver (resilient when offline)        │
│  • Website Content Parser (analyzes URL domain/meta/mission context)        │
│  • Salesforce Lead Store (persists generated leads with Agentforce schemas) │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Key Components to Build / Enhance:
1. `src/components/onboarding/NonprofitValidationGate.tsx`:
   The full-screen post-login validation experience that intercepts first-time users before the dashboard.
2. `src/components/onboarding/ProPublicaMatchCard.tsx`:
   Visual presentation of the verified 501(c)(3) filing details, revenue, Form 990 link, and NTEE code.
3. `src/components/onboarding/WebsiteExtractorCard.tsx`:
   Interactive URL parser for non-501(c)(3)s that fetches/suggests mission, nonprofit category, and operational scale with one-click adoption.
4. `src/components/onboarding/SalesforceLeadViewer.tsx`:
   Interactive modal or expandable drawer showing the exact JSON payload formatted for Salesforce REST Lead API / Agentforce agent context, with test webhook dispatch simulation.
5. `src/lib/salesforceLead.ts`:
   Typed schema validator and payload builder mapping applicant details to Salesforce standard Lead fields + Agentforce custom JSON.
6. Integration into `App.tsx` and `FirstTimeIntakeGate.tsx`:
   Connecting the validation stage seamlessly so verified users are saved, leads are generated, and the dashboard is unlocked.

---

### 4. Verification & Testing Plan
- Test Google sign-in and manual sign-in transition directly to the 501(c)(3) validation screen.
- Verify ProPublica lookup with known EINs (e.g. `13-1628186` MoMA, or name searches) displays filing data, 501(c)(3) badge, and auto-fills the applicant profile.
- Verify non-501(c)(3) flow with website URL triggers the interactive scraper, suggests mission and category, and allows editing.
- Verify Salesforce / Agentforce structured lead generator builds accurate payload schemas and allows webhook testing.
- Run `compile_applet` and `lint_applet` to ensure zero compilation or type errors.
