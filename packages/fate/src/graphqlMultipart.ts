import { GraphQLRequestError } from './graphql-error.ts';
import { abortable } from './read-control.ts';

export const graphQLProtocolError = (message: string, status?: number) =>
  new GraphQLRequestError([], { kind: 'protocol', message: `fate(graphql): ${message}`, status });

export async function* readGraphQLMultipart(response: Response, signal?: AbortSignal) {
  const contentType = response.headers.get('content-type') || '';
  const boundary = /(?:^|;)\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const value = boundary?.[1] ?? boundary?.[2];
  if (!value || !/^[\w'()+,./:=? -]{1,70}$/.test(value) || value.endsWith(' ') || !response.body) {
    throw graphQLProtocolError('Invalid multipart response boundary or body.', response.status);
  }
  const separator = `\r\n--${value}`;
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: Array<string> = [];
  let buffer = '\r\n';
  let state: 'start' | 'boundary' | 'headers' | 'body' = 'start';
  try {
    for (;;) {
      if (state === 'start') {
        const index = buffer.indexOf(separator);
        if (index >= 0) {
          buffer = buffer.slice(index + separator.length);
          state = 'boundary';
          continue;
        }
        buffer = buffer.slice(-separator.length);
      } else if (state === 'boundary') {
        if (buffer.length >= 2) {
          const suffix = buffer.slice(0, 2);
          if (suffix === '--') {
            return;
          }
          if (suffix !== '\r\n') {
            throw graphQLProtocolError('Invalid multipart delimiter.', response.status);
          }
          buffer = buffer.slice(2);
          state = 'headers';
          continue;
        }
      } else if (state === 'headers') {
        const index = buffer.indexOf('\r\n\r\n');
        if (index >= 0) {
          const headers = new Headers();
          for (const line of buffer.slice(0, index).split('\r\n')) {
            const colon = line.indexOf(':');
            if (colon < 1) {
              throw graphQLProtocolError('Invalid multipart headers.', response.status);
            }
            headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
          }
          const type = headers.get('content-type')?.split(';')[0].trim().toLowerCase();
          if (type !== 'application/json' && type !== 'application/graphql-response+json') {
            throw graphQLProtocolError('Expected a JSON multipart part.', response.status);
          }
          buffer = buffer.slice(index + 4);
          state = 'body';
          continue;
        }
      } else {
        const index = buffer.indexOf(separator);
        if (index >= 0) {
          parts.push(buffer.slice(0, index));
          buffer = buffer.slice(index + separator.length);
          state = 'boundary';
          let payload: unknown;
          try {
            payload = JSON.parse(parts.join(''));
          } catch {
            throw graphQLProtocolError('Invalid JSON multipart part.', response.status);
          }
          parts.length = 0;
          yield payload;
          continue;
        }
        const length = Math.max(0, buffer.length - separator.length);
        if (length) {
          parts.push(buffer.slice(0, length));
          buffer = buffer.slice(length);
        }
      }
      signal?.throwIfAborted();
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) {
        throw graphQLProtocolError(
          'Multipart response ended before its closing boundary.',
          response.status,
        );
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
