# Knowledge — the DSSG second brain, in-repo

**Status:** PROPOSED — resolves the KB / `platform-api` question parked on Chronicle
**Date:** 2026-08-20
**Decides:** [design-system.md](../design-system.md) §6 "Knowledge base / `platform-api`";
[chronicle.md](chronicle.md) §Open questions (Q3)
**Supersedes for this repo:** the separate-service assumption carried in from prior
design work (see §7)
**Amended 2026-08-22:** three additions from the semantica/librarian parity analysis —
D39 (redaction log, §5), D40 (code-embedding storage, §8/§9), D41 (degraded-arm eval,
§7/§8). Source: `librarian/.claude/docs/research/2026-08-22_semantica-parity.md`.
The parity read **confirms** §1 and §7: semantica was evaluated as an alternative
substrate and rejected — its value is deterministic audit for regulated decisions, at the
cost of a graph store plus a vector store plus ~350 modules. §1's "a second deployable is
a second thing for a volunteer to host" applies with more force to a polyglot graph
platform. Postgres + pgvector + RRF stands.

---

## 1. The decision

**The knowledge layer is built into this repo as `src/knowledge/` plus `/api/knowledge-*`
functions. It is not a separate repository and not a separate service.**

This absorbs the KB workstream into Chronicle's orbit rather than rejecting it, and it
resolves the contradiction design-system.md §5 recorded: the KB workstream recommended a
third repository (`platform-api`), which contradicts the single-repo decision (§1).

The single-repo rule wins for the same reason it won in August: a second deployable is a
second thing for a six-month volunteer to host, monitor, and hand off. But the *reason*
the KB wanted its own repo — that it serves consumers beyond this portal — is real, and
§4 handles it without a second deployment.

### Why in-repo is not merely the cheap option

Three facts made the separate-service design necessary in the prior design, and all
three are already satisfied here:

| The prior design required | Already exists here |
|---|---|
| Supabase Postgres as substrate | `supabase/migrations/` — 8 migrations, live |
| RLS for multi-tenancy (gap 2) | `0003_tenancy.sql` — org-scoped, `user_org_ids()`, `force row level security` |
| A documents table with provenance | `0007_documents.sql` — source, classification, version, status, provenance |
| Auth on the retrieval API (gap 4) | Supabase Auth + Vercel Functions; `api/_env.ts`, `api/_http.ts` |

That design scoped a system that had to *build* all four. This repo has them.
Building the knowledge layer anywhere else means standing up a second Supabase project, a
second identity model, and a second RLS policy set — then keeping them in sync with these.

The remaining delta is genuinely small: **pgvector, chunks, embeddings, retrieval, and an
ingestion path.** That is a migration and a directory, not a repository.

---

## 2. The three assets

The prior design inherits a four-asset model from TencentDB-Agent-Memory (Chat Memory,
Skills, LLM-Wiki, CodeGraph). Chat Memory is already answered NO (decided 2026-08-18). The
remaining three map onto DSSG as:

| Asset | Holds | Substrate |
|---|---|---|
| **Knowledge** | Wiki prose, client engagement docs, Granola meeting summaries, decisions | `documents` + `document_chunks` |
| **Team** | Roles, repo ownership, shared skills, codemap pointers | `documents` with `classification='team'` |
| **Core** | Code structure — symbols, calls, impact paths, per repo | `code_symbols` + `code_edges` |

