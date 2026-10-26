import { expect, test } from 'vite-plus/test';
import { graphqlMutation, graphqlValueMutation, graphqlValueRoot } from '../../graphqlTransport.ts';
import { dataView, list } from '../../server/dataView.ts';
import { createSourceRegistry } from '../../server/executor.ts';
import { createFateServer } from '../../server/http.ts';
import { createLiveEventBus } from '../../server/live.ts';
import type { SourceDefinition } from '../../server/source.ts';
import { createClientSource } from '../client.ts';

const importExampleModule = async <Module>(path: string) =>
  import(/* @vite-ignore */ new URL(path, import.meta.url).href) as Promise<Module>;

const setExampleEnv = () => {
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-with-enough-entropy-for-better-auth';
  process.env.BETTER_AUTH_URL ??= 'http://localhost:9020';
  process.env.CLIENT_DOMAIN ??= 'http://localhost:6001';
  process.env.DATABASE_URL ??= 'postgresql://fate:echo@localhost:5432/fate';
  process.env.VITE_SERVER_URL ??= 'http://localhost:9020';
};

test('generates value mutations without importing an entity type', () => {
  const source = createClientSource({
    moduleExports: {
      fateGraphQL: {
        mutations: {
          endGame: graphqlValueMutation<{ id: string }, boolean>({
            field: 'endGame',
            inputArg: false,
          }),
        },
        schema: 'type Query { origin: Boolean! } type Mutation { endGame(id: ID!): Boolean! }',
      },
      Root: {},
    },
    moduleName: '@org/game',
    transport: 'graphql',
  });

  expect(source).toContain('valueMutation<');
  expect(source).not.toContain('import type { __value__');
});

test('generates an ID-less object root as a cached value root', () => {
  const source = createClientSource({
    moduleExports: {
      fateGraphQL: {
        roots: {
          prices: graphqlValueRoot<{ amount: number }, { locale: string }>({ type: 'Price' }),
        },
        schema: 'type Query { prices(locale: String!): Price } type Price { amount: Int! }',
        types: [{ type: 'Price' }],
      },
      Root: {},
    },
    moduleName: '@org/shop',
    transport: 'graphql',
  });

  expect(source).toContain(
    '\'prices\': clientValueRoot<GraphQLSelectedResult<GraphQLResponses["Query"]["prices"]>',
  );
  expect(source).toContain('"embedded": true');
  expect(source).toContain('"type": "Price"');
  expect(source).toContain("type: 'Price'");
  expect(source).not.toContain('import type { Price');
});

test('generates ID-less object mutation selections', () => {
  const source = createClientSource({
    moduleExports: {
      fateGraphQL: {
        mutations: {
          checkout: graphqlValueMutation<{ id: string }, { approved: boolean }>({
            field: 'checkout',
            inputArg: false,
            type: 'Checkout',
          }),
        },
        schema:
          'type Query { origin: Boolean! } type Mutation { checkout(id: ID!): Checkout } type Checkout { approved: Boolean! }',
        types: [{ type: 'Checkout' }],
      },
      Root: {},
    },
    moduleName: '@org/shop',
    transport: 'graphql',
  });

  expect(source).toContain("'checkout': valueMutation<");
  expect(source).toContain('"type": "Checkout"');
  expect(source).toContain("type: 'Checkout'");
});

test('uses schema object shapes for generated nested cache relations', () => {
  type CharacterImage = { color: string };
  type Message = { __typename: 'Message'; id: string; text: string };
  type User = { __typename: 'User'; character: CharacterImage; id: string };
  type Game = { __typename: 'Game'; id: string; messages: Array<Message> };
  const character = dataView<CharacterImage>('CharacterImage')({ color: true });
  const message = dataView<Message>('Message')({ id: true, text: true });
  const user = dataView<User>('User')({ character, id: true });
  const game = dataView<Game>('Game')({ id: true, messages: list(message) });
  const source = createClientSource({
    moduleExports: {
      character,
      fateGraphQL: {
        schema:
          'type Query { viewer: User game: Game } type User { id: ID! character: CharacterImage } type CharacterImage { color: String! } type Game { id: ID! messages: [Message!]! } type Message { id: ID! text: String! }',
      },
      game,
      message,
      Root: { game, viewer: user },
      user,
    },
    moduleName: '@org/app',
    transport: 'graphql',
  });

  expect(source).toContain("character: { embedded: 'CharacterImage' }");
  expect(source).toContain("messages: { listOf: 'Message', array: true }");
});

