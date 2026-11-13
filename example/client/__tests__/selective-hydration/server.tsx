import { renderToString } from 'react-dom/server';
import { FateClient } from 'react-fate';
import { App, createFixtureClient, request, writeTitle } from './App.tsx';

export async function render() {
  const client = createFixtureClient();
  writeTitle(client, 'Rendered on the server');
  await client.request(request);
  const state = JSON.stringify(client.dehydrate()).replaceAll('<', String.raw`\u003c`);
  const html = renderToString(
    <FateClient client={client}>
      <App />
    </FateClient>,
  );
  return { html, state };
}
