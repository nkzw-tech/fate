import { defineConfig } from 'void/config';

export default defineConfig({
  auth: {
    providers: ['email'],
  },
  cloudflare: {
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
  worker: {
    compatibility_date: '2025-12-01',
    compatibility_flags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
  },
});