test('infers connection roots and related entity roots from the schema without data views', () => {
  const source = createClientSource({
    moduleExports: {
      fateGraphQL: {
        roots: { feed: { field: 'posts' }, viewer: {} },
        schema: `
          type Query { posts(first: Int): PostConnection!, viewer: User }
          type PostConnection { edges: [PostEdge!]!, pageInfo: PageInfo! }
          type PostEdge { cursor: String!, node: Post! }
          type PageInfo { hasNextPage: Boolean! }
          type Post { id: ID!, author: User!, tags: [Tag!]! }
          type User { id: ID!, name: String! }
          interface Node { id: ID! }
          type Tag implements Node { id: ID!, name: String! }
        `,
      },
    },
    moduleName: '@org/blog',
    transport: 'graphql',
  });
  expect(source).toContain('"connection": "relay"');
  expect(source).toContain('"field": "posts"');
  expect(source).toContain('node: Post');
  expect(source).toContain("'tag': clientRoot<Array<Tag>, 'Tag'>('Tag')");
  expect(source).not.toContain("'node': clientRoot<Array<Node>");
  expect(source).not.toContain('import type {');
});

test('generates nullable connection result types from GraphQL schema', () => {
  type Post = { __typename: 'Post'; id: string };
  const post = dataView<Post>('Post')({ id: true });
  const source = createClientSource({
    moduleExports: {
      fateGraphQL: {
        schema:
          'type Query { posts: PostConnection } type PostConnection { edges: [PostEdge] pageInfo: PageInfo! } type PostEdge { cursor: String node: Post } type PageInfo { hasNextPage: Boolean! } type Post { id: ID! }',
      },
      post,
      Root: { posts: list(post) },
    },
    moduleName: '@org/blog',
    transport: 'graphql',
  });

  expect(source).toContain("} | null, 'Post'");
});

test('generates the same client source for the Prisma and Drizzle examples', async () => {
  setExampleEnv();

  const [prismaModule, drizzleModule] = await Promise.all([
    importExampleModule<Record<string, unknown>>(
      '../../../../../example/server-prisma/src/trpc/router.ts',
    ),
    importExampleModule<Record<string, unknown>>(
      '../../../../../example/server-drizzle/src/trpc/router.ts',
    ),
  ]);

  try {
    const moduleName = '@nkzw/fate-example-server';

    expect(createClientSource({ moduleExports: drizzleModule, moduleName })).toEqual(
      createClientSource({ moduleExports: prismaModule, moduleName }),
    );
    expect(createClientSource({ moduleExports: prismaModule, moduleName })).toContain(
      "comments: { listOf: 'Comment' }",
    );
    expect(createClientSource({ moduleExports: prismaModule, moduleName })).toContain(
      'createHTTPTransport',
    );
    expect(createClientSource({ moduleExports: prismaModule, moduleName })).toContain(
      'persistence: options.persistence',
    );
    expect(createClientSource({ moduleExports: prismaModule, moduleName })).toContain(
      'transport.subscribeConnection = liveTransport.subscribeConnection;',
    );
    expect(createClientSource({ moduleExports: prismaModule, moduleName })).toContain(
      'mutateDurably: options.mutateDurably',
    );
    expect(createClientSource({ moduleExports: prismaModule, moduleName })).not.toContain(
      'live.subscribe',
    );
  } finally {
    const [{ default: prisma }, { closeDatabase }] = await Promise.all([
      importExampleModule<{
        default: { $disconnect: () => Promise<void> };
      }>('../../../../../example/server-prisma/src/prisma/prisma.tsx'),
      importExampleModule<{
        closeDatabase: () => Promise<void>;
      }>('../../../../../example/server-drizzle/src/drizzle/db.ts'),
    ]);

    await Promise.all([prisma.$disconnect(), closeDatabase()]);
  }
});

