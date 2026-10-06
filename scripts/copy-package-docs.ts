import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const root = process.cwd();

const packages = [
  {
    api: [
      { index: 'fate/src/index.md', path: 'fate', title: 'Client' },
      { index: '@nkzw/fate/server/index.md', path: '@nkzw/fate', title: 'Server' },
    ],
    name: '@nkzw/fate',
    target: 'packages/fate/docs',
  },
  {
    api: [{ index: 'react-fate/src/index.md', path: 'react-fate', title: 'React' }],
    name: 'react-fate',
    target: 'packages/react-fate/docs',
  },
  {
    api: [{ index: 'vue-fate/index.md', path: 'vue-fate', title: 'Vue' }],
    name: 'vue-fate',
    target: 'packages/vue-fate/docs',
  },
] as const;

const assertDirectory = (path: string) => {
  if (!existsSync(path)) {
    throw new Error(`Missing docs directory: ${path}`);
  }
};

const toMarkdownPath = (fromDirectory: string, targetPath: string) =>
  relative(fromDirectory, targetPath).replaceAll('\\', '/');

const markdownFiles = (directory: string): Array<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return markdownFiles(path);
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });

// TypeDoc can document a shared export under another entry point. Keep those
// linked pages, including their own references, available in each npm bundle.
const copyApiReferences = (targetRoot: string) => {
  const files = markdownFiles(targetRoot);
  for (const file of files) {
    for (const [, link] of readFileSync(file, 'utf8').matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
      if (!link || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(link)) {
        continue;
      }
      const target = resolve(dirname(file), link);
      const apiPath = toMarkdownPath(targetRoot, target);
      if (apiPath.startsWith('../') || isAbsolute(apiPath) || existsSync(target)) {
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, 'docs/api', apiPath), target);
      files.push(target);
    }
  }
};

const rewriteDocsLinks = (targetRoot: string, directory = targetRoot) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      rewriteDocsLinks(targetRoot, path);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const fromDirectory = dirname(relative(targetRoot, path));
    const content = readFileSync(path, 'utf8')
      .replaceAll(
        /\(\/(guide|integrations)\/([^)#]+?)(#[^)]+?)?\)/g,
        (_match, section: string, slug: string, hash = '') =>
          `(${toMarkdownPath(fromDirectory, join(section, `${slug}.md`))}${hash})`,
      )
      .replaceAll(/\(\/api([^)#]*)(#[^)]+?)?\)/g, (_match, suffix: string, hash = '') => {
        const apiPath = suffix ? join('api', suffix) : 'api/index.md';
        return `(${toMarkdownPath(fromDirectory, apiPath)}${hash})`;
      });
    writeFileSync(path, content);
  }
};

for (const packageDocs of packages) {
  const guideSource = join(root, 'docs/guide');
  const integrationsSource = join(root, 'docs/integrations');
  const target = join(root, packageDocs.target);

  for (const api of packageDocs.api) {
    assertDirectory(join(root, 'docs/api', api.path));
  }
  assertDirectory(guideSource);
  assertDirectory(integrationsSource);

  rmSync(target, { force: true, recursive: true });
  mkdirSync(target, { recursive: true });

  for (const api of packageDocs.api) {
    cpSync(join(root, 'docs/api', api.path), join(target, 'api', api.path), {
      recursive: true,
    });
  }
  copyApiReferences(join(target, 'api'));
  cpSync(guideSource, join(target, 'guide'), { recursive: true });
  cpSync(integrationsSource, join(target, 'integrations'), { recursive: true });
  writeFileSync(
    join(target, 'api/index.md'),
    `# ${packageDocs.name} API\n\n${packageDocs.api.map(({ index, title }) => `- [${title}](${index})`).join('\n')}\n`,
  );
  rewriteDocsLinks(target);

  writeFileSync(
    join(target, 'index.md'),
    `# ${packageDocs.name} Docs

- [Guides](guide/getting-started.md)
- [Integrations](integrations/server.md)
- [API Reference](api/index.md)
`,
  );

  console.log(`Copied docs for ${packageDocs.name} to ${packageDocs.target}`);
}
