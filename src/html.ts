import { createHash } from 'node:crypto';
import type { Diagnostic } from './core.js';
export interface ViewReport {
  status: string;
  diagnostics: Diagnostic[];
  acceptedDiagnostics?: Diagnostic[];
  baseline?: { stale: boolean; accepted: number };
}
const escape = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const css = `:root{color-scheme:light dark;--paper:#f5f7fb;--surface:#ffffff;--ink:#17243b;--muted:#45556d;--line:#bac5d5;--focus:#234fbb;--success:#175c3c;--warning:#764600;--error:#a12332;--s1:.5rem;--s2:1rem;--s3:1.5rem;--s4:2rem;--s5:3rem;--radius:.5rem;--body:system-ui,sans-serif;--mono:ui-monospace,monospace;--small:.875rem;--large:clamp(2rem,5vw,3rem)}
@media(prefers-color-scheme:dark){:root{--paper:#111b2b;--surface:#1b293e;--ink:#f1f5fc;--muted:#bfcee3;--line:#6d809c;--focus:#a6c3ff;--success:#8bdeb0;--warning:#f7ce85;--error:#ffa6b3}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.6 var(--body)}main{max-width:76rem;margin:auto;padding:var(--s5) var(--s3)}header{border-bottom:2px solid var(--line);padding-bottom:var(--s4);margin-bottom:var(--s4)}h1{font-size:var(--large);line-height:1.15;margin:var(--s2) 0}h2{font-size:var(--s3)}p{max-width:68ch}code{font-family:var(--mono);overflow-wrap:anywhere}ol{padding:0;list-style:none}li{padding:var(--s3);margin-bottom:var(--s2);background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow-wrap:anywhere}li p{margin-bottom:0}.js-code{font-size:var(--small);color:var(--muted)}.js-verdict{font-weight:650}.js-good{color:var(--success)}.js-warn{color:var(--warning)}.js-bad{color:var(--error)}summary{cursor:pointer;padding:var(--s2);min-height:44px}summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}footer{margin-top:var(--s5);color:var(--muted);font-size:var(--small)}@media(max-width:480px){main{padding:var(--s3) var(--s2)}}@media print{:root{color-scheme:light;--paper:white;--surface:white;--ink:black;--muted:#333;--line:#777;--success:black;--warning:black;--error:black}main{padding:0}li{break-inside:avoid}}
`;
const styleHash = createHash('sha256').update(css).digest('base64');
const labels: Record<string, [string, string]> = {
  valid: ['Document valid', 'The document satisfies this schema.'],
  invalid: [
    'Document rejected',
    'Resolve the diagnostics or review the contract.',
  ],
  unchanged: [
    'Contracts unchanged',
    'The schemas are structurally identical, ignoring object key order.',
  ],
  'potentially-breaking': [
    'Review required',
    'Changed constraints may reject existing callers. Review every finding before accepting it.',
  ],
  accepted: [
    'Findings accepted',
    'A matching baseline waives these findings. This does not prove compatibility.',
  ],
  error: [
    'Check could not complete',
    'Resolve the input or resource error, then run the check again.',
  ],
};
function findings(items: Diagnostic[]): string {
  return `<ol>${items.map((d) => `<li><code>${escape(d.path || '(root)')}</code><div class="js-code">${escape(d.code)}</div><p>${escape(d.message)}</p></li>`).join('')}</ol>`;
}
export function renderHtml(report: ViewReport, command: string): string {
  const [title, description] = Object.hasOwn(labels, report.status)
    ? labels[report.status]
    : labels.error;
  const tone = ['valid', 'unchanged'].includes(report.status)
    ? 'good'
    : report.status === 'invalid' || report.status === 'error'
      ? 'bad'
      : 'warn';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>JSON Statham — ${escape(title)}</title><style>${css}</style></head><body><main><header><p>JSON Statham / ${command === 'compare' ? 'Contract comparison' : command === 'validate' ? 'Document validation' : 'Contract check'}</p><h1>${escape(title)}</h1><p class="js-verdict js-${tone}">Status: ${escape(report.status)}</p><p>${escape(description)}</p></header>${report.baseline ? `<p class="js-verdict js-warn">${report.baseline.stale ? 'Baseline is stale. No findings are waived; review the changed contract pair.' : `Matching baseline. Accepted findings: ${report.baseline.accepted}. Waivers do not prove compatibility.`}</p>` : ''}<section aria-labelledby="active"><h2 id="active">Active diagnostics (${report.diagnostics.length})</h2>${report.diagnostics.length ? findings(report.diagnostics) : '<p>No active diagnostics.</p>'}</section>${report.acceptedDiagnostics?.length ? `<section aria-labelledby="accepted"><h2 id="accepted">Accepted diagnostics (${report.acceptedDiagnostics.length})</h2><p>Explicitly waived for this contract pair; retained for review.</p><details><summary>Show accepted findings</summary>${findings(report.acceptedDiagnostics)}</details></section>` : ''}<footer><p>Offline report. Input values and synthetic counterexamples are omitted. Diagnostic pointers can contain property names; review before sharing.</p><p>Generated by the deterministic CLI. A changed contract requires review even when findings are waived.</p></footer></main></body></html>`;
}
