import type { GraphQLEntities } from '../../.fate/client.generated.ts';
import schema from './schema.graphql?raw';

export type User = GraphQLEntities['User'];
export type Post = GraphQLEntities['Post'];

export const fateGraphQL = {
  mutations: { 'post.like': { entity: 'Post', field: 'postLike' } },
  roots: { posts: {}, viewer: {} },
  schema,
} as const;
