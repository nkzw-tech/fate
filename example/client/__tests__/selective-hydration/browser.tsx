import { hydrateRoot } from 'react-dom/client';
import { FateClient, type FateDehydratedState } from 'react-fate';
import { App, createFixtureClient } from './App.tsx';

const state = JSON.parse(
  document.querySelector('#fate-state')!.textContent!,
) as FateDehydratedState;
const client = createFixtureClient();
client.hydrate(state);

const ready = Promise.withResolvers<void>();
const order: Array<'A' | 'B'> = [];
const output = document.querySelector('#hydration-order')!;
hydrateRoot(
  document.querySelector('#root')!,
  <FateClient client={client} hydrationState={state}>
    <App
      onPreviewHydrated={(name) => {
        order.push(name);
        output.textContent = order.join(', ');
      }}
      onRelease={() => ready.resolve()}
      previewsReady={ready.promise}
    />
  </FateClient>,
);
