import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const [target, framework = 'react'] = process.argv.slice(2);
const root = resolve(target);
const frontend = existsSync(join(root, 'client')) ? join(root, 'client') : root;
const directory = mkdtempSync(join(frontend, '.route-check-'));
const hasPost = existsSync(join(frontend, 'pages/post'));
const hasLink = framework === 'react' && existsSync(join(frontend, 'src/ui/Link.tsx'));

try {
  writeFileSync(
    join(directory, 'routes.ts'),
    `import { routeUrl, type Href } from 'void/routes';
import { useParams } from '@void/${framework}';
${hasLink ? "import type { LinkProps } from '../src/ui/Link.tsx';" : ''}

export const home: Href = routeUrl('/');
// @ts-expect-error Unknown page URLs must be rejected.
export const missing: Href = '/missing-page';
// @ts-expect-error Unknown route patterns must be rejected.
useParams<'/missing-page/[id]'>();
${
  hasPost
    ? `
export const post: Href = routeUrl('/post/[id]', { params: { id: '123' } });
export function usePostParams() {
  return useParams<'/post/[id]'>();
}
export type PostParams = ReturnType<typeof usePostParams>;
export const params: PostParams = { id: '123' };
// @ts-expect-error Route parameter names must match the page.
export const wrongParams: PostParams = { slug: '123' };
// @ts-expect-error Dynamic routes require their parameters.
routeUrl('/post/[id]', { params: {} });
`
    : ''
}
${
  hasLink
    ? `
export const link: LinkProps = { to: '/' };
// @ts-expect-error The app's Link wrapper must preserve URL checking.
export const missingLink: LinkProps = { to: '/missing-page' };
`
    : ''
}
`,
  );
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { incremental: false, noEmit: true },
      extends: '../tsconfig.json',
      include: ['./routes.ts'],
    }),
  );
  execFileSync('vp', ['exec', 'tsc', '--project', join(directory, 'tsconfig.json')], {
    cwd: frontend,
    stdio: 'inherit',
  });
} finally {
  rmSync(directory, { force: true, recursive: true });
}
