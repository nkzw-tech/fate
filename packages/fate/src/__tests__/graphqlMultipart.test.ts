import { expect, test, vi } from 'vite-plus/test';
import { readGraphQLMultipart } from '../graphqlMultipart.ts';

const encoder = new TextEncoder();
const contentType = 'multipart/mixed;incrementalSpec=v0.2;boundary="fate:test"';
const payload = (data: unknown) =>
  `Content-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(data)}\r\n--fate:test`;
const multipart = (parts: ReadonlyArray<unknown>) =>
  `--fate:test\r\n${parts.map(payload).join('\r\n')}--\r\n`;

test.each([1, 7, 128])(
  'reads UTF-8 JSON with multipart boundaries split into %s-byte chunks',
  async (size) => {
    const values = [{ data: { name: '早い 🐈' }, hasNext: true }, { hasNext: false }];
    const encoded = encoder.encode(multipart(values));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < encoded.length; offset += size) {
          controller.enqueue(encoded.slice(offset, offset + size));
        }
        controller.close();
      },
    });
    const result = [];
    for await (const value of readGraphQLMultipart(
      new Response(body, { headers: { 'content-type': contentType } }),
    )) {
      result.push(value);
    }
    expect(result).toEqual(values);
  },
);

test('delivers a JSON part without waiting for the next part headers', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    cancel,
    start(controller) {
      controller.enqueue(
        encoder.encode(`--fate:test\r\n${payload({ data: { ready: true }, hasNext: true })}`),
      );
    },
  });
  const iterator = readGraphQLMultipart(
    new Response(body, { headers: { 'content-type': contentType } }),
  );
  expect((await iterator.next()).value).toEqual({ data: { ready: true }, hasNext: true });
  await iterator.return(undefined);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test.each([
  ['missing boundary', 'multipart/mixed', multipart([])],
  [
    'invalid JSON',
    contentType,
    '--fate:test\r\nContent-Type: application/json\r\n\r\n{\r\n--fate:test--\r\n',
  ],
  [
    'unexpected content type',
    contentType,
    '--fate:test\r\nContent-Type: text/plain\r\n\r\nhello\r\n--fate:test--\r\n',
  ],
  ['truncation', contentType, '--fate:test\r\nContent-Type: application/json\r\n\r\n{}'],
  ['missing closing delimiter', contentType, `--fate:test\r\n${payload({ hasNext: true })}`],
])('rejects %s as a protocol error', async (_name, type, body) => {
  await expect(
    (async () => {
      const parts = [];
      for await (const part of readGraphQLMultipart(
        new Response(body, { headers: { 'content-type': type } }),
      )) {
        parts.push(part);
      }
      return parts;
    })(),
  ).rejects.toMatchObject({ kind: 'protocol', name: 'GraphQLRequestError', status: 200 });
});
