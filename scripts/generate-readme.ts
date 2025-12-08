// scripts/build-readme.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';

const root = process.cwd();
const README = path.join(root, 'README.md');

const files = [
  'docs/parts/intro.md',
  'docs/guide/getting-started.md',
  'docs/guide/core-concepts.md',
  'docs/guide/views.md',
  'docs/guide/requests.md',
  'docs/guide/list-views.md',
  'docs/guide/actions.md',
  'docs/guide/server-integration.md',
  'docs/parts/outro.md',
].map((file) => path.join(root, file));

const shiftHeadings = (content: string) =>
  content.replaceAll(/^(#{1,6})\s+/gm, (match, hashes) => `${'#'.repeat(hashes.length + 1)} `);

const stripFrontmatter = (content: string) => {
  if (!content.startsWith('---\n')) {
    return content;
  }

  const end = content.indexOf('\n---', 4);
  return end === -1 ? content : content.slice(end + 4).replace(/^\n+/, '');
};

console.log(styleText('bold', `Generating README.md…\n`));

const segments = [];

for (const file of files) {
  let content = await fs.readFile(file, 'utf8');

  if (content.includes(`(/guide/getting-started)`)) {
    content = content
      .split('\n')
      .map((line) =>
        line.includes(`(/guide/getting-started)`)
          ? line.replaceAll(`(/guide/getting-started)`, `(/docs/guide/getting-started.md)`)
          : line,
      )
      .join('\n');
  }

  segments.push(shiftHeadings(stripFrontmatter(content).trim()));
}

const banner = '<!-- auto-generated from docs/guide/*.md. Do not edit directly. -->\n\n';

await fs.writeFile(README, banner + segments.join('\n\n') + '\n', 'utf8');

console.log(styleText('green', `  \u2713 'README.md' generated.`));
