import { clientSchema, dataView, type EntityOf } from 'react-fate';
import type { createFateClient } from 'react-fate/client';

const postState = dataView<{ bookmarked: boolean }>('Post')({
  bookmarked: true,
});
const state = clientSchema({
  typeExtensions: {
    Post: { defaults: () => ({ bookmarked: false }), view: postState },
  },
});
const postInput = {
  parse(value: unknown) {
    if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') {
      throw new Error('A post ID is required.');
    }
    return { id: value.id };
  },
};

export const withClientState = (client: ReturnType<typeof createFateClient>) =>
  client.registerClientSchema(state, ({ mutation }) => ({
    'post.bookmark': mutation('Post', {
      input: postInput,
      resolve: ({ input, store }) =>
        store.update('Post', input.id, {
          bookmarked: !store.get('Post', input.id)?.bookmarked,
        }),
    }),
    'post.likeAndBookmark': mutation('Post', {
      input: postInput,
      resolve: async ({ input, mutateRemote, store }) => {
        const result = await mutateRemote('post.like', input);
        store.update('Post', input.id, { bookmarked: true });
        return { ...result, bookmarked: true };
      },
    }),
  }));

export type ExampleClient = ReturnType<typeof withClientState>;
export type Post = EntityOf<ExampleClient, 'Post'>;

// One registration types the existing hooks throughout the app.
declare module '@nkzw/fate' {
  interface ClientRegistration {
    client: ExampleClient;
  }
}