test('generates a native HTTP client source', () => {
  type Post = { id: string; title: string };
  const postDataView = dataView<Post>('Post')({
    id: true,
    title: true,
  });
  const source: SourceDefinition<Post> = { id: 'id', view: postDataView };
  const fate = createFateServer({
    mutations: {
      'post.like': {
        resolve: ({ input }: { input: { id: string } }) => ({
          id: input.id,
          title: 'Liked',
        }),
        type: 'Post',
      },
    },
    roots: {
      posts: list(postDataView),
    },
    sources: {
      getSource: <Item extends Record<string, unknown>>() =>
        source as unknown as SourceDefinition<Item>,
      registry: createSourceRegistry([[source, {}]]),
    },
  });

  const sourceText = createClientSource({
    moduleExports: {
      fate,
      postDataView,
      Root: { posts: list(postDataView) },
    },
    moduleName: '@org/server/http.ts',
    transport: 'native',
  });

  expect(sourceText).toContain('createHTTPTransport<FateAPI>');
  expect(sourceText).toContain("from 'react-fate'");
  expect(sourceText).toContain("declare module 'react-fate/client'");
  expect(sourceText).not.toContain("declare module '@nkzw/fate/client'");
  expect(sourceText).toContain('live: false');
  expect(sourceText).toContain('type FateAPI = InferFateAPI<typeof fateServer>;');
  expect(sourceText).toContain("'posts': clientRoot<FateAPI['lists']['posts']['output'], 'Post'>");
  expect(sourceText).toContain(
    "mutation<\n    Post,\n    FateAPI['mutations']['post.like']['input']",
  );
});

test('generates a native HTTP client source without react-fate for core clients', () => {
  type Post = { id: string; title: string };
  const postDataView = dataView<Post>('Post')({
    id: true,
    title: true,
  });
  const source: SourceDefinition<Post> = { id: 'id', view: postDataView };
  const fate = createFateServer({
    roots: {
      posts: list(postDataView),
    },
    sources: {
      getSource: <Item extends Record<string, unknown>>() =>
        source as unknown as SourceDefinition<Item>,
      registry: createSourceRegistry([[source, {}]]),
    },
  });

  const sourceText = createClientSource({
    clientModule: '@nkzw/fate',
    moduleExports: {
      fate,
      postDataView,
      Root: { posts: list(postDataView) },
    },
    moduleName: '@org/server/http.ts',
    transport: 'native',
  });

  expect(sourceText).toContain("from '@nkzw/fate'");
  expect(sourceText).toContain("declare module '@nkzw/fate/client'");
  expect(sourceText).not.toContain("from 'react-fate'");
  expect(sourceText).not.toContain("declare module 'react-fate/client'");
});

test.each(['native', 'void'] as const)(
  'prefers explicit query and list roots over implicit entity roots for %s clients',
  (transport) => {
    type Post = { id: string; title: string };
    const postDataView = dataView<Post>('Post')({ id: true, title: true });
    const source: SourceDefinition<Post> = { id: 'id', view: postDataView };

    for (const root of [postDataView, list(postDataView)]) {
      const Root = { post: root };
      const fateServer = createFateServer({
        queries:
          root.kind === 'list'
            ? {}
            : {
                post: { resolve: () => ({ id: '1', title: 'Post' }) },
              },
        roots: Root,
        sources: {
          getSource: <Item extends Record<string, unknown>>() =>
            source as unknown as SourceDefinition<Item>,
          registry: createSourceRegistry([[source, {}]]),
        },
      });
      const sourceText = createClientSource({
        moduleExports: { fateServer, postDataView, Root },
        moduleName: '@org/server/http.ts',
        transport,
      });
      const section = root.kind === 'list' ? 'lists' : 'queries';

      expect(sourceText.match(/'post': clientRoot</g)).toHaveLength(1);
      expect(sourceText).toContain(
        `'post': clientRoot<FateAPI['${section}']['post']['output'], 'Post'>('Post')`,
      );
      expect(sourceText).toContain("import type { fateServer } from '@org/server/http.ts';");
    }
  },
);

