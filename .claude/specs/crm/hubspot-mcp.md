# HubSpot CRM (MCP)

**Status: parked.** No code, no MCP server, no HubSpot mention anywhere else in this
repo as of this doc's creation — this is a placeholder scope for a workstream owned by
another contributor, so the target is written down before work starts rather than after.
Nothing here is a ratified decision; treat every section as a working assumption.

## Purpose

A CRM sync between this repo's data (businesses, engagements) and HubSpot, so
partner-org and engagement data doesn't have to be entered twice. Not yet connected to
any of the five agents' specs — most likely consumer is Chronicle (impact
statements/case studies, [chronicle.md](../agents/chronicle.md)) or Envoy (partner
comms, [envoy.md](../platform/agents/envoy.md)), since both already read `engagements` state, but
this link is undesigned.

## Why MCP

The working assumption is an MCP (Model Context Protocol) server as the integration
boundary, rather than a direct HubSpot API client embedded in `/api` — this keeps the
HubSpot-specific surface area isolated and reusable if other agents need CRM access
later, consistent with this repo's existing pattern of routing all external calls
through the `/api` server boundary
([design-system.md](../design-system.md) §1, "no secrets reach the client"). Whether
that MCP server lives in this repo or is a separate service is undesigned.

## Open questions

- **Direction of sync** — HubSpot → this repo (import CRM records), this repo →
  HubSpot (push engagement/business updates), or bidirectional? Undesigned.
- **Auth** — HubSpot private app token vs. OAuth; where the credential lives (Vercel
  Function env only, per the no-secrets-to-client convention, but not yet provisioned).
  Undesigned.
- **Data model mapping** — which HubSpot objects (Company, Deal, Contact) map to which
  Supabase tables (`businesses`, `engagements`), and how conflicts are resolved if a
  record is edited on both sides. Undesigned.
- **Trigger model** — real-time webhook-driven sync, polling, or manual/on-demand.
  Undesigned.
- **Which agent, if any, owns this** — see §Purpose. Undesigned.
- **Build owner and timeline** — assigned to another contributor; not scheduled against
  this repo's current plan.

## Non-goals (for now)

- Not required for any of the five agents to function — Scout, Architect, Pulse, Envoy,
  and Chronicle all operate on Supabase data alone today.
- Not scoped in [design-system.md](../design-system.md) as a stack decision; adding it
  there is a prerequisite before implementation starts, not this doc.

## Requirement Trace

| Requirement | Source | Now at | Status |
|---|---|---|---|
| CRM/HubSpot integration exists as a specced, parked workstream | Verbal scope, 2026-08-07 | This doc | Carried — first spec, no prior doc existed |
