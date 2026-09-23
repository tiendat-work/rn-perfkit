/** Report rendering: human text (default) or JSON (--json). */
import type { Finding, Status } from './checks';

export type Report = {
  tool: string;
  version: string;
  createdAt: string;
  target: { title: string; appId?: string; deviceName?: string; platform?: 'ios' | 'android' | 'unknown' };
  findings: Finding[];
  raw: Record<string, unknown>;
};

const ICON: Record<Status, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO', skip: 'SKIP' };

function color(s: Status, text: string, useColor: boolean): string {
  if (!useColor) return text;
  const c = { pass: 32, warn: 33, fail: 31, info: 36, skip: 90 }[s];
  return `\u001b[${c}m${text}\u001b[0m`;
}

export function exitCode(findings: Finding[], failOn: 'fail' | 'warn' | 'never'): number {
  if (failOn === 'never') return 0;
  if (findings.some((f) => f.status === 'fail')) return 1;
  if (failOn === 'warn' && findings.some((f) => f.status === 'warn')) return 1;
  return 0;
}

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.map((l) => indent + l).join('\n');
}

export function renderText(r: Report, useColor = false): string {
  const out: string[] = [];
  out.push(`rn-perfkit doctor ${r.version} — ${r.target.title}`);
  out.push('');
  for (const f of r.findings) {
    out.push(`${color(f.status, ICON[f.status], useColor)}  ${f.title}${f.value ? `: ${f.value}` : ''}`);
    if (f.advice) out.push(wrap(f.advice, 92, '      '));
  }
  const counts = r.findings.reduce<Record<string, number>>((m, f) => ((m[f.status] = (m[f.status] ?? 0) + 1), m), {});
  out.push('');
  out.push(
    `Summary: ${counts.fail ?? 0} fail, ${counts.warn ?? 0} warn, ${counts.pass ?? 0} pass` +
      (counts.skip ? `, ${counts.skip} skipped` : ''),
  );
  return out.join('\n');
}
