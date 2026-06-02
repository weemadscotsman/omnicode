# OmniCode Docs Audit

Date: 2026-06-01

Purpose: classify the current Markdown files before packaging. This is a release-safety audit, not
a product claim.

## Summary

The docs folder is mixed. Some files are current OmniCode proof/spec material. Several files are
older generated positioning docs with stale tool names, stale benchmark wording, or claims that do
not match the current MCP-only package. Do not ship the whole folder as-is.

## Release-safe with minor copy cleanup

| File | Status | Why |
|---|---|---|
| `METHODOLOGY.md` | keep | Current byte-exact methodology. Includes selector policy and no-modeled-number disclosure. |
| `BENCHMARK_FINAL.md` | keep | Current selector-fixed benchmark claim and corrected aggregate. Needs fresh hostile-public matrix appended after that run exists. |
| `ANOMALIES.md` | keep | Explains the ghostlink zip selector bug and honest blindspot/anomaly interpretation. |
| `RESOLUTION_LEDGER_SPEC.md` | keep | Matches the current Zero Unknown Files framing and repair-handoff safety posture. |
| `BLINDSPOT_CLASSIFICATION_SPEC.md` | keep internal | Useful design history and shipped ledger notes, but marked draft/proposal and too noisy for public packaging. |

## Needs rewrite before release

| File | Problem | Action |
|---|---|---|
| `SECURITY.md` | Describes a Next.js HTTP surface, `lib/auth.ts`, `scripts/genkey.mjs`, hash-chain audit APIs, and JS/TS-only scan extensions. Those do not match this MCP package. | Rewrite around the real stdio MCP server, `src/security/rbac.ts`, `src/security/sandbox.ts`, `src/security/audit.ts`, `src/security/redact.ts`, compressed tool mode, and local-only indexing. |
| `USER_GUIDE.md` | Uses stale schema keys like `repoPath`, `filePath`, `target_symbol`; current tools use `path`, `file_path`, and `symbol_name`. Also omits compressed mode, `session_resume_brief`, `get_file_context`, `token-stats`, and `doctor`. | Rewrite as the main install/use doc. |
| `AGENT_HOOKS.md` | Tells agents to start with `index_project`; current trust-layer default should start with `session_resume_brief`, then lazy-load tools. Uses stale no-native-tool wording that is too absolute. | Rewrite to match compressed MCP mode and the real first-call policy. |
| `AGENT_INSTALL_UNIVERSAL.md` | Same stale tool order and old direct-tool assumption. Compressed mode hides most tools by default. | Rewrite around `list_tools`, `get_tool_schema`, `invoke_tool`, and `session_resume_brief`. |
| `ARCHITECTURE.md` | Older architecture doc. It mentions watcher-centric and Fuse-centric design, but not tool registry, compressed mode, session memory, output budget, resolution ledger, or benchmark child isolation. | Rewrite after release helpers are finished. |
| `TOKEN_SAVINGS.md` | Old high-level token-saving explanation. Not false as concept, but weaker than the current byte-exact methodology and selector-fixed benchmark. | Merge into README or replace with a short measured-token-savings doc. |
| `WHITEPAPER.md` | Contains lore-ish wording and outdated `2x-4x`/`95%-99%` claims that are weaker and less precise than current measured-byte claims. | Archive or rewrite later as serious public whitepaper. Do not ship as proof. |
| `BENCHMARK_METHODOLOGY.md` | Superseded by `METHODOLOGY.md`. Contains unsupported generic RAG comparison numbers and token-counter claims. | Archive or replace with a pointer to `METHODOLOGY.md`. |
| `COVERAGE_COMPLETE_BENCHMARK_V2.md` | Older proof doc still uses flat `99.9%`, estimated token framing, and old coverage run numbers. Superseded by `BENCHMARK_FINAL.md`. | Archive or mark historical. Do not use for public claim. |
| `AUDIT_AND_ROADMAP.md` | Older generated roadmap. Some gaps are now shipped (`get_call_hierarchy`, churn, token budget/output budget pieces), some are still useful future work (real embeddings, AST pattern search). Contains mojibake headings. | Extract remaining useful backlog only; do not ship as current roadmap. |
| `CLI_VS_MCP.md` | Short positioning doc. Not harmful, but not enough for release and omits compressed mode. | Merge into README or archive. |

## Root-level report files

| File | Status | Action |
|---|---|---|
| `OMNICODE_LARGE_REPO_BENCHMARK_V2_REPORT.md` | historical | Archive; it contains the old `99.9%` display behavior. |
| `OMNICODE_REPO_VISION_BLINDSPOT_FIX_REPORT.md` | historical/useful | Keep as internal changelog evidence or fold into release notes. Not a public proof doc. |

## Useful material to keep

- From `AUDIT_AND_ROADMAP.md`: real embeddings, `search_ast`, complexity/provenance, and broader parser packs are still legitimate backlog items.
- From `AGENT_HOOKS.md` / `AGENT_INSTALL_UNIVERSAL.md`: the idea that agents need explicit usage policy is valid, but the policy must be updated for compressed mode.
- From `WHITEPAPER.md`: "symbols, not chunks" is still the right positioning, but the prose needs to be sterile and measured.
- From `COVERAGE_COMPLETE_BENCHMARK_V2.md`: the GOTHAM/PURPCLAW coverage history is useful as internal history, not current public proof.

## Release packaging rule

For the first public package, ship only docs that are current and reproducible:

1. `README.md`
2. `docs/METHODOLOGY.md`
3. `docs/BENCHMARK_FINAL.md`
4. `docs/ANOMALIES.md`
5. `docs/RESOLUTION_LEDGER_SPEC.md`
6. rewritten `docs/SECURITY.md`
7. rewritten `docs/USER_GUIDE.md`
8. new `docs/RELEASE.md`

Everything else should either move to `docs/internal/` or be excluded from the npm package until
it is rewritten.
