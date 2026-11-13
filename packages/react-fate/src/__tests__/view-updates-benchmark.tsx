import { createClient, view } from '@nkzw/fate';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { FateClient } from '../context.tsx';
import { useView } from '../useView.tsx';

const params = new URLSearchParams(location.search);
const recordCount = Number(params.get('records') ?? 1000);
const sampleCount = Number(params.get('samples') ?? 15);
const output = document.querySelector('pre')!;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
type Item = { __typename: 'Item'; done: boolean; id: string; title: string };
type State = { __typename: 'State'; count: number; id: string; items: Array<Item> };
const graphView = view<State>()({ count: true, items: { done: true, id: true, title: true } });
const paths = new Set(['id', 'count', 'items', 'items.id', 'items.title', 'items.done']);
const make = () =>
  createClient({
    types: [
      { type: 'Item' },
      { fields: { items: { array: true, listOf: 'Item' } }, type: 'State' },
    ],
  });
const rows = Array.from({ length: recordCount }, (_, i) => ({
  done: false,
  id: String(i),
  title: `Task ${i}`,
}));
const summarize = (values: Array<number>) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    values,
  };
};

async function benchmark() {
  const client = make();
  client.write('State', { count: 0, id: 'main', items: rows }, paths);
  const ref = client.ref<State>('State', 'main', graphView);
  const ready = Promise.withResolvers<void>();
  let reads = 0;
  client.readViewForRender = new Proxy(client.readViewForRender, {
    apply(target, receiver, args) {
      reads++;
      return Reflect.apply(target, receiver, args);
    },
  });
  function Content() {
    const data = useView(graphView, ref);
    useEffect(() => ready.resolve(), []);
    return <span>{data.items.filter(({ done }) => done).length}</span>;
  }
  const container = document.getElementById('mount')!;
  const root = createRoot(container);
  root.render(
    <FateClient client={client}>
      <Content />
    </FateClient>,
  );
  await ready.promise;
  const elapsed: Array<number> = [];
  const snapshotReads: Array<number> = [];
  try {
    for (let i = 0; i < sampleCount + 3; i++) {
      await frame();
      const done = i % 2 === 0;
      const data = { id: 'main', items: rows.map((row) => ({ ...row, done })) };
      reads = 0;
      const start = performance.now();
      client.write('State', data, paths);
      const duration = performance.now() - start;
      const count = reads;
      await frame();
      await frame();
      if (Number(container.textContent) !== (done ? recordCount : 0)) {
        throw new Error('Incorrect rendered result');
      }
      if (i >= 3) {
        elapsed.push(duration);
        snapshotReads.push(count);
      }
    }
    return {
      bulkWrite: { elapsedMs: summarize(elapsed), snapshotReads },
      recordCount,
      sampleCount,
    };
  } finally {
    root.unmount();
    container.remove();
  }
}
try {
  output.textContent = JSON.stringify(await benchmark());
  output.dataset.status = 'done';
} catch (error) {
  output.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
  output.dataset.status = 'error';
}
