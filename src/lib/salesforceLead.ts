/**
 * Salesforce & Agentforce Structured Lead Schema and Sync Engine.
 * Formats validated nonprofit applications into Salesforce Lead sObjects
 * and Agentforce prompt contexts for automated CRM intake and agent routing.
 */

export interface SalesforceLead {
  Id: string;
  Company: string;
  FirstName: string;
  LastName: string;
  Email: string;
  Website: string;
  EIN__c?: string;
  Tax_Status__c: '501(c)(3) Verified' | 'Non-501(c)(3) NGO' | 'Fiscal Sponsor';
  Nonprofit_Category__c: string;
  AnnualRevenue?: number;
  Assets__c?: number;
  Form_990_Year__c?: number;
  Mission_Statement__c: string;
  LeadSource: string;
  Status: 'New - 501(c)(3) Validated' | 'New - NGO Manual Review' | 'Working - Contacted';
  Agentforce_Context: AgentforcePayload;
  CreatedDate: string;
  SyncStatus: 'synced' | 'pending';
}

export interface AgentforcePayload {
  agent_intent: 'nonprofit_intake_triage';
  organization_type: 'registered_charity' | 'grassroots_ngo';
  readiness_tier: 'L1_Standard' | 'L2_Accelerated' | 'L3_HighTouch';
  financial_scale: string;
  ai_triage_summary: string;
  suggested_action: string;
  recommended_dssg_track: 'Data Infrastructure' | 'Predictive Analytics' | 'Workflow Automation' | 'Evaluation Strategy';
  metadata_extracted_from: 'propublica_irs_master_file' | 'website_content_scraper';
}

const STORAGE_KEY = 'dssg_salesforce_leads';

export function buildSalesforceLead(params: {
  orgName: string;
  contactName: string;
  contactEmail: string;
  website: string;
  ein?: string;
  is501c3: boolean;
  category: string;
  mission: string;
  annualRevenue?: number;
  assets?: number;
  formYear?: number;
  scale?: string;
}): SalesforceLead {
  const nameParts = params.contactName.trim().split(' ');
  const firstName = nameParts[0] || 'Partner';
  const lastName = nameParts.slice(1).join(' ') || 'Representative';

  const revenueDesc = params.annualRevenue
    ? `$${params.annualRevenue.toLocaleString()}`
    : 'Not reported';

  const readinessTier = params.is501c3 && (params.annualRevenue ?? 0) > 250000
    ? 'L2_Accelerated'
    : params.is501c3
    ? 'L1_Standard'
    : 'L3_HighTouch';

  const recommendedTrack =
    params.category.toLowerCase().includes('youth') || params.category.toLowerCase().includes('education')
      ? 'Predictive Analytics'
      : params.category.toLowerCase().includes('health') || params.category.toLowerCase().includes('medical')
      ? 'Data Infrastructure'
      : params.category.toLowerCase().includes('housing') || params.category.toLowerCase().includes('community')
      ? 'Workflow Automation'
      : 'Evaluation Strategy';

  const agentforceContext: AgentforcePayload = {
    agent_intent: 'nonprofit_intake_triage',
    organization_type: params.is501c3 ? 'registered_charity' : 'grassroots_ngo',
    readiness_tier: readinessTier,
    financial_scale: revenueDesc,
    ai_triage_summary: `${params.orgName} (${params.is501c3 ? 'IRS 501c3 Verified' : 'Community NGO'}) working in ${params.category}. Mission: ${params.mission.slice(0, 160)}...`,
    suggested_action: params.is501c3
      ? 'Auto-route to DSSG Technical Architect for Initial Scoping Meeting.'
      : 'Route to Community Engagement Officer for Fiscal Sponsor verification.',
    recommended_dssg_track: recommendedTrack,
    metadata_extracted_from: params.is501c3
      ? 'propublica_irs_master_file'
      : 'website_content_scraper',
  };

  const lead: SalesforceLead = {
    Id: `00Q${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
    Company: params.orgName,
    FirstName: firstName,
    LastName: lastName,
    Email: params.contactEmail,
    Website: params.website,
    EIN__c: params.ein,
    Tax_Status__c: params.is501c3 ? '501(c)(3) Verified' : 'Non-501(c)(3) NGO',
    Nonprofit_Category__c: params.category,
    AnnualRevenue: params.annualRevenue,
    Assets__c: params.assets,
    Form_990_Year__c: params.formYear,
    Mission_Statement__c: params.mission,
    LeadSource: 'DSSG NYC Portal',
    Status: params.is501c3 ? 'New - 501(c)(3) Validated' : 'New - NGO Manual Review',
    Agentforce_Context: agentforceContext,
    CreatedDate: new Date().toISOString(),
    SyncStatus: 'synced',
  };

  return lead;
}

export function saveSalesforceLead(lead: SalesforceLead): void {
  try {
    const existing = getSalesforceLeads();
    const updated = [lead, ...existing.filter((item) => item.Id !== lead.Id)];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('[Salesforce] Could not persist lead:', err);
  }
}

export function getSalesforceLeads(): SalesforceLead[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function dispatchSalesforceWebhook(
  lead: SalesforceLead,
  customEndpoint?: string,
): Promise<{ success: boolean; message: string; timestamp: string }> {
  // Simulate Salesforce REST API / Web-to-Lead or real webhook POST if URL provided
  if (customEndpoint && customEndpoint.startsWith('http')) {
    try {
      const res = await fetch(customEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
      });
      return {
        success: res.ok,
        message: res.ok
          ? `Dispatched successfully to ${customEndpoint} (HTTP ${res.status})`
          : `Remote endpoint returned HTTP ${res.status}`,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        message: `Network error reaching webhook: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Realistic Agentforce & Salesforce mock delivery confirmation
  await new Promise((r) => setTimeout(r, 650));
  return {
    success: true,
    message: `Salesforce Lead [${lead.Id}] committed. Agentforce intake trigger routed to queue: DSSG_NYC_TRIAGE.`,
    timestamp: new Date().toISOString(),
  };
}
