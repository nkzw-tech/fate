import { useEffect, useRef, useState } from 'react';
import StackShaders from './StackShaders.tsx';

const commands =
  'vp create fate my-app --template cloudflare\ncd my-app\nvp run dev:setup\nvp run dev';

const agentPrompt = `Set up a new project using the fate stack: React, TypeScript, fate, Void, fbtee, and Vite+.

Read https://fate.technology, https://void.cloud, https://fbtee.dev, and https://viteplus.dev/guide/ for current setup instructions. Use Node.js 24+ and Vite+.

Install Vite+ if it's not already installed.

Create the project in a new empty directory, using the project name I provide or my-app by default:

vp create fate my-app --template cloudflare --framework react
cd my-app
vp run dev:setup

Keep the template's React client with the Void pages router and separate Cloudflare Worker using cf-fate, D1, Drizzle, and Durable Objects for live updates. Preserve fbtee, Better Auth, Tailwind, React Compiler, and @nkzw/oxlint-config. Follow the generated README and AGENTS.md.

Use the template's fbtee integration for translated React components, preserving its translation extraction and runtime initialization.

Run the generated project's checks, tests, and production build, fix any setup issues, then start the client and Worker with vp run dev. Tell me the local URLs, what is configured, and any remaining Cloudflare deployment setup steps.`;

type CopyKind = 'commands' | 'prompt';

export default function CreateProject() {
  const [status, setStatus] = useState<{
    kind: CopyKind;
    state: 'copied' | 'error';
  } | null>(null);
  const copyRequest = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  const copy = async (kind: CopyKind) => {
    const request = ++copyRequest.current;
    clearTimeout(timeout.current);
    setStatus(null);
    try {
      await navigator.clipboard.writeText(kind === 'commands' ? commands : agentPrompt);
      if (request === copyRequest.current) {
        setStatus({ kind, state: 'copied' });
        timeout.current = setTimeout(() => setStatus(null), 4000);
      }
    } catch {
      if (request === copyRequest.current) {
        setStatus({ kind, state: 'error' });
      }
    }
  };

  return (
    <section aria-label="Create a project" className="create-project" id="create">
      <div className="terminal">
        <div className="terminal-bar shader-grid">
          <span aria-hidden="true" className="terminal-dither shader-tile" />
          <StackShaders animated={false} count={1} />
          <strong className="terminal-label">Terminal</strong>
          <div className="terminal-actions">
            <button onClick={() => copy('commands')} type="button">
              {status?.kind === 'commands' && status.state === 'copied'
                ? 'Copied ✓'
                : 'Copy commands'}
            </button>
            <button onClick={() => copy('prompt')} type="button">
              {status?.kind === 'prompt' && status.state === 'copied' ? 'Copied ✓' : 'Copy prompt'}
            </button>
          </div>
        </div>
        <pre>
          <code>
            {commands.split('\n').map((line) => (
              <span className="command-line" key={line}>
                <span aria-hidden="true" className="prompt">
                  ${' '}
                </span>
                {line}
              </span>
            ))}
          </code>
        </pre>
        <span aria-live="polite" className={status?.state === 'error' ? 'copy-error' : 'sr-only'}>
          {status?.state === 'error'
            ? `Could not access the clipboard. Select and copy the ${status.kind === 'prompt' ? 'prompt below' : 'commands above'}.`
            : status?.state === 'copied'
              ? `${status.kind === 'prompt' ? 'Agent prompt' : 'Commands'} copied to clipboard.`
              : ''}
        </span>
        {status?.kind === 'prompt' && status.state === 'error' ? (
          <pre className="prompt-fallback">
            <code>{agentPrompt}</code>
          </pre>
        ) : null}
      </div>
      <div className="setup-details">
        <p className="setup-note">
          Requires Node.js 24+ and <a href="https://viteplus.dev/guide/">Vite+</a>.
        </p>
        <a href="https://github.com/nkzw-tech/fate/tree/main/packages/create-fate">
          Explore the templates <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}
