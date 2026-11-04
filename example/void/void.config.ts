import { defineConfig } from 'void/config';

export default defineConfig({
  auth: {
    providers: ['email'],
  },
  cloudflare: {
    account_id: '004b3cabb810ff98895ea3a690f6ba00',
    compatibility_date: '2026-02-24',
    d1_databases: [
      {
        binding: 'DB',
        database_id: '7ebb25e6-7c27-4283-b9cc-bf5f8099d5d9',
        database_name: 'nkzw-fate-void-example-db',
        migrations_dir: './db/migrations',
      },
    ],
    durable_objects: {
      bindings: [
        {
          class_name: 'VoidLiveStreamDurableObject',
          name: 'VOID_LIVE',
        },
      ],
    },
    migrations: [
      {
        new_sqlite_classes: ['VoidLiveStreamDurableObject'],
        tag: 'live-v1',
      },
    ],
    name: 'nkzw-fate-void-example',
  },
  head: {
    htmlAttrs: {
      lang: 'en',
    },
    link: [{ href: '/icon.svg', rel: 'icon' }],
    meta: [
      { charset: 'utf8' },
      { content: 'width=device-width, initial-scale=1', name: 'viewport' },
    ],
    title: 'fate',
    titleTemplate: '%s | fate',
  },
  routing: { typedRoutes: true },
  worker: {
    compatibility_date: '2025-12-01',
    compatibility_flags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
  },
});
