import schema from '@app/server/src/graphql/schema.graphql?raw';
import type { GraphQLEntities } from '../../.fate/schema.generated.ts';

export type User = GraphQLEntities['User'];
export type Post = GraphQLEntities['Post'];
export type Comment = GraphQLEntities['Comment'];

export const fateGraphQL = {
  mutations: {
    'comment.add': { entity: 'Comment', field: 'commentAdd' },
    'comment.delete': { entity: 'Comment', field: 'commentDelete' },
    'post.add': { entity: 'Post', field: 'postAdd' },
    'post.like': { entity: 'Post', field: 'postLike' },
    'post.unlike': { entity: 'Post', field: 'postUnlike' },
    'user.update': { entity: 'User', field: 'userUpdate' },
  },
  roots: { categories: {}, commentSearch: {}, events: {}, posts: {}, viewer: {} },
  scalars: { DateTime: 'string' },
  schema,
} as const;
