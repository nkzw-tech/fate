import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const packages = [
  {
    api: 'docs/api/@nkzw/fate',
    name: '@nkzw/fate',
    target: 'packages/fate/docs',
  },
  {
    api: 'docs/api/react-fate',
    name: 'react-fate',
    target: 'packages/react-fate/docs',
  },
] as const;

const assertDirectory = (path: string) => {
  if (!existsSync(path)) {
    throw new Error(`Missing docs directory: ${path}`);
  }
};

const rewriteGuideLinks = (directory: string) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      rewriteGuideLinks(path);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const content = readFileSync(path, 'utf8')
      .replaceAll(/\(\/guide\/([^)#]+?)(#[^)]+?)?\)/g, '($1.md$2)')
      .replaceAll('(/api', '(../api');
    writeFileSync(path, content);
  }
};

for (const packageDocs of packages) {
  const apiSource = join(root, packageDocs.api);
  const guideSource = join(root, 'docs/guide');
  const target = join(root, packageDocs.target);

  assertDirectory(apiSource);
  assertDirectory(guideSource);

  rmSync(target, { force: true, recursive: true });
  mkdirSync(target, { recursive: true });

  cpSync(apiSource, join(target, 'api'), { recursive: true });
  cpSync(guideSource, join(target, 'guide'), { recursive: true });
  rewriteGuideLinks(join(target, 'guide'));

  writeFileSync(
    join(target, 'index.md'),
    `# ${packageDocs.name} Docs

- [Guides](guide/getting-started.md)
- [API Reference](api/index.md)
`,
  );

  console.log(`Copied docs for ${packageDocs.name} to ${packageDocs.target}`);
}
