import React, { useState } from 'react';
import { searchNonprofit, formatEin } from '../../../lib/nonprofitLookup';
import { NonprofitLookupResult } from '../../../types';
import { motion } from 'motion/react';
import { Search, Loader2, CheckCircle2, AlertCircle, ArrowRight, SkipForward } from 'lucide-react';

interface LookupSectionProps {
  onComplete: (data: any, lookupResult?: NonprofitLookupResult) => void;
}

export default function LookupSection({ onComplete }: LookupSectionProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NonprofitLookupResult | null>(null);
  const [error, setError] = useState('');
  const [searchType, setSearchType] = useState<'url' | 'name' | 'ein'>('url');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const lookupQuery = {
        [searchType]: query,
      };
      const searchResult = await searchNonprofit(lookupQuery);

      if (searchResult) {
        setResult(searchResult);
      } else {
        setError('No organization found. Please verify the information and try again.');
      }
    } catch (err: any) {
      setError(err.message || 'Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (result) {
      onComplete(
        {
          orgName: result.orgName,
          orgType: result.orgType,
          orgEin: result.ein,
          orgIndustry: '',
          orgWebsite: result.website,
        },
        result
      );
    }
  };

  const handleSkip = () => {
    onComplete({}, undefined);
  };

  return (
    <div>
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-xl mb-4">
          <Search className="text-dssg-blue" size={24} />
        </div>
        <h2 className="text-2xl font-display font-bold text-dssg-blue tracking-tight mb-2">
          Find Your Organization
        </h2>
        <p className="text-slate-500 text-sm font-medium">
          Enter your nonprofit homepage, organization name, or EIN. We'll auto-fill your profile from public records.
        </p>
      </div>

      <form onSubmit={handleSearch} className="space-y-4 mb-6">
        <div className="flex gap-2 border-b border-slate-200">
          {(['url', 'name', 'ein'] as const).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setSearchType(type);
                setQuery('');
                setResult(null);
                setError('');
              }}
              className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 -mb-[2px] ${
                searchType === type
                  ? 'text-dssg-blue border-dssg-blue'
                  : 'text-slate-400 border-transparent hover:text-slate-600'
              }`}
            >
              {type === 'url' ? 'Homepage' : type === 'name' ? 'Organization Name' : 'EIN'}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              searchType === 'url'
                ? 'e.g. www.example-org.org'
                : searchType === 'name'
                ? 'e.g. Community Services Inc'
                : 'e.g. 12-3456789'
            }
            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-dssg-blue focus:border-transparent transition-all outline-none"
          />
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-red-600 text-[11px] font-bold bg-red-50 p-4 rounded-xl border border-red-100 flex gap-2"
          >
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        )}

        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="w-full py-3 bg-dssg-blue text-white rounded-xl font-bold hover:bg-dssg-blue-light transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Searching...
            </>
          ) : (
            <>
              <Search size={18} />
              Search
            </>
          )}
        </button>
      </form>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 mb-6"
        >
          <div className="flex gap-3 mb-4">
            <CheckCircle2 className="text-emerald-600 flex-shrink-0" size={20} />
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Organization Found</h3>
              <p className="text-slate-500 text-[11px] mt-1">Source: {result.source.toUpperCase()}</p>
            </div>
          </div>

          <div className="space-y-3 bg-white rounded-lg p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Organization Name</p>
              <p className="text-sm font-medium text-slate-800">{result.orgName}</p>
            </div>

            {result.ein && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">EIN</p>
                <p className="text-sm font-medium text-slate-800">{formatEin(result.ein)}</p>
              </div>
            )}

            {result.website && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Website</p>
                <p className="text-sm font-medium text-slate-800 truncate">{result.website}</p>
              </div>
            )}

            {result.mission && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mission</p>
                <p className="text-sm text-slate-700 line-clamp-2">{result.mission}</p>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={handleConfirm}
              className="flex-1 py-3 bg-dssg-orange text-white rounded-xl font-bold hover:bg-dssg-orange-light transition-all flex items-center justify-center gap-2"
            >
              Use This Info
              <ArrowRight size={18} />
            </button>
            <button
              onClick={() => setResult(null)}
              className="flex-1 py-3 bg-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-300 transition-all"
            >
              Search Again
            </button>
          </div>
        </motion.div>
      )}

      <button
        onClick={handleSkip}
        className="w-full py-3 text-dssg-blue font-bold hover:text-dssg-blue-light transition-colors flex items-center justify-center gap-2 text-sm"
      >
        <SkipForward size={16} />
        Skip Lookup • Enter Manually
      </button>
    </div>
  );
}
