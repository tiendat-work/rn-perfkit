import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

// Load the BUILT package the way consumers do (CJS require from eslint.config.js).
const require = createRequire(__filename);
type Plugin = {
  meta: { name: string; version: string };
  rules: Record<string, { meta: { docs?: { description?: string; measured?: string } } }>;
  configs: Record<string, { plugins?: Record<string, unknown>; rules?: Record<string, unknown> }>;
};
const plugin = require('../dist/index.js') as Plugin;

describe('built plugin', () => {
  it('has meta and 6 rules, each with a description and a measured note', () => {
    expect(plugin.meta.name).toBe('eslint-plugin-react-native-perfkit');
    expect(Object.keys(plugin.rules)).toHaveLength(6);
    for (const [name, rule] of Object.entries(plugin.rules)) {
      expect(rule.meta.docs?.description, name).toBeTruthy();
      expect(rule.meta.docs?.measured, name).toBeTruthy();
    }
  });

  it('configs reference only existing rules and embed the plugin', () => {
    for (const cfg of Object.values(plugin.configs)) {
      for (const key of Object.keys(cfg.rules ?? {})) {
        expect(Object.keys(plugin.rules)).toContain(key.replace('react-native-perfkit/', ''));
      }
      expect(cfg.plugins?.['react-native-perfkit']).toBe(plugin);
    }
  });
});
