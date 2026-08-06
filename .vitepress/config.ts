import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type HeadConfig } from 'vitepress';
import apiItems from '../docs/api/typedoc-sidebar.json';
import pkg from '../packages/fate/package.json' with { type: 'json' };
import dunkel from './theme/dunkel.json';
import licht from './theme/licht.json';

const origin = 'https://fate.technology';
const description = 'A Modern React and Vue Data Framework';
const ogImage = `${origin}/og-image.png`;
const nkzwLogo = readFileSync(join(import.meta.dirname, './nkzw-logo.svg'), 'utf8');

const meta = (attribute: 'name' | 'property', value: string, content: string): HeadConfig => {
  const attributes: Record<string, string> = {};
  attributes[attribute] = value;
  attributes.content = content;
  return ['meta', attributes];
};

export default defineConfig({
  cleanUrls: true,
  description,
  head: [
    ['link', { href: '/icon.svg', rel: 'icon' }],
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', 'fate'),
    meta('property', 'og:description', description),
    meta('property', 'og:url', origin),
    meta('property', 'og:image', ogImage),
    meta('property', 'og:image:width', '2400'),
    meta('property', 'og:image:height', '1260'),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:alt', 'fate — A modern data framework for React and Vue'),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', 'fate'),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', ogImage),
    meta('name', 'twitter:image:alt', 'fate — A modern data framework for React and Vue'),
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
    'guide/graphql-integration': 'integrations/graphql',
    'guide/server-integration': 'integrations/server',
    'guide/void-integration': 'integrations/void',
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
      { link: '/posts/fate-1.0', text: 'Blog' },
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
          { link: '/guide/live-views', text: 'Live Views' },
          { link: '/guide/actions', text: 'Actions' },
          { link: '/guide/requests', text: 'Requests' },
          { link: '/guide/deferred-views', text: 'Deferred Views' },
          { link: '/guide/vue', text: 'Vue' },
        ],
        text: 'Guide',
      },
      {
        collapsed: false,
        items: [
          { link: '/integrations/graphql', text: 'GraphQL' },
          { link: '/integrations/server', text: 'Server' },
          { link: '/integrations/cloudflare', text: 'Cloudflare' },
          { link: '/integrations/void', text: 'Void' },
        ],
        text: 'Integrations',
      },
      { collapsed: false, items: apiItems, text: 'API' },
      {
        collapsed: true,
        items: [
          { link: '/posts/fate-1.0', text: 'Fate 1.0' },
          { link: '/posts/introducing-fate', text: 'Introducing Fate' },
        ],
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
