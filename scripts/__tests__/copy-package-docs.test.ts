import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';

const execFileAsync = promisify(execFile);

test('bundles guides and the matching API reference for every package that ships docs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fate-package-docs-'));
  try {
    const sources = [
      'api/fate/src/index.md',
      'api/@nkzw/fate/server/index.md',
      'api/react-fate/src/index.md',
      'api/vue-fate/index.md',
      'guide/getting-started.md',
      'guide/vue.md',
      'integrations/server.md',
    ];
    for (const source of sources) {
      const file = join(root, 'docs', source);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, '# Docs\n\n[Vue](/guide/vue#installation)\n[API](/api)\n');
    }

    await execFileAsync(process.execPath, [join(import.meta.dirname, '../copy-package-docs.ts')], {
      cwd: root,
      timeout: 30_000,
    });

    const packages = [
      ['fate', 'api/fate/src/index.md'],
      ['react-fate', 'api/react-fate/src/index.md'],
      ['vue-fate', 'api/vue-fate/index.md'],
    ] as const;
    for (const [packageDir, apiIndex] of packages) {
      const docs = join(root, 'packages', packageDir, 'docs');
      for (const file of ['index.md', 'api/index.md', apiIndex, ...sources.slice(4)]) {
        expect(existsSync(join(docs, file)), `${packageDir}/${file}`).toBe(true);
      }
      for (const index of ['index.md', 'api/index.md']) {
        for (const [, link] of readFileSync(join(docs, index), 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
          expect(
            existsSync(join(docs, dirname(index), link!)),
            `${packageDir}/${index}: ${link}`,
          ).toBe(true);
        }
      }
      expect(readFileSync(join(docs, 'guide/getting-started.md'), 'utf8')).toContain(
        '[Vue](vue.md#installation)',
      );
      expect(readFileSync(join(docs, 'guide/getting-started.md'), 'utf8')).toContain(
        '[API](../api/index.md)',
      );
    }
    expect(readFileSync(join(root, 'packages/vue-fate/docs/api/index.md'), 'utf8')).toContain(
      '[Vue](vue-fate/index.md)',
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
