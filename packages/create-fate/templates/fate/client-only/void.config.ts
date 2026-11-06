import { defineConfig } from 'void/config';

export default defineConfig({
  head: {
    htmlAttrs: { lang: 'en' },
    meta: [{ content: 'width=device-width, initial-scale=1', name: 'viewport' }],
    title: 'Tasks',
  },
  output: 'static',
  routing: { typedRoutes: true },
});
