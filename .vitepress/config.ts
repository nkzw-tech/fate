import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitepress';
import apiItems from '../docs/api/typedoc-sidebar.json';
import pkg from '../packages/fate/package.json' with { type: 'json' };
import dunkel from './theme/dunkel.json';
import licht from './theme/licht.json';

const origin = 'https://fate.technology';
const nkzwLogo = readFileSync(join(import.meta.dirname, './nkzw-logo.svg'), 'utf8');

export default defineConfig({
  cleanUrls: true,
  description: 'A Modern React Data Framework',
  head: [
    ['link', { href: '/icon.svg', rel: 'icon' }],
    ['meta', { content: `${origin}/og-image.png`, name: 'og:image' }],
  ],
  markdown: {
    theme: {
      dark: dunkel,
      // @ts-expect-error
      light: licht,
    },
  },
  rewrites: {
    'docs/:path*': ':path*',
  },
  sitemap: {
    hostname: 'https://fate.technology',
  },
  srcExclude: ['docs/parts/**.', 'packages/**/README.md', '/README.md'],
  themeConfig: {
    footer: {
      copyright: `Copyright © 2025-present Nakazawa Tech`,
      message: `Released under the MIT License`,
    },
    logo: {
      dark: '/fate-logo-dark.svg',
      light: '/fate-logo.svg',
    },
    nav: [
      { link: '/', text: 'Home' },
      { link: '/guide/getting-started', text: 'Guide' },
      { link: '/api', text: 'API' },
      { link: '/posts/introducing-fate', text: 'Blog' },
      {
        items: [
          {
            link: 'https://github.com/nkzw-tech/fate/blob/main/CHANGELOG.md',
            text: 'Changelog',
          },
          {
            link: 'https://github.com/nkzw-tech/fate/blob/main/CONTRIBUTING.md',
            text: 'Contributing',
          },
        ],
        text: `v${pkg.version}`,
      },
    ],
    outline: {
      label: 'On this page',
    },
    search: {
      provider: 'local',
    },
    sidebar: [
      {
        collapsed: false,
        items: [
          { link: '/guide/getting-started', text: 'Getting Started' },
          { link: '/guide/core-concepts', text: 'Core Concepts' },
          { link: '/guide/views', text: 'Views' },
          { link: '/guide/list-views', text: 'List Views' },
          { link: '/guide/actions', text: 'Actions' },
          { link: '/guide/requests', text: 'Requests' },
          { link: '/guide/server-integration', text: 'Server Integration' },
        ],
        text: 'Guide',
      },
      { collapsed: false, items: apiItems, text: 'API' },
      {
        collapsed: true,
        items: [{ link: '/posts/introducing-fate', text: 'Introducing Fate' }],
        text: 'Blog',
      },
    ],
    siteTitle: false,
    socialLinks: [
      {
        icon: {
          svg: nkzwLogo,
        },
        link: 'https://nakazawa.tech',
      },
      { icon: 'x', link: 'https://twitter.com/cnakazawa' },
      { icon: 'github', link: 'https://github.com/nkzw-tech/fate' },
    ],
  },
  title: 'fate',
});
