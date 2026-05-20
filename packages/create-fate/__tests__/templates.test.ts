import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const builtinModules = new Set(['node:fs', 'node:path', 'node:url']);

const findViteConfigs = (dir: string): Array<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      return findViteConfigs(entryPath);
    }

    return entry.name === 'vite.config.ts' ? [entryPath] : [];
  });

const getPackageName = (specifier: string): string => {
  if (!specifier.startsWith('@')) {
    return specifier.split('/')[0]!;
  }

  return specifier.split('/').slice(0, 2).join('/');
};

const getViteConfigImports = (source: string): Array<string> =>
  Array.from(source.matchAll(/import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g), ([, specifier]) =>
    getPackageName(specifier!),
  ).filter((specifier) => !specifier.startsWith('.') && !builtinModules.has(specifier));

describe('create-fate templates', () => {
  test('do not resolve workspace-only source exports', () => {
    const viteConfigs = findViteConfigs(join(packageRoot, 'templates/fate'));

    expect(viteConfigs.length).toBeGreaterThan(0);

    for (const viteConfigPath of viteConfigs) {
      expect(readFileSync(viteConfigPath, 'utf8')).not.toContain('@nkzw/source');
    }
  });

  test('declare packages imported by root vite configs', () => {
    for (const template of readdirSync(join(packageRoot, 'templates/fate'), {
      withFileTypes: true,
    })) {
      if (!template.isDirectory()) {
        continue;
      }

      const templateRoot = join(packageRoot, 'templates/fate', template.name);
      const packageJson = JSON.parse(readFileSync(join(templateRoot, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      for (const specifier of getViteConfigImports(
        readFileSync(join(templateRoot, 'vite.config.ts'), 'utf8'),
      )) {
        expect
          .soft(dependencies, `${template.name} is missing ${specifier}`)
          .toHaveProperty(specifier);
      }
    }
  });

  test('keeps generated client modules out of dependency optimization', () => {
    const voidViteConfig = readFileSync(
      join(packageRoot, 'templates/fate/void/vite.config.ts'),
      'utf8',
    );

    expect(voidViteConfig).toContain("'@void/react'");
    expect(voidViteConfig).toContain("'@nkzw/fate/client'");
    expect(voidViteConfig).toContain("'react-fate/client'");
    expect(voidViteConfig).toContain("'void-fate/react'");
    expect(voidViteConfig).not.toContain('include:');
    expect(voidViteConfig).not.toContain("dedupe: ['react', 'react-dom']");
  });

  test('ships a gitignore for the Void template', () => {
    const voidGitignore = readFileSync(join(packageRoot, 'templates/fate/void/_gitignore'), 'utf8');

    expect(voidGitignore).toContain('node_modules/');
    expect(voidGitignore).toContain('.fate/');
    expect(voidGitignore).toContain('.void/');
  });

  test('ships a GraphQL client template for existing servers', () => {
    const templateRoot = join(packageRoot, 'templates/fate/graphql-client');
    const readme = readFileSync(join(templateRoot, 'README.md'), 'utf8');
    const viteConfig = readFileSync(join(templateRoot, 'vite.config.ts'), 'utf8');
    const fateManifest = readFileSync(join(templateRoot, 'src/fate/graphql.ts'), 'utf8');
    const packageJson = readFileSync(join(templateRoot, 'package.json'), 'utf8');

    expect(readme).toContain('existing GraphQL server');
    expect(viteConfig).toContain("module: './src/fate/graphql.ts'");
    expect(viteConfig).toContain("transport: 'graphql'");
    expect(fateManifest).toContain('export const Root');
    expect(fateManifest).toContain('export const fateGraphQL');
    expect(packageJson).not.toContain('@app/server');
  });
});
