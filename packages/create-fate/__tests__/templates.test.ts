import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

const execFileAsync = promisify(execFile);
const packageRoot = dirname(import.meta.dirname);
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
  const registryVersions = new Map([
    ['@nkzw/fate', '1.2.3'],
    ['react-fate', '2.3.4'],
    ['void-fate', '3.4.5'],
    ['vue-fate', '4.5.6'],
  ]);
  const registry = createServer((request, response) => {
    const packageName = decodeURIComponent(request.url!.slice(1));
    const version = registryVersions.get(packageName);
    response.writeHead(version ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(version ? { 'dist-tags': { latest: version } } : {}));
  });
  let registryURL: string;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      registry.once('error', reject);
      registry.listen(0, '127.0.0.1', resolve);
    });
    const address = registry.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the test registry to listen on a TCP port.');
    }
    registryURL = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      registry.close((error) => (error ? reject(error) : resolve()));
    });
  });

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

  test('applies the Void auth migrations without losing seeded data', () => {
    const migrationsRoot = join(packageRoot, 'templates/fate/void/db/migrations');
    const journal = JSON.parse(
      readFileSync(join(migrationsRoot, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const database = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: false });

    try {
      database.exec('PRAGMA foreign_keys = ON');
      const data = () =>
        ['user', 'account', 'Post', 'Comment'].map((table) =>
          database.prepare(`SELECT id FROM "${table}" ORDER BY id`).all(),
        );

      for (const { tag } of journal.entries.slice(0, -1)) {
        database.exec(readFileSync(join(migrationsRoot, `${tag}.sql`), 'utf8'));
      }
      const seededData = data();
      for (const rows of seededData) {
        expect(rows.length).toBeGreaterThan(0);
      }

      database.exec(
        readFileSync(join(migrationsRoot, `${journal.entries.at(-1)!.tag}.sql`), 'utf8'),
      );

      expect(data()).toEqual(seededData);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(database.prepare('SELECT impersonatedBy FROM session').all()).toEqual([]);
      expect(
        database
          .prepare(
            'SELECT id, identifier, value, expiresAt, createdAt, updatedAt FROM verification',
          )
          .all(),
      ).toEqual([]);
    } finally {
      database.close();
    }
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

  test.each(['react', 'vue'])(
    'generates a GraphQL %s client with the Void environment schema',
    async (framework) => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'create-fate-graphql-env-'));
      try {
        const target = join(tempRoot, 'app');
        await execFileAsync(
          process.execPath,
          [
            join(packageRoot, 'bin/create-fate.mjs'),
            target,
            '--template',
            'graphql-client',
            '--framework',
            framework,
            '--no-setup',
          ],
          {
            cwd: tempRoot,
            encoding: 'utf8',
            env: { ...process.env, npm_config_registry: registryURL },
            timeout: 30_000,
          },
        );

        expect(existsSync(join(target, '.env.example'))).toBe(false);
        expect(readFileSync(join(target, 'env.ts'), 'utf8')).toBe(
          readFileSync(join(packageRoot, 'templates/fate/graphql-client/env.ts'), 'utf8'),
        );
        expect(readFileSync(join(target, '.gitignore'), 'utf8')).toContain('.env');
        expect(readFileSync(join(target, 'vite.config.ts'), 'utf8')).not.toContain('dotenv');
      } finally {
        rmSync(tempRoot, { force: true, recursive: true });
      }
    },
    30_000,
  );

  test.each(templateNames())('points React agents to bundled docs for %s', async (templateName) => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'create-fate-react-docs-'));
    try {
      const target = join(tempRoot, 'app');
      await execFileAsync(
        process.execPath,
        [
          join(packageRoot, 'bin/create-fate.mjs'),
          target,
          '--template',
          templateName,
          '--no-setup',
        ],
        {
          cwd: tempRoot,
          encoding: 'utf8',
          env: { ...process.env, npm_config_registry: registryURL },
          timeout: 30_000,
        },
      );

      const docsDir =
        templateName === 'void' || templateName === 'graphql-client'
          ? 'node_modules/react-fate/docs/'
          : 'client/node_modules/react-fate/docs/';
      const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8');
      expect(agents).toContain(`\`${docsDir}\``);
      expect(agents).toContain('`index.md`');
      expect(agents).not.toContain('react-fate/README.md');
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  test('generates Vue projects for every backend template', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'create-fate-vue-'));
    try {
      for (const templateName of templateNames()) {
        const target = join(tempRoot, templateName);
        await execFileAsync(
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
            env: { ...process.env, npm_config_registry: registryURL },
            timeout: 30_000,
          },
        );

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

        expect
          .soft(packageJson.description, templateName)
          .toBe('fate is a modern data client for the web.');
        expect
          .soft(rootPackageJson.description, templateName)
          .toBe('fate is a modern data client for the web.');
        expect.soft(dependencies, templateName).toHaveProperty('vue');
        expect.soft(dependencies['vue-fate'], templateName).toBe('^4.5.6');
        expect.soft(dependencies, templateName).toHaveProperty('@void/vue');
        expect.soft(dependencies, templateName).not.toHaveProperty('react');
        expect.soft(dependencies, templateName).not.toHaveProperty('react-dom');
        expect.soft(dependencies, templateName).not.toHaveProperty('react-fate');
        expect.soft(dependencies, templateName).not.toHaveProperty('@void/react');
        expect.soft(dependencies, templateName).not.toHaveProperty('@nkzw/stack');
        expect.soft(dependencies, templateName).not.toHaveProperty('@rolldown/plugin-babel');
        expect.soft(dependencies, templateName).not.toHaveProperty('fbtee');
        expect.soft(JSON.stringify(packageJson.scripts), templateName).not.toContain('fbtee');
        expect
          .soft(existsSync(join(appRoot, 'src/lib/LocaleContext.tsx')), templateName)
          .toBe(false);
        if (templateName === 'void') {
          expect.soft(dependencies['void-fate'], templateName).toBe('^3.4.5');
          expect.soft(packageJson.scripts?.['dev:setup'], templateName).toContain('db:seed');
        }
        expect.soft(dependencies, templateName).not.toHaveProperty('@nkzw/fbtee-compiler');
        expect.soft(dependencies, templateName).not.toHaveProperty('@nkzw/vite-plugin-fbtee');
        expect.soft(dependencies, templateName).not.toHaveProperty('oxc-transform-react');
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
        const docsDir =
          templateName === 'void' || templateName === 'graphql-client'
            ? 'node_modules/vue-fate/docs/'
            : 'client/node_modules/vue-fate/docs/';
        expect.soft(agents, templateName).toContain(`\`${docsDir}\``);
        expect.soft(agents, templateName).toContain('`index.md`');
        expect.soft(agents, templateName).toContain('`guide/vue.md`');
        expect.soft(agents, templateName).not.toContain('vue-fate/README.md');
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
          expect.soft(dependencies['@nkzw/fate'], templateName).toBe('^1.2.3');
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
  }, 180_000);

  test.each(['http', 'void'])(
    'uses React as the default UI framework for %s',
    async (template) => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'create-fate-default-'));
      try {
        const target = join(tempRoot, 'app');
        await execFileAsync(
          process.execPath,
          [
            join(packageRoot, 'bin/create-fate.mjs'),
            target,
            ...(template === 'void' ? [] : ['--template', template]),
            '--no-setup',
          ],
          {
            cwd: tempRoot,
            encoding: 'utf8',
            env: { ...process.env, npm_config_registry: registryURL },
            timeout: 30_000,
          },
        );

        const appRoot = template === 'void' ? target : join(target, 'client');
        const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>;
        };

        expect(packageJson.dependencies).toHaveProperty('react');
        expect(packageJson.dependencies?.['react-fate']).toBe('^2.3.4');
        expect(packageJson.dependencies).not.toHaveProperty('vue');
        expect(packageJson.dependencies).not.toHaveProperty('vue-fate');
        if (template === 'void') {
          expect(packageJson.dependencies?.['void-fate']).toBe('^3.4.5');
          expect(readFileSync(join(appRoot, 'vite.config.ts'), 'utf8')).toContain(
            "transport: 'void'",
          );
        }
      } finally {
        rmSync(tempRoot, { force: true, recursive: true });
      }
    },
    30_000,
  );
});