**Team is not a third table.** It is a classification of Knowledge documents. A registry
with one consumer is a folder (design-system.md §7's own rule for `src/skills/`), and Team
content — "who owns which repo, here is its codemap, here are the review dimensions" —
is prose about people and repos. It retrieves through the same path as everything else.
Splitting it into its own store buys a join and no capability.

**Core is a separate table** because its unit is not a document. A symbol has a name, a
kind, a file, a line range, and edges to other symbols. Forcing that into `documents`
means either losing the graph or encoding it in `provenance` JSON, and the whole point of
the prior design's decision (3) — structural indexing, not prose compilation — is that
the structure survives.

---

## 3. What the memory proxy was for, and why there isn't one

TencentDB ships a **MemoryProxy**: it sits in front of the LLM endpoint, speaks
`/v1/messages` and `/v1/chat/completions`, silently injects `tdai_memory_search` into the
tool list, and forwards the call to the real provider.

It exists because TencentDB cannot modify its clients. It targets Hermes, OpenClaw,
Cursor, and arbitrary OpenAI-compatible callers — agents whose tool definitions are not
under its control. Man-in-the-middle injection is the only way to add memory to an agent
someone else wrote.

**Every agent in this repo is one we write.** Scout, Architect, Pulse, Envoy, and
Chronicle have their tool lists defined in `src/agents/`. Adding retrieval is adding a
tool, not intercepting a protocol.

A proxy here would add a network hop on every model call, a fourth service to keep warm on
a free tier, and a new place for a model key to live — in exchange for a capability
(memory for third-party agents) that has no consumer. **There is no proxy.** The tool goes
in the tool list, and an MCP server (§4) covers the one genuinely external consumer.

---

## 4. Two consumers, one retrieval core

The KB workstream's instinct — that knowledge serves more than this portal — is right.
It just doesn't require a second deployment.

```
                    src/knowledge/retrieval.ts
                      (the only retrieval logic)
                              |
              +---------------+---------------+
              |                               |
    /api/knowledge-search              /api/mcp
    in-process, called by              HTTP MCP server, read-only,
    the five agents                    Claude Code / volunteers
```

- **`/api/knowledge-search`** — the agents' tool. Runs inside Vercel Functions alongside
  the agent that calls it. No extra hop.
- **`/api/mcp`** — a thin read-only MCP endpoint for volunteers in Claude Code. This is
  the prior design's decision (2) — *"MCP server is a thin read-only client of the
  indexer API"* — honored exactly: it holds no retrieval logic and never writes.

Both import `src/knowledge/retrieval.ts`. One implementation, two surfaces. This obeys
design-system.md §7's boundary rule: `src/knowledge/` is generic platform capability, so it
may not import from `src/agents/`, `src/services/`, or `src/app/` — which is also what
makes it extractable into `platform-api` later if a second product ever needs it.

---

## 5. Write path — Granola, and the read-only assumption it breaks

Everything in the prior design is read-only: its MCP layer *"never writes."* Granola meeting summaries arriving continuously as lifecycle updates is a
**write path**, and it is new surface.

### The ingestion contract

```
Granola  --webhook-->  /api/knowledge-ingest  -->  documents  -->  chunk+embed  -->  document_chunks
                              |
                       service-role key,
                       shared-secret verified,
                       org_id resolved from
                       the meeting's engagement
```

Four rules, all non-optional:

1. **Ingestion authenticates with a shared secret, not a user session.** A webhook has no
   `auth.uid()`, so RLS cannot scope it. The handler runs with the service-role key and
   sets `organization_id` explicitly from the engagement the meeting belongs to. This is
   the one place in the system where a bad `organization_id` is a leak rather than an
   error — it deserves a test, not a comment.
2. **Granola summaries ingest as documents, not as chat memory.** This keeps the OQ-1
   answer intact. Granola already produces the summary — we get the L1-equivalent
   artifact for free from a tool DSSG already pays for, with no LLM extraction cost and
   none of the multi-writer consolidation problem that made OQ-1 a NO.
3. **`source='external'`, `provenance` carries the Granola meeting id and timestamp.**
   `0007_documents.sql` already has both columns. Retrieval must be able to answer "where
   did this come from" without a second lookup.
4. **Redact before embedding, not after.** Client names and contact details are restricted
   material under the inherited data-classification rules. Once they are in an embedding they are not
   removable — an embedding is not reversible but it is also not redactable. Redaction is
   an ingestion-time transform.
5. **Redaction is logged per chunk — D39.** Rules 3 and 4 sit at different granularities:
   provenance is per *document*, redaction is per *span*. With only document-level
   provenance, the system cannot answer "which chunks were redacted, under which rule
   version, and what did the source say before?" — which is the question an audit asks.
   The log stores the rule id, span offsets, and timestamp, **never the redacted content**;
   it is a column, not an architecture. Without it a redaction is unauditable, and an
   unauditable redaction is indistinguishable from a missed one.

### This partially reopens OQ-1 — in the way the prior design predicted

The prior design sets the revisit trigger: *"when volunteers start asking 'what did we decide
last cohort, and why?' — i.e. when the missing artifact is a rationale that was never
written down."* Meeting notes are precisely that artifact.

The answer stays NO. We are not adding L1–L3 extraction. We are ingesting a summary that
already exists as a document. That is the "reopen at L0 capture first (no LLM cost)" path
the prior design names, and it is satisfied by the write path above.

---

## 6. Retrieval vs. push — the fork the agents force

Not every consumer wants RAG. Two access shapes, and building only the first is a mistake:

| Shape | Consumer | Mechanism |
|---|---|---|
| **Pull (RAG)** | A volunteer asks an open question; an agent needs context it cannot predict | `/api/knowledge-search` — hybrid retrieval, §7 |
| **Push (subscription)** | A lifecycle agent asks "what changed for this cohort this week?" | Supabase Realtime on `documents`, already published |

Pulse and Chronicle are push consumers. They run on a schedule against a known shape —
"new meeting notes for engagements in this org since last run." Making them embed a query
and search for something whose shape they already know is slower, lossier, and costs an
embedding call to rediscover a fact a `WHERE` clause knows exactly.

`0007_documents.sql` already does `alter publication supabase_realtime add table
documents`, and design-system.md §4 notes Realtime respects RLS. The push path is mostly
already built.

---

## 7. Retrieval design

Carried from the prior design's gap 3 and the TencentDB research (F6), adapted to
Postgres.

**Hybrid: `tsvector` + pgvector, fused with RRF.**

```
RRF(d) = Σ 1/(k + rank_i(d)),  k = 60
```

Two rationales, both concrete:

- **The current fixed blend is arbitrary.** The prior implementation hardcodes
  `0.5*text + 0.3*sem + 0.2*backlinks`. BM25 is unbounded, cosine is [-1,1] — they are not
  on comparable scales, so any fixed linear blend is a magic number. RRF is rank-based, so
  miscalibration between the channels does not matter.
- **Nobody will tune it.** The maintainer changes every six months. A blend with three
  weights to tune per-corpus is a blend nobody tunes.

**Three requirements carried from research (F7), each a real failure if skipped:**

1. **Pre-filter, never post-filter.** Post-filtering starves the candidate pool — recall@10
   falls 0.97 → 0.79 at 1% selectivity. RLS gives us pre-filtering by construction, which
   is the second reason to be glad the substrate is Postgres.
2. **Index every filter column.** An unindexed filter column means every query scans the
   corpus.
3. **Similarity search is inherently cross-tenant vulnerable.** A forgotten filter on an
   exact-match query returns *nothing*; on a similarity query it returns *another tenant's
   nearest neighbors*. The failure is silent and looks like a good result. This is why
   tenancy is enforced by RLS and not by a `WHERE` clause in application code.

**Degradation must announce itself in the return value.** A measured FTS cliff in the
prior implementation dropped MRR 0.905 → 0.295 while logging to a channel no consumer
read. Under rotating volunteers, degradation that does not surface is
indistinguishable from working. The retrieval response carries a `degraded` flag and an
index-freshness timestamp — this is also design-system.md §2's agent path contract rule 2,
*"failure is signalled, never simulated,"* applied to retrieval.

**The flag needs an eval arm to mean anything — D41.** The same measurement that produced
the 0.905 → 0.295 cliff also produced a paired baseline with FTS disabled
(`librarian/evals/baselines/live-nofts-baseline-*.json` beside `live-baseline-*.json`).
Gating only the nominal arm reports green in precisely the degraded state the flag was
invented to surface. Cost is one extra eval run; the pattern is already proven upstream.

---

## 8. What this needs that doesn't exist yet

Ordered. Items 1–2 are the whole substrate delta.

| # | Item | Notes |
|---|---|---|
| 1 | Migration `0008_knowledge.sql` — D37 | `pgvector` extension; `document_chunks`; `code_symbols`; `code_edges`; RLS mirroring `0007`'s org-scoping; `tsvector` generated column + GIN index; ivfflat index on the embedding. **Settle D40 first** — where symbol vectors live is a column in this migration, not a later tuning knob |
| 2 | `src/knowledge/` | `retrieval.ts` (hybrid + RRF), `chunk.ts`, `embed.ts`, `ingest.ts`. Obeys §7's boundary rule — imports nothing from `agents/`, `services/`, `app/` |
| 3 | `/api/knowledge-search` | Session-authed; RLS carries tenancy |
| 4 | `/api/knowledge-ingest` | Service-role; shared-secret verified; the §5 rules |
| 5 | `/api/mcp` | Read-only MCP surface over the same retrieval core |
| 6 | Codemap indexer — D30 | GitHub Action, scheduled. Ports the existing codemap indexer/parser as-is; the storage layer moves DuckDB → Postgres. The ported source keeps symbol vectors in a separate store (`tools/codemap/symbol_embeddings.py`), so the port must resolve D40 rather than inherit that split by default |
| 7 | Eval metric — D38 | design-system.md's rule: every agent path needs one. Retrieval's is recall@10 on a golden set |
| 8 | Degraded-arm eval — D41 | Gate recall@10 **twice**: nominal, and with FTS unavailable. See §7 — a single-arm gate reports green in exactly the condition the `degraded` flag exists to catch |

**Cost check.** Prior measurement of comparable live indexes projected the DSSG corpus
(~240 source files) at **25–30 MB — 5–6% of the 500 MB Supabase free tier.** The
hard-fit constraint is satisfied with ~15× headroom. Re-measure before a wide rollout
rather than re-deriving from that estimate.

**Known hazard, unsolved:** Supabase auto-pauses after 7 days idle and needs a manual
dashboard unpause. The scheduled indexing Action doubles as a keepalive, but the runbook
must name the unpause step. The prior design calls this a live risk; it stays live.

---

## 9. Open questions

- ~~**Which repo hosts this in production.**~~ **Closed 2026-08-21.** `nonprofit-success-ai`
  hosts it. This document scopes the work in this repo.
- **The prior design doc needs a reciprocal amendment.** It scopes a standalone service
  with its own Supabase project, and §1 above supersedes that for this repo. Its cited
  Supabase precedent also points at a path that does not exist — the conclusion holds, the
  citation is stale.
- **Granola's actual webhook contract is unverified.** §5 assumes a webhook with a meeting
  id and a resolvable engagement. Confirm before building `/api/knowledge-ingest`.
- **Chunking strategy is unspecified — but only half of it is deferrable.** Size and
  overlap for *prose* are tunable without a migration, as stated. **Code is not** — §2
  already decided the unit is a symbol by giving Core its own tables, so what remains is
  D40: whether symbol vectors live in `document_chunks` or beside `code_symbols`. That is
  one retrieval path or two, and §4's "one retrieval core" claim quietly depends on the
  answer. Migration-shaped; resolve before D37.
- **Team-asset authoring.** §2 says Team is a document classification, but nothing writes
  those documents yet. Manual authoring is the assumption; no path is designed.