test.each(['native', 'void'] as const)(
  'keeps mutation entity imports when an explicit %s root replaces its implicit root',
  (transport) => {
    type Post = { id: string; title: string };
    const postDataView = dataView<Post>('Post')({ id: true, title: true });
    const source: SourceDefinition<Post> = { id: 'id', view: postDataView };
    const Root = { post: postDataView };
    const fateServer = createFateServer({
      mutations: {
        'post.like': {
          resolve: ({ input }: { input: { id: string } }) => ({ id: input.id, title: 'Liked' }),
          type: 'Post',
        },
      },
      queries: { post: { resolve: () => ({ id: '1', title: 'Post' }) } },
      roots: Root,
      sources: {
        getSource: <Item extends Record<string, unknown>>() =>
          source as unknown as SourceDefinition<Item>,
        registry: createSourceRegistry([[source, {}]]),
      },
    });
    const sourceText = createClientSource({
      moduleExports: { fateServer, postDataView, Root },
      moduleName: '@org/server/http.ts',
      transport,
    });

    expect(sourceText.match(/'post': clientRoot</g)).toHaveLength(1);
    expect(sourceText).toContain("import type { fateServer, Post } from '@org/server/http.ts';");
    expect(sourceText).toContain(
      "mutation<\n    Post,\n    FateAPI['mutations']['post.like']['input']",
    );
  },
);

test('generates a native HTTP client source for fateServer exports', () => {
  type Post = { id: string; title: string };
  const postDataView = dataView<Post>('Post')({
    id: true,
    title: true,
  });
  const source: SourceDefinition<Post> = { id: 'id', view: postDataView };
  const fateServer = createFateServer({
    roots: {
      posts: list(postDataView),
    },
    sources: {
      getSource: <Item extends Record<string, unknown>>() =>
        source as unknown as SourceDefinition<Item>,
      registry: createSourceRegistry([[source, {}]]),
    },
  });

  const sourceText = createClientSource({
    moduleExports: {
      fateServer,
      postDataView,
      Root: { posts: list(postDataView) },
    },
    moduleName: '@org/server/http.ts',
    transport: 'native',
  });

  expect(sourceText).toContain("import type { fateServer, Post } from '@org/server/http.ts';");
  expect(sourceText).not.toContain('fate as fateServer');
});

test('generates a native HTTP client with live enabled when the server supports live', () => {
  type Post = { id: string; title: string };
  const postDataView = dataView<Post>('Post')({
    id: true,
    title: true,
  });
  const source: SourceDefinition<Post> = { id: 'id', view: postDataView };
  const fate = createFateServer({
    live: createLiveEventBus(),
    roots: {
      posts: list(postDataView),
    },
    sources: {
      getSource: <Item extends Record<string, unknown>>() =>
        source as unknown as SourceDefinition<Item>,
      registry: createSourceRegistry([[source, {}]]),
    },
  });

  const sourceText = createClientSource({
    moduleExports: {
      fate,
      postDataView,
      Root: { posts: list(postDataView) },
    },
    moduleName: '@org/server/http.ts',
    transport: 'native',
  });

  expect(sourceText).toContain('live: true');
});

test('generates a GraphQL client source with Relay roots and configured mutations', () => {
  type User = { __typename: 'User'; id: string; name: string };
  type Post = {
    __typename: 'Post';
    author?: User;
    comments?: Array<Comment>;
    id: string;
    title: string;
  };
  type Comment = { __typename: 'Comment'; id: string; post?: Post };

  const userDataView = dataView<User>('User')({
    id: true,
    name: true,
  });
  const commentDataView = dataView<Comment>('Comment')({
    id: true,
  });
  const postDataView = dataView<Post>('Post')({
    author: userDataView,
    comments: list(commentDataView),
    id: true,
    title: true,
  });
  const fateGraphQL = {
    mutations: {
      'post.like': graphqlMutation<Post, { id: string }, Post>('Post', {
        field: 'postLike',
      }),
    },
    roots: {
      posts: { field: 'allPosts' },
    },
  };

  const sourceText = createClientSource({
    moduleExports: {
      fateGraphQL,
      postDataView,
      Root: { posts: list(postDataView), viewer: userDataView },
      userDataView,
    },
    moduleName: '@org/server/graphql.ts',
    transport: 'graphql',
  });

  expect(sourceText).toContain('createGraphQLTransport<GraphQLTransportMutations>');
  expect(sourceText).toContain('import type { Comment, fateGraphQL, Post, User }');
  expect(sourceText).toContain("'post': clientRoot<Array<Post>, 'Post'>('Post')");
  expect(sourceText).toContain("'posts': clientRoot<{");
  expect(sourceText).toContain("pagination: import('react-fate').Pagination;");
  expect(sourceText).toContain('"field": "allPosts"');
  expect(sourceText).toContain("'post.like': mutation<");
  expect(sourceText).toContain("GraphQLMutationInput<typeof fateGraphQL.mutations['post.like']>");
  expect(sourceText).toContain('mutations: graphQL.mutations');
  expect(sourceText).toContain('mutateDurably: options.mutateDurably');
  expect(sourceText).toContain(
    "mutateDurably?: Parameters<typeof createGraphQLTransport<GraphQLTransportMutations>>[0]['mutateDurably'];",
  );
  expect(sourceText).toContain(
    "eventSource?: Parameters<typeof createGraphQLTransport>[0]['eventSource'];",
  );
  expect(sourceText).toContain("live?: Parameters<typeof createGraphQLTransport>[0]['live'];");
  expect(sourceText).not.toContain('ConstructorParameters<typeof createGraphQLTransport>');
  expect(sourceText).toContain(`}),
    types: [`);
});

