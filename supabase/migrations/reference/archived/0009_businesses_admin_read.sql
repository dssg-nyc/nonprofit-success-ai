-- Staff read every business in their org(s), matching the engagement read they already
-- hold (0001_core: engagements_select_admin; 0003_delivery: engagement_events_select_admin).
--
-- Before this migration `businesses` had only the owner-scoped select (rules:106–107), so
-- a staff session could read every engagement in the org but none of the businesses they
-- belong to: the admin dashboard listed zero partnerships, and a business page reached by
-- id from the review queue redirected as "not found". Partners are unchanged — a client
-- still sees only the business they own.
--
-- Read authority only. Insert, update and delete stay owner-scoped: a business enters the
-- pipeline through approve_scout_intake() (0008), and stage through transition_engagement()
-- (0005). This is the 0001_core org model, not C1 (D29): when the three-role, project-scoped
-- model lands, this policy narrows to assigned projects with the rest.

create policy businesses_select_admin on businesses
  for select to authenticated
  using (is_admin()
         and organization_id in (select user_org_ids()));
