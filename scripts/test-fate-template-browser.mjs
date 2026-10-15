import { spawn } from 'node:child_process';
import console from 'node:console';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { chromium, expect } from '@playwright/test';

const [target, framework] = process.argv.slice(2);
if (!target || !['react', 'vue'].includes(framework)) {
  throw new Error('Usage: test-fate-template-browser.mjs <project> <react|vue>');
}

const portServer = createServer();
await new Promise((resolve, reject) => {
  portServer.once('error', reject);
  portServer.listen(0, '127.0.0.1', resolve);
});
const { port } = portServer.address();
await new Promise((resolve, reject) =>
  portServer.close((error) => (error ? reject(error) : resolve())),
);

const url = `http://localhost:${port}/`;
const projectRoot = resolve(target);
const hasBackend = existsSync(join(projectRoot, 'server'));
const servers = [];
let output = '';
let browser;
const startServer = (args, cwd, readyMessage, env = process.env) => {
  const server = spawn('vp', args, {
    cwd,
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    let serverOutput = '';
    const timeout = setTimeout(() => reject(new Error('Dev server did not start.')), 60_000);
    const onOutput = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      serverOutput += chunk;
      if (serverOutput.includes(readyMessage)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    server.stdout.on('data', onOutput);
    server.stderr.on('data', onOutput);
    server.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Dev server exited with code ${code}.`));
    });
  });
};
try {
  if (hasBackend) {
    await startServer(
      [
        'exec',
        'node',
        '--no-warnings',
        '--import',
        '@oxc-node/core/register',
        '--env-file',
        '.env',
        'src/index.tsx',
      ],
      join(projectRoot, 'server'),
      'Server running on port',
      { ...process.env, NODE_ENV: 'development', OXC_TSCONFIG_PATH: '../tsconfig.json' },
    );
  }
  await startServer(
    ['dev', '--port', String(port)],
    hasBackend ? join(projectRoot, 'client') : projectRoot,
    url,
  );
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.getByText('Latest posts', { exact: true })).toBeVisible({ timeout: 30_000 });

  if (framework === 'react') {
    await page.getByRole('link', { exact: true, name: 'Login' }).first().click();
    await page.locator('input[name=email]').fill('alex@example.com');
    await page.locator('input[name=password]').fill('password-alex');
    await page.getByRole('button', { exact: true, name: 'Sign In' }).click();
    await page.waitForURL(url);
    await expect(page.getByText('Logout', { exact: true })).toBeVisible();
    await expect(page.getByText('Latest posts', { exact: true })).toBeVisible({ timeout: 30_000 });

    const observer = await browser.newPage();
    observer.on('pageerror', (error) => errors.push(error.message));
    await observer.goto(url, { waitUntil: 'networkidle' });
    await expect(observer.getByText('Latest posts', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const comment = `Template browser test ${Date.now()}`;
    const input = page.getByPlaceholder('Share your thoughts...', { exact: true }).first();
    await input.fill(comment);
    await input.locator('..').getByRole('button', { exact: true, name: 'Post comment' }).click();
    await expect(input).toHaveValue('', { timeout: 30_000 });
    if (hasBackend) {
      await observer.reload({ waitUntil: 'networkidle' });
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await observer.getByText(comment, { exact: true }).isVisible()) {
          break;
        }
        const more = observer
          .getByRole('button', { exact: true, name: 'Load more comments' })
          .first();
        if (!(await more.isVisible())) {
          break;
        }
        await Promise.all([
          observer.waitForResponse((response) => /\/(fate|trpc|graphql)/.test(response.url())),
          more.click(),
        ]);
      }
    } else {
      await expect(page.getByText(comment, { exact: true })).toBeVisible({ timeout: 30_000 });
    }
    await expect(observer.getByText(comment, { exact: true })).toBeVisible({ timeout: 30_000 });
  } else {
    const posts = page.locator('article');
    await expect(posts).toHaveCount(10);
    await page.getByRole('button', { exact: true, name: 'Load more posts' }).click();
    await expect.poll(() => posts.count()).toBeGreaterThan(10);
    const firstPost = posts.first().getByRole('link');
    const title = await firstPost.innerText();
    await firstPost.click();
    await expect(page).toHaveURL(/\/post\//);
    await expect(posts).toHaveCount(1);
    await expect(posts.getByRole('link', { exact: true, name: title })).toBeVisible();
  }

  expect(errors).toEqual([]);
  console.log(`${framework} template browser checks passed.`);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  for (const server of servers) {
    if (!server.pid) {
      continue;
    }
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        console.error(error);
        process.exitCode = 1;
      }
    }
  }
}
