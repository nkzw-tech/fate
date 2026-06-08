import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const templateNames = () =>
  readdirSync(join(packageRoot, 'templates/fate'), { withFileTypes: true })
    .filter((template) => template.isDirectory() && !template.name.startsWith('_'))
    .map((template) => template.name);

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
    const viteConfigs = findViteConfigs(join(packageRoot, 'templates/fate')).filter(
      (configPath) => !configPath.includes('/_shared/'),
    );

    expect(viteConfigs.length).toBeGreaterThan(0);

    for (const viteConfigPath of viteConfigs) {
      expect(readFileSync(viteConfigPath, 'utf8')).not.toContain('@nkzw/source');
    }
  });

  test('declare packages imported by root vite configs', () => {
    for (const templateName of templateNames()) {
      const templateRoot = join(packageRoot, 'templates/fate', templateName);
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
          .soft(dependencies, `${templateName} is missing ${specifier}`)
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

  test('generates Vue projects for every backend template', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'create-fate-vue-'));
    try {
      for (const templateName of templateNames()) {
        const target = join(tempRoot, templateName);
        const result = spawnSync(
          process.execPath,
          [
            join(packageRoot, 'bin/create-fate.mjs'),
            target,
            '--template',
            templateName,
            '--framework',
            'vue',
            '--no-setup',
          ],
          {
            cwd: tempRoot,
            encoding: 'utf8',
          },
        );

        expect.soft(result.status, result.stderr).toBe(0);

        const appRoot =
          templateName === 'void' || templateName === 'graphql-client'
            ? target
            : join(target, 'client');
        const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>;
          description?: string;
          devDependencies?: Record<string, string>;
          engines?: Record<string, string>;
          packageManager?: string;
          scripts?: Record<string, string>;
        };
        const dependencies = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
        const rootPackageJson = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>;
          description?: string;
          devDependencies?: Record<string, string>;
        };
        const rootDependencies = {
          ...rootPackageJson.dependencies,
          ...rootPackageJson.devDependencies,
        };
        const viteConfig = readFileSync(join(appRoot, 'vite.config.ts'), 'utf8');
        const layout = readFileSync(join(appRoot, 'pages/layout.vue'), 'utf8');
        const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8');
        const readme = readFileSync(join(target, 'README.md'), 'utf8');

        expect.soft(packageJson.description, templateName).toContain('Vue');
        expect.soft(packageJson.description, templateName).not.toContain('React');
        expect.soft(rootPackageJson.description, templateName).toContain('Vue');
        expect.soft(rootPackageJson.description, templateName).not.toContain('React');
        expect.soft(dependencies, templateName).toHaveProperty('vue');
        expect.soft(dependencies, templateName).toHaveProperty('vue-fate');
        expect.soft(dependencies, templateName).toHaveProperty('@void/vue');
        expect.soft(dependencies, templateName).not.toHaveProperty('react');
        expect.soft(dependencies, templateName).not.toHaveProperty('react-dom');
        expect.soft(dependencies, templateName).not.toHaveProperty('react-fate');
        expect.soft(dependencies, templateName).not.toHaveProperty('@void/react');
        expect.soft(dependencies, templateName).not.toHaveProperty('@nkzw/stack');
        expect.soft(dependencies, templateName).not.toHaveProperty('@rolldown/plugin-babel');
        expect
          .soft(rootDependencies, templateName)
          .not.toHaveProperty('babel-plugin-react-compiler');
        expect.soft(rootDependencies, templateName).not.toHaveProperty('eslint-plugin-react-hooks');
        expect.soft(viteConfig, templateName).toContain("from 'vue-fate/vite'");
        expect.soft(viteConfig, templateName).toContain("from '@void/vue/plugin'");
        expect.soft(viteConfig, templateName).not.toContain(';;');
        expect.soft(layout, templateName).not.toContain(';;');
        expect.soft(layout, templateName).not.toContain('\n;\n');
        expect.soft(readme, templateName).toContain(`--template ${templateName} --framework vue`);
        expect.soft(readme, templateName).toContain('Vue');
        expect.soft(readme, templateName).not.toContain('react-fate');
        expect.soft(readme, templateName).not.toContain('React Compiler');
        expect.soft(agents, templateName).toContain('Vue applications');
        expect.soft(agents, templateName).toContain('vue-fate');
        expect.soft(agents, templateName).not.toContain('React applications');
        expect.soft(agents, templateName).not.toContain('React Actions');
        expect.soft(agents, templateName).not.toContain('Async React');
        expect.soft(agents, templateName).not.toContain('react-fate');
        expect
          .soft(readFileSync(join(appRoot, 'pages/index.vue'), 'utf8'), templateName)
          .toContain('useRequest');

        expect(() => readFileSync(join(appRoot, 'pages/index.tsx'), 'utf8')).toThrow();

        if (templateName === 'void') {
          const seedData = readFileSync(join(target, 'seedData.ts'), 'utf8');
          const seedMigration = readFileSync(
            join(target, 'db/migrations/20260508120500_seed_void_demo.sql'),
            'utf8',
          );

          expect
            .soft(readFileSync(join(target, 'src/fate/server.ts'), 'utf8'))
            .toContain('createFateServer');
          expect
            .soft(readFileSync(join(target, 'src/fate/context.ts'), 'utf8'))
            .toContain('../user/SessionUser.ts');
          expect
            .soft(readFileSync(join(target, 'src/fate/context.ts'), 'utf8'))
            .not.toContain('../user/SessionUser.tsx');
          expect.soft(seedData).toContain('Vue Integration');
          expect.soft(seedData).toContain('vue-fate');
          expect.soft(seedData).not.toContain('React');
          expect.soft(seedData).not.toContain('react-fate');
          expect.soft(seedMigration).toContain('Vue Integration');
          expect.soft(seedMigration).toContain('vue-fate');
          expect.soft(seedMigration).not.toContain('React');
          expect.soft(seedMigration).not.toContain('react-fate');
        }

        if (templateName === 'graphql-client') {
          expect.soft(packageJson.dependencies, templateName).toHaveProperty('@nkzw/fate');
          expect.soft(packageJson.scripts, templateName).toHaveProperty('test:all');
          expect.soft(packageJson.engines, templateName).toHaveProperty('node');
          expect.soft(packageJson.packageManager, templateName).toBeTruthy();
          expect
            .soft(readFileSync(join(target, 'src/fate/graphql.ts'), 'utf8'), templateName)
            .toContain('fateGraphQL');
        }
      }
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  test('uses React as the default UI framework', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'create-fate-default-'));
    try {
      const target = join(tempRoot, 'app');
      const result = spawnSync(
        process.execPath,
        [join(packageRoot, 'bin/create-fate.mjs'), target, '--template', 'http', '--no-setup'],
        {
          cwd: tempRoot,
          encoding: 'utf8',
        },
      );

      expect(result.status, result.stderr).toBe(0);

      const packageJson = JSON.parse(readFileSync(join(target, 'client/package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };

      expect(packageJson.dependencies).toHaveProperty('react');
      expect(packageJson.dependencies).toHaveProperty('react-fate');
      expect(packageJson.dependencies).not.toHaveProperty('vue');
      expect(packageJson.dependencies).not.toHaveProperty('vue-fate');
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});
