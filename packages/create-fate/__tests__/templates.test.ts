import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const findViteConfigs = (dir: string): Array<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      return findViteConfigs(entryPath);
    }

    return entry.name === 'vite.config.ts' ? [entryPath] : [];
  });

describe('create-fate templates', () => {
  test('do not resolve workspace-only source exports', () => {
    const viteConfigs = findViteConfigs(join(packageRoot, 'templates/fate'));

    expect(viteConfigs.length).toBeGreaterThan(0);

    for (const viteConfigPath of viteConfigs) {
      expect(readFileSync(viteConfigPath, 'utf8')).not.toContain('@nkzw/source');
    }
  });

  test('keeps the Void template Vite config light', () => {
    const voidViteConfig = readFileSync(
      join(packageRoot, 'templates/fate/void/vite.config.ts'),
      'utf8',
    );

    expect(voidViteConfig).not.toContain("'react-fate/client'");
    expect(voidViteConfig).not.toContain("'void-fate/react'");
    expect(voidViteConfig).not.toContain("dedupe: ['react', 'react-dom']");
  });

  test('ships a gitignore for the Void template', () => {
    const voidGitignore = readFileSync(join(packageRoot, 'templates/fate/void/_gitignore'), 'utf8');

    expect(voidGitignore).toContain('node_modules/');
    expect(voidGitignore).toContain('.fate/');
    expect(voidGitignore).toContain('.void/');
  });
});
