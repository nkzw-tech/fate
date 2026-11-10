/**
 * Vite plugin for the fate devtools.
 *
 * Adds a "fate" panel to Vite DevTools and serves the same panel as a
 * standalone page at `/__fate-devtools/`.
 *
 * @example
 * import { fateDevtools } from '@nkzw/fate-devtools/vite';
 *
 * export default defineConfig({
 *   devtools: true,
 *   plugins: [fateDevtools()],
 * });
 *
 * @module @nkzw/fate-devtools/vite
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export type FateDevtoolsPluginOptions = Readonly<{
  /** Path the panel is served from. Defaults to `/__fate-devtools/`. */
  base?: string;
}>;

/**
 * The subset of the Vite DevTools Kit context this plugin uses. Declared here
 * so `@vitejs/devtools` stays an optional peer dependency.
 */
type DevToolsSetupContext = {
  docks: {
    register: (entry: {
      category?: string;
      icon: string;
      id: string;
      title: string;
      type: 'iframe';
      url: string;
    }) => unknown;
  };
};

export type FateDevtoolsPlugin = Plugin & {
  devtools: { setup: (context: DevToolsSetupContext) => void };
};

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// The fate app icon.
const icon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#3d87f5"/><text x="18" y="47" fill="white" font-family="Georgia,serif" font-style="italic" font-size="52">f</text></svg>',
)}`;

const findPanelDirectory = () => {
  const candidates = [
    // Published package: lib/vite.mjs next to lib/panel.
    new URL('./panel/', import.meta.url),
    // Workspace source: src/vite.ts next to the built lib/panel.
    new URL('../lib/panel/', import.meta.url),
  ];
  for (const candidate of candidates) {
    const directory = fileURLToPath(candidate);
    if (existsSync(join(directory, 'index.html'))) {
      return directory;
    }
  }
  return null;
};

/**
 * Registers the fate panel with Vite DevTools and serves it during development.
 */
export function fateDevtools({
  base = '/__fate-devtools/',
}: FateDevtoolsPluginOptions = {}): FateDevtoolsPlugin {
  const mountPath = base.endsWith('/') ? base : `${base}/`;

  return {
    apply: 'serve',
    configureServer(server) {
      const directory = findPanelDirectory();
      server.middlewares.use(async (request, response, next) => {
        const url = request.url?.split('?')[0];
        if (!url || (url !== mountPath.slice(0, -1) && !url.startsWith(mountPath))) {
          return next();
        }
        if (!directory) {
          response.statusCode = 500;
          response.end(
            'fate-devtools: The panel has not been built. Run `vp run build` in @nkzw/fate-devtools.',
          );
          return;
        }
        if (url === mountPath.slice(0, -1)) {
          response.statusCode = 302;
          response.setHeader('Location', mountPath);
          response.end();
          return;
        }
        const file = normalize(
          join(directory, decodeURIComponent(url.slice(mountPath.length)) || 'index.html'),
        );
        if (!file.startsWith(directory.endsWith(sep) ? directory : directory + sep)) {
          response.statusCode = 403;
          response.end();
          return;
        }
        try {
          const body = await readFile(existsSync(file) ? file : join(directory, 'index.html'));
          response.setHeader(
            'Content-Type',
            contentTypes[extname(file)] ?? 'application/octet-stream',
          );
          response.setHeader('Cache-Control', 'no-cache');
          response.end(body);
        } catch {
          next();
        }
      });
    },
    devtools: {
      setup(context) {
        context.docks.register({
          category: 'app',
          icon,
          id: 'fate',
          title: 'fate',
          type: 'iframe',
          url: mountPath,
        });
      },
    },
    name: 'fate:devtools',
  };
}
