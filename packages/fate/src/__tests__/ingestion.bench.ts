import { describe } from 'vite-plus/test';
import type { ViewSelection } from '../types.ts';
import bench from './bench.ts';
import { createIngestionFixture, ProjectView, type User } from './fixtures/ingestion.ts';

for (const count of [20, 100, 1000]) {
  describe(`${count} projects and ${count} templates`, async () => {
    const fixture = createIngestionFixture(count);

    bench('GraphQL response decoding and selection normalization', async () => {
      await fixture.transport.fetchQuery!('viewer', fixture.plan.paths);
    });

    const writer = fixture.createClient('native');
    writer.write('User', fixture.current(), fixture.plan.paths, fixture.plan);
    bench('normalize an unchanged snapshot without transport decoding', () => {
      writer.write('User', fixture.current(), fixture.plan.paths, fixture.plan);
    });

    for (const mode of ['native', 'graphql'] as const) {
      describe(mode, async () => {
        const client = fixture.createClient(mode);
        const result = await client.request(fixture.request);
        const snapshot = await client.readView<
          User,
          ViewSelection<typeof fixture.selected>,
          typeof fixture.selected
        >(fixture.selected, result.viewer!);
        const refs = [...snapshot.data.projects.items, ...snapshot.data.templates.items].map(
          ({ node }) => node,
        );
        await Promise.all(refs.map((ref) => client.readView(ProjectView, ref)));
        let version = 0;

        bench('request into a fresh client', async () => {
          await fixture.createClient(mode).request(fixture.request, { mode: 'network-only' });
        });

        bench('refresh an unchanged snapshot', async () => {
          fixture.setVersion(0);
          await client.request(fixture.request, { mode: 'network-only' });
        });

        bench('refresh changed scalar and embedded fields', async () => {
          fixture.setVersion(++version);
          await client.request(fixture.request, { mode: 'network-only' });
        });

        bench('read cached project views', async () => {
          await Promise.all(refs.map((ref) => client.readView(ProjectView, ref)));
        });

        bench('read a cached view', async () => {
          await client.readView(fixture.selected, result.viewer!);
        });
      });
    }
  });
}
