import CreateProject from '../components/CreateProject.tsx';
import ProjectCard, { type Project } from '../components/ProjectCard.tsx';
import StackShaders from '../components/StackShaders.tsx';

const layers: ReadonlyArray<
  Readonly<{
    name: string;
    note?: string;
    projects: ReadonlyArray<Project>;
  }>
> = [
  {
    name: 'Application',
    projects: [
      {
        description: 'A modern data client for React.',
        domain: 'fate.technology',
        href: 'https://fate.technology',
        name: 'fate',
        tone: 'blue',
        type: 'data',
      },
      {
        description: 'An internationalization framework for JavaScript & React.',
        domain: 'fbtee.dev',
        href: 'https://fbtee.dev',
        name: 'fbtee',
        tone: 'purple',
        type: 'i18n',
      },
    ],
  },
  {
    name: 'Framework',
    projects: [
      {
        description: 'Deploy your stack to Cloudflare.',
        domain: 'void.cloud',
        href: 'https://void.cloud',
        name: 'Void',
        tone: 'blue',
        type: 'full-stack',
      },
      {
        description:
          'Fast, lightweight, built on Web Standards. Support for any JavaScript runtime.',
        domain: 'hono.dev',
        href: 'https://hono.dev',
        name: 'Hono',
        tone: 'pink',
        type: 'routing',
      },
    ],
  },
  {
    name: 'Toolchain',
    projects: [
      {
        description: 'The Unified Toolchain for the Web.',
        domain: 'viteplus.dev',
        href: 'https://viteplus.dev',
        name: 'Vite+',
        tone: 'purple',
        type: 'tooling',
      },
    ],
  },
  {
    name: 'Foundation',
    note: 'Bundled with Vite+',
    projects: [
      {
        description: 'The development server and build tool for the modern web.',
        domain: 'vite.dev',
        href: 'https://vite.dev',
        name: 'Vite',
        tone: 'purple',
        type: 'dev & build',
      },
      {
        description: 'Fast JavaScript bundling, powered by Rust.',
        domain: 'rolldown.rs',
        href: 'https://rolldown.rs',
        name: 'Rolldown',
        tone: 'pink',
        type: 'bundling',
      },
      {
        description: 'Next Generation Testing Framework.',
        domain: 'vitest.dev',
        href: 'https://vitest.dev',
        name: 'Vitest',
        tone: 'blue',
        type: 'testing',
      },
      {
        description: 'The Rust-powered engine for JavaScript tooling.',
        domain: 'oxc.rs',
        href: 'https://oxc.rs',
        name: 'Oxc',
        tone: 'pink',
        type: 'compiler',
      },
      {
        description: 'Fast, type-aware linting to catch problems early.',
        domain: 'oxc.rs',
        href: 'https://oxc.rs/docs/guide/usage/linter',
        name: 'Oxlint',
        tone: 'blue',
        type: 'linting',
      },
      {
        description: 'Fast, consistent formatting for your whole project.',
        domain: 'oxc.rs',
        href: 'https://oxc.rs/docs/guide/usage/formatter',
        name: 'Oxfmt',
        tone: 'purple',
        type: 'formatting',
      },
    ],
  },
  {
    name: 'Shared defaults',
    projects: [
      {
        description: 'Opinionated Oxlint config with sensible defaults.',
        domain: 'github.com/nkzw-tech',
        href: 'https://github.com/nkzw-tech/oxlint-config',
        name: '@nkzw/oxlint-config',
        tone: 'blue',
        type: 'config',
      },
    ],
  },
  {
    name: 'Utilities',
    projects: [
      {
        description:
          'Zero-dependency, type-safe Stack component for streamlining flexbox usage in React & React Native.',
        domain: 'github.com/nkzw-tech',
        href: 'https://github.com/nkzw-tech/stack',
        name: '@nkzw/stack',
        tone: 'purple',
        type: 'layout',
      },
      {
        description: 'Lightweight core JavaScript functions.',
        domain: 'github.com/nkzw-tech',
        href: 'https://github.com/nkzw-tech/core',
        name: '@nkzw/core',
        tone: 'pink',
        type: 'utilities',
      },
    ],
  },
  {
    name: 'Developer Tools',
    projects: [
      {
        description: 'A fast local diff viewer.',
        domain: 'codiff.dev',
        href: 'https://codiff.dev',
        name: 'Codiff',
        tone: 'blue',
        type: 'code review',
      },
    ],
  },
];

export default function HomeRoute() {
  return (
    <div className="site-container">
      <main>
        <section aria-labelledby="hero-title" className="hero">
          <h1 id="hero-title">
            <i>fate</i>stack<span>.</span>
          </h1>
          <p className="hero-tagline">Great tools, all the way down.</p>
          <CreateProject />
        </section>
        <section aria-labelledby="stack-title" className="stack" id="stack">
          <h1 className="stack-title" id="stack-title">
            Explore the stack
          </h1>
          {layers.map(({ name, note, projects }, index) => (
            <section aria-labelledby={`layer-${index}`} className="stack-layer" key={name}>
              <div className="layer-heading">
                <h2 id={`layer-${index}`}>{name}</h2>
                {note ? <span className="layer-note">{note}</span> : null}
              </div>
              <div className={`project-grid shader-grid columns-${Math.min(projects.length, 3)}`}>
                {projects.map((project) => (
                  <ProjectCard {...project} key={project.name} />
                ))}
                <StackShaders
                  count={projects.length}
                  seedOffset={
                    1 +
                    layers
                      .slice(0, index)
                      .reduce((count, layer) => count + layer.projects.length, 0)
                  }
                />
              </div>
            </section>
          ))}
        </section>
      </main>
      <footer className="site-footer">
        <p>
          Curated by{' '}
          <a href="https://nakazawa.tech">
            Nakazawa Tech <span aria-hidden="true">↗</span>
          </a>
        </p>
      </footer>
    </div>
  );
}
