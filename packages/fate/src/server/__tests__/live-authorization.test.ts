import { expect, test, vi } from 'vite-plus/test';
import type { AnyRecord } from '../../types.ts';
import { dataView, list, type DataView } from '../dataView.ts';
import { createSourceRegistry } from '../executor.ts';
import { createFateServer } from '../http.ts';
import { createLiveEventBus } from '../live.ts';
import type { SourceDefinition } from '../source.ts';

for (const queued of [true, false]) {
  for (const connection of [false, true]) {
    for (const authorized of [true, false]) {
      test(`${queued ? 'queued' : 'iterable'} live ${connection ? 'connection' : 'entity'} events respect ${authorized ? 'field redaction' : 'access denial'}`, async () => {
        const postView = dataView<{ id: string; title: string }>('Post')({ id: true, title: true });
        const source: SourceDefinition<{ id: string; title: string }> = {
          id: 'id',
          view: postView,
        };
        const byIds = vi.fn(async ({ ctx }: { ctx: { authorized: boolean } }) =>
          ctx.authorized ? [{ id: 'secret', title: 'Redacted title' }] : [],
        );
        const bus = createLiveEventBus();
        const server = createFateServer({
          context: ({ request }) => ({
            authorized: request.headers.get('authorization') === 'owner',
          }),
          live: queued ? bus : { ...bus, listen: undefined, listenConnection: undefined },
          roots: { posts: list(postView) },
          sources: {
            getSource: <Item extends AnyRecord>(_target: DataView<Item> | SourceDefinition<Item>) =>
              source as unknown as SourceDefinition<Item>,
            registry: createSourceRegistry([[source, { byIds }]]),
          },
        });
        const headers = {
          authorization: authorized ? 'owner' : 'stranger',
          'content-type': 'application/json',
        };
        const post = (body: unknown) =>
          new Request('http://local/fate/live', {
            body: JSON.stringify(body),
            headers,
            method: 'POST',
          });
        const response = await server.handleRequest(
          post({
            operations: [
              { id: 'q', ids: ['secret'], kind: 'byId', select: ['id', 'title'], type: 'Post' },
            ],
            version: 1,
          }),
        );
        expect(await response.json()).toMatchObject({
          results: [{ data: authorized ? [{ id: 'secret', title: 'Redacted title' }] : [] }],
        });
        byIds.mockClear();

        const stream = await server.handleLiveRequest(
          new Request('http://local/fate/live?connectionId=c1', { headers }),
        );
        const reader = stream.body!.getReader();
        try {
          await reader.read();
          await server.handleLiveRequest(
            post({
              connectionId: 'c1',
              operations: [
                {
                  id: 's',
                  select: ['id', 'title'],
                  type: 'Post',
                  ...(connection
                    ? { kind: 'subscribeConnection', procedure: 'posts' }
                    : { entityId: 'secret', kind: 'subscribe' }),
                },
              ],
              version: 1,
            }),
          );
          const data = { id: 'secret', title: 'CONFIDENTIAL' };
          if (connection) {
            bus.connection('posts').appendNode('Post', 'secret', { node: data });
          } else {
            bus.update('Post', 'secret', { data });
          }
          const message = new TextDecoder().decode((await reader.read()).value);
          expect(message).not.toContain('CONFIDENTIAL');
          if (authorized) {
            expect(message).toContain('Redacted title');
          }
          expect(byIds).toHaveBeenCalledWith(
            expect.objectContaining({ ctx: { authorized }, ids: ['secret'] }),
          );
        } finally {
          await reader.cancel();
        }
      });
    }
  }
}
