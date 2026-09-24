// Tempa Safety Pattern Library — public surface. Everything under
// lib/safety/patterns is pure (no I/O, no network) and owned by Tempa;
// classify.ts/indicators.ts import from here only.

export { analyzeSolicitations, type SolicitationFindings, type SolicitationHit, type FinancialKind, type AskKind } from './solicitation'
export { detectContactSharing, type ContactFindings, type ContactKind } from './contact'
export { isNotARequest, stripReportedQuotes } from './solicitation'
