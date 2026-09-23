import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CLI = join(__dirname, '..', 'dist', 'cli.js');
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 15000 });

describe('built cli', () => {
  it('prints help and exits 0', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('rn-perfkit doctor');
  });

  it('rejects unknown commands with exit 2', () => {
    const r = run('nope');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Unknown command');
  });

  it('fails clearly (exit 2) when Metro is unreachable', () => {
    const r = run('doctor', '--metro', 'http://127.0.0.1:1', '--no-android');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Cannot reach Metro/);
  });
});