test.each(['react-fate', 'vue-fate'] as const)(
  'generates a Void %s client with endpoint defaults and server fetch',
  (clientModule) => {
    type Post = { id: string; title: string };
    const postDataView = dataView<Post>('Post')({
      id: true,
      title: true,
    });
    const source: SourceDefinition<Post> = { id: 'id', view: postDataView };
    const fateServer = createFateServer({
      live: createLiveEventBus(),
      roots: {
        posts: list(postDataView),
      },
      sources: {
        getSource: <Item extends Record<string, unknown>>() =>
          source as unknown as SourceDefinition<Item>,
        registry: createSourceRegistry([[source, {}]]),
      },
    });

    const sourceText = createClientSource({
      clientModule,
      moduleExports: {
        fateServer,
        postDataView,
        Root: { posts: list(postDataView) },
      },
      moduleName: '@org/server/http.ts',
      runtimeModuleName: '/src/fate/server.ts',
      transport: 'void',
    });

    expect(sourceText).toContain("const defaultVoidFateRpcPath = '/fate';");
    expect(sourceText).toContain("const defaultVoidFateLivePath = '/fate-live';");
    expect(sourceText).toContain("import type { fateServer, Post } from '@org/server/http.ts';");
    expect(sourceText).toContain("import { connectLiveStream } from 'void/live/client';");
    expect(sourceText).toContain("import('@nkzw/fate/server')");
    expect(sourceText).toContain("import('/src/fate/server.ts')");
    expect(sourceText).toContain('import.meta.env.SSR');
    expect(sourceText).toContain('credentials: options.userId ?');
    expect(sourceText).toContain('url: toEndpointUrl(options.url');
    expect(sourceText).toContain('live: connectLiveStream');
  },
);

const refetchSDL = `
  type Query {
    viewer: User
    fetch__User(id: ID!): User
    byKey(key: ID!): User!
    wrong(id: ID!): Game
    many(ids: [ID!]!): [User!]!
    filtered(id: ID!, tenant: String!): User
  }
  type User { id: ID! }
  type Game { id: ID! }
`;

const generateRefetchClient = (byId: Record<string, { field: string; idArg?: string }>) =>
  createClientSource({
    moduleExports: { fateGraphQL: { byId, nodes: false, schema: refetchSDL } },
    moduleName: './graphql.ts',
    transport: 'graphql',
  });

test('generates configured GraphQL refetch mappings and disables the nodes fallback', () => {
  const source = generateRefetchClient({ User: { field: 'byKey', idArg: 'key' } });
  expect(source).toContain('"byId":');
  expect(source).toContain('"field": "byKey"');
  expect(source).toContain('"idArg": "key"');
  expect(source).toContain('"nodes": false');
  expect(source).toContain('byId: graphQL.byId');
  expect(source).toContain('nodes: graphQL.nodes');
});

test.each([
  [{ User: { field: 'missing' } }, /Query.missing/],
  [{ User: { field: 'byKey' } }, /Query.byKey.id/],
  [{ User: { field: 'wrong' } }, /return.*User/],
  [{ User: { field: 'many', idArg: 'ids' } }, /Query.many.ids/],
  [{ User: { field: 'filtered' } }, /tenant/],
])('rejects invalid GraphQL refetch mappings during codegen: %j', (mapping, error) => {
  expect(() => generateRefetchClient(mapping)).toThrow(error);
});
