import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Building2,
  CheckCircle2,
  Globe,
  Search,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  Database,
  Bot,
} from 'lucide-react';
import { verifyNonprofit501c3, normalizeEin, type Nonprofit501c3VerificationResult } from '../../lib/propublicaClient';
import { scrapeWebsiteContent, type WebsiteExtractionResult } from '../../lib/websiteScraper';
import { buildSalesforceLead, saveSalesforceLead, type SalesforceLead } from '../../lib/salesforceLead';
import SalesforceLeadModal from './SalesforceLeadModal';
import type { AppUser } from '../../lib/supabase';

interface NonprofitValidationGateProps {
  user: AppUser | null;
  onComplete: () => void;
  isDemo?: boolean;
}

export default function NonprofitValidationGate({
  user,
  onComplete,
}: NonprofitValidationGateProps) {
  // Input fields
  const [orgName, setOrgName] = useState('Uptown Youth Corps');
  const [ein, setEin] = useState('11-3489201');
  const [website, setWebsite] = useState('https://uptownyouthcorps.org');
  const [contactName, setContactName] = useState(user?.displayName || 'Maria Gonzalez');
  const [contactEmail, setContactEmail] = useState(user?.email || 'maria@uptownyouthcorps.org');

  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [propublicaMatch, setPropublicaMatch] = useState<Nonprofit501c3VerificationResult | null>(null);

  // Non-501c3 scraper state
  const [scraping, setScraping] = useState(false);
  const [scrapedData, setScrapedData] = useState<WebsiteExtractionResult | null>(null);
  const [manualMission, setManualMission] = useState('');
  const [manualCategory, setManualCategory] = useState('');
  const [manualScale, setManualScale] = useState('');

  // Salesforce & Agentforce state
  const [generatedLead, setGeneratedLead] = useState<SalesforceLead | null>(null);
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Quick preset test buttons
  const handleQuickPreset = (presetName: string, presetEin: string, presetUrl: string) => {
    setOrgName(presetName);
    setEin(presetEin);
    setWebsite(presetUrl);
    setValidationAttempted(false);
    setPropublicaMatch(null);
    setScrapedData(null);
    setGeneratedLead(null);
  };

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidating(true);
    setValidationAttempted(true);
    setPropublicaMatch(null);
    setScrapedData(null);
    setGeneratedLead(null);

    // 1. Check ProPublica & IRS 501(c)(3) registration
    const match = await verifyNonprofit501c3(ein, orgName);
    setValidating(false);

    if (match && match.is501c3) {
      // Branch A: Registered 501(c)(3) hit!
      setPropublicaMatch(match);
      setOrgName(match.name);

      // Auto-generate Salesforce Lead for 501(c)(3)
      const lead = buildSalesforceLead({
        orgName: match.name,
        contactName: contactName || 'Partner Representative',
        contactEmail: contactEmail || user?.email || 'contact@nonprofit.org',
        website,
        ein: match.strein,
        is501c3: true,
        category: match.nteeCategoryName || 'IRS 501(c)(3) Organization',
        mission: `${match.name} is an IRS-verified 501(c)(3) public charity based in ${match.city}, ${match.state}.`,
        annualRevenue: match.annualRevenue ?? undefined,
        assets: match.totalAssets ?? undefined,
        formYear: match.latestTaxYear ?? undefined,
      });

      saveSalesforceLead(lead);
      setGeneratedLead(lead);
    } else {
      // Branch B: Not registered for 501(c)(3) -> trigger website scraper for manual entry
      setPropublicaMatch(null);
      setScraping(true);

      const scraped = await scrapeWebsiteContent(website, orgName);
      setScraping(false);
      setScrapedData(scraped);
      setManualMission(scraped.suggestedMission);
      setManualCategory(scraped.suggestedCategory);
      setManualScale(scraped.suggestedScale);

      // Generate Salesforce Lead for Grassroots NGO
      const lead = buildSalesforceLead({
        orgName,
        contactName: contactName || 'Partner Representative',
        contactEmail: contactEmail || user?.email || 'contact@nonprofit.org',
        website,
        ein: ein.trim() || undefined,
        is501c3: false,
        category: scraped.suggestedCategory,
        mission: scraped.suggestedMission,
        scale: scraped.suggestedScale,
      });

      saveSalesforceLead(lead);
      setGeneratedLead(lead);
    }
  };

  const handleUpdateManualData = () => {
    if (!generatedLead) return;
    const updatedLead = buildSalesforceLead({
      orgName,
      contactName,
      contactEmail,
      website,
      ein: ein.trim() || undefined,
      is501c3: false,
      category: manualCategory,
      mission: manualMission,
      scale: manualScale,
    });
    saveSalesforceLead(updatedLead);
    setGeneratedLead(updatedLead);
  };

  const handleCompleteJourney = () => {
    setFinishing(true);
    setTimeout(() => {
      // Mark gate cleared in local storage
      if (user?.uid) {
        localStorage.setItem(`dssg_intake_gate_cleared_${user.uid}`, 'true');
      }
      localStorage.setItem('dssg_onboarding_completed', 'true');
      onComplete();
    }, 400);
  };

  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      {/* Salesforce Lead Payload Inspector Modal */}
      <SalesforceLeadModal
        isOpen={isLeadModalOpen}
        onClose={() => setIsLeadModalOpen(false)}
        lead={generatedLead}
      />

      <div className="max-w-3xl mx-auto space-y-8">
        {/* Onboarding Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-dssg-blue text-xs font-bold tracking-wide">
            <Building2 size={14} />
            <span>Organization Validation & Onboarding</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-dssg-blue tracking-tight">
            Partner Organization Intake
          </h1>
          <p className="text-slate-600 text-sm max-w-xl mx-auto leading-relaxed">
            We work with nonprofit charities and NGOs. If you are a registered 501(c)(3) Organization, please validate your organization by providing your organization name, EIN, and website.
          </p>
        </div>

        {/* Quick Test Presets */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">
            Test Sample Organizations:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleQuickPreset('Museum of Modern Art', '13-1628186', 'https://moma.org')}
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
            >
              MoMA (501c3 Hit)
            </button>
            <button
              type="button"
              onClick={() => handleQuickPreset('Harlem Children\'s Zone', '13-2679268', 'https://hcz.org')}
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
            >
              HCZ (501c3 Hit)
            </button>
            <button
              type="button"
              onClick={() => handleQuickPreset('East River Community Action', '99-9999999', 'https://eastrivercommunity.org')}
              className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-medium transition-colors border border-amber-200"
            >
              Grassroots NGO (Non-501c3)
            </button>
          </div>
        </div>

        {/* Step 1: Input Form */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl shadow-slate-200/50 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                1. Organization Identification
              </h2>
              <p className="text-xs text-slate-500">
                Provide your legal or operating nonprofit credentials
              </p>
            </div>
            <span className="text-[11px] font-bold text-dssg-blue bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
              IRS 501(c)(3) Gateway
            </span>
          </div>

          <form onSubmit={handleValidate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  Name of Organization <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. Uptown Youth Corps"
                    className="w-full text-xs pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  EIN (Employer Identification Number) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    required
                    value={ein}
                    onChange={(e) => setEin(normalizeEin(e.target.value))}
                    placeholder="XX-XXXXXXX"
                    className="w-full text-xs pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue font-mono transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5 sm:col-span-1">
                <label className="text-xs font-bold text-slate-700 block">
                  Website URL <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="url"
                    required
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://example.org"
                    className="w-full text-xs pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5 sm:col-span-1">
                <label className="text-xs font-bold text-slate-700 block">
                  Primary Contact Name
                </label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Your Name"
                  className="w-full text-xs px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue transition-all"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-1">
                <label className="text-xs font-bold text-slate-700 block">
                  Contact Email
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="contact@nonprofit.org"
                  className="w-full text-xs px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={validating || scraping}
              className="w-full py-3.5 px-6 bg-dssg-blue text-white rounded-xl text-xs font-bold hover:bg-dssg-blue-light transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/10 active:scale-[0.99] disabled:opacity-50"
            >
              {validating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Checking ProPublica & IRS Master File...</span>
                </>
              ) : (
                <>
                  <Search size={16} />
                  <span>Validate 501(c)(3) Organization Status</span>
                </>
              )}
            </button>
          </form>

          {/* Validation Result Sections */}
          {validationAttempted && !validating && (
            <div className="pt-6 border-t border-slate-100 space-y-6">
              {propublicaMatch ? (
                /* Branch A: 501(c)(3) Hit -> ProPublica Card */
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-5 rounded-2xl bg-emerald-50/60 border border-emerald-200 space-y-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <CheckCircle2 size={22} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-emerald-900">
                            IRS 501(c)(3) Registration Verified
                          </h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-200/60 text-emerald-800">
                            Subsection 501(c)(3)
                          </span>
                        </div>
                        <p className="text-xs text-emerald-700 mt-0.5">
                          ProPublica API matched filing records for <span className="font-semibold">{propublicaMatch.name}</span> ({propublicaMatch.city}, {propublicaMatch.state})
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Financial & Filing Data Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                    <div className="p-3 bg-white rounded-xl border border-emerald-100 shadow-sm">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Annual Revenue</span>
                      <span className="text-sm font-bold text-slate-800 font-mono block mt-0.5">
                        {propublicaMatch.annualRevenue ? `$${propublicaMatch.annualRevenue.toLocaleString()}` : 'N/A'}
                      </span>
                    </div>

                    <div className="p-3 bg-white rounded-xl border border-emerald-100 shadow-sm">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Assets</span>
                      <span className="text-sm font-bold text-slate-800 font-mono block mt-0.5">
                        {propublicaMatch.totalAssets ? `$${propublicaMatch.totalAssets.toLocaleString()}` : 'N/A'}
                      </span>
                    </div>

                    <div className="p-3 bg-white rounded-xl border border-emerald-100 shadow-sm">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Category (NTEE)</span>
                      <span className="text-xs font-bold text-slate-800 truncate block mt-0.5">
                        {propublicaMatch.nteeCategoryName || 'Public Charity'}
                      </span>
                    </div>

                    <div className="p-3 bg-white rounded-xl border border-emerald-100 shadow-sm">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Latest Form 990</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs font-bold text-slate-800 font-mono">
                          {propublicaMatch.latestTaxYear || 'Current'}
                        </span>
                        {propublicaMatch.pdfUrl && (
                          <a
                            href={propublicaMatch.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-600 hover:text-emerald-800"
                            title="View official 990 filing"
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                /* Branch B: Non-501(c)(3) -> Website Scraper & Manual Form */
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
                    <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-xs font-bold text-amber-900">
                        No 501(c)(3) IRS Record Found — Non-501(c)(3) NGO Track Active
                      </h3>
                      <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                        DSSG NYC partners with community initiatives, grassroots charities, and international NGOs. Our system scraped your website to extract your mission and nonprofit category below.
                      </p>
                    </div>
                  </div>

                  {/* Scraped Website Preview Card */}
                  {scrapedData && (
                    <div className="p-5 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-dssg-blue">
                          <Globe size={16} />
                          <span className="text-xs font-bold">
                            Website Scraped: {scrapedData.domain}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                          Auto-Extracted Data
                        </span>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-700 block">
                            Extracted Mission Statement (Editable)
                          </label>
                          <textarea
                            rows={3}
                            value={manualMission}
                            onChange={(e) => setManualMission(e.target.value)}
                            onBlur={handleUpdateManualData}
                            className="w-full text-xs p-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-700 block">
                              Nonprofit Category
                            </label>
                            <input
                              type="text"
                              value={manualCategory}
                              onChange={(e) => setManualCategory(e.target.value)}
                              onBlur={handleUpdateManualData}
                              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-700 block">
                              Operational Scale
                            </label>
                            <input
                              type="text"
                              value={manualScale}
                              onChange={(e) => setManualScale(e.target.value)}
                              onBlur={handleUpdateManualData}
                              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-dssg-blue"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Step 3: Salesforce & Agentforce Integration Card */}
              {generatedLead && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-5 rounded-2xl bg-slate-900 text-white space-y-4"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                        <Database size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-bold text-white">
                            Structured Salesforce & Agentforce Lead Created
                          </h3>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Synced
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Lead ID: <span className="font-mono text-slate-300">{generatedLead.Id}</span> · Status: {generatedLead.Status}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsLeadModalOpen(true)}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-blue-300 hover:text-white transition-all flex items-center gap-1.5 border border-slate-700"
                    >
                      <Bot size={14} />
                      <span>Inspect Payload & Test Webhook</span>
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-800 pt-3">
                    This organization lead is saved in a structured schema database formatted for Salesforce Lead sObjects and Agentforce AI routing. It is linked to your partner profile.
                  </p>
                </motion.div>
              )}

              {/* Complete Onboarding CTA */}
              {generatedLead && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleCompleteJourney}
                    disabled={finishing}
                    className="w-full py-4 px-6 bg-dssg-orange text-white rounded-xl text-xs font-bold hover:bg-dssg-orange-light transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-900/10 active:scale-[0.99]"
                  >
                    {finishing ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span>Confirm & Enter DSSG NYC Success Portal</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
