import { buildSchema } from 'graphql';
import { alias } from '../../alias.ts';
import { createClient } from '../../client.ts';
import { createGraphQLArgumentSchema } from '../../codegen/graphql.ts';
import { createGraphQLTransport } from '../../graphqlTransport.ts';
import { clientRoot } from '../../root.ts';
import { getSelectionPlan } from '../../selection.ts';
import type { AnyRecord, TypeConfig } from '../../types.ts';
import { view } from '../../view.ts';

type Project = {
  __typename: 'Project';
  description: string;
  id: string;
  name: string;
  owner: User;
  published: boolean;
  slug: string;
  state: string;
  statistics: { category: string; rank: number; views: number };
  tags: Array<string>;
};
export type User = {
  __typename: 'User';
  id: string;
  projects: Array<Project>;
  templates: Array<Project>;
  username: string;
};

export const ProjectView = view<Project>()({
  description: true,
  heading: alias('name', true),
  id: true,
  name: true,
  owner: { id: true, username: true },
  published: true,
  slug: true,
  state: true,
  statistics: { category: true, position: alias('rank', true), views: true },
  tags: true,
});
export const ViewerView = view<User>()(({ count }: { count: number }) => ({
  id: true,
  projects: {
    args: { first: count },
    items: { cursor: true, node: ProjectView },
    pagination: { hasNext: true, hasPrevious: true },
  },
  templates: {
    args: { first: count },
    items: { node: ProjectView },
    pagination: { hasNext: true },
  },
  username: true,
}));

const types: Array<TypeConfig> = [
  {
    fields: { projects: { listOf: 'Project' }, templates: { listOf: 'Project' } },
    getId: (record) => (record as { id: string }).id,
    refetch: { args: { username: { field: 'username' } }, root: 'user' },
    type: 'User',
  },
  {
    fields: { owner: { type: 'User' }, statistics: { embedded: 'Statistics' } },
    getId: (record) => (record as { id: string }).id,
    type: 'Project',
  },
  { getId: (record) => (record as { id: string }).id, type: 'Statistics' },
];
const roots = { user: clientRoot<User, 'User'>('User'), viewer: clientRoot<User, 'User'>('User') };
const rootConfig = { user: { type: 'User' }, viewer: { type: 'User' } };
const schema = createGraphQLArgumentSchema(
  buildSchema(`
    type Query { user(username: String!): User viewer: User }
    type User {
      id: ID!
      username: String!
      projects(first: Int): ProjectConnection!
      templates(first: Int): ProjectConnection!
    }
    type Project {
      id: ID!
      name: String!
      description: String!
      owner: User!
      published: Boolean!
      slug: String!
      state: String!
      statistics: Statistics!
      tags: [String!]!
    }
    type Statistics { category: String! rank: Int! views: Int! }
    type ProjectConnection { edges: [ProjectEdge!]! pageInfo: PageInfo! }
    type ProjectEdge { cursor: String! node: Project! }
    type PageInfo {
      hasNextPage: Boolean!
      hasPreviousPage: Boolean!
      startCursor: String
      endCursor: String
    }
  `),
);

const graphQLValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(graphQLValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as AnyRecord;
  if (Array.isArray(record.items)) {
    return {
      edges: record.items.map(({ cursor, node }) => ({ cursor, node: graphQLValue(node) })),
      pageInfo: {
        endCursor: record.items.at(-1)?.cursor ?? null,
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: record.items[0]?.cursor ?? null,
      },
    };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key.split(':')[0], graphQLValue(entry)]),
  );
};

const project = (index: number, authorCount: number) => ({
  __typename: 'Project',
  description: `Description for project ${index}`,
  'heading:name': `Project ${index}`,
  id: `project-${index}`,
  name: `Project ${index}`,
  owner: {
    __typename: 'User',
    id: `author-${index % authorCount}`,
    username: `Author ${index % authorCount}`,
  },
  published: index % 3 === 0,
  slug: `author-${index % authorCount}/project-${index}`,
  state: JSON.stringify({
    blocks: Array.from({ length: 32 }, (_, block) => ({
      text: `Project ${index}, block ${block}: document content`,
      x: block % 8,
      y: Math.floor(block / 8),
    })),
    id: index,
  }),
  statistics: { category: `category-${index % 5}`, 'position:rank': index, views: index * 10 },
  tags: ['example', index % 3 === 0 ? 'published' : 'draft'],
});

export const createIngestionFixture = (
  count: number,
  authorCount = 20,
  { customIdentity = true } = {},
) => {
  const clientTypes = customIdentity ? types : types.map(({ getId: _getId, ...config }) => config);
  const connection = (offset: number) => ({
    items: Array.from({ length: count }, (_, index) => ({
      cursor: `cursor-${index + offset}`,
      node: project(index + offset, authorCount),
    })),
    pagination: { hasNext: false, hasPrevious: false },
  });
  const initial = {
    __typename: 'User',
    id: 'viewer',
    projects: connection(0),
    templates: connection(count),
    username: 'Viewer',
  };
  const changed = structuredClone(initial);
  for (const { node } of [...changed.projects.items, ...changed.templates.items]) {
    node.name += ' updated';
    node['heading:name'] = node.name;
    node.statistics.views += 1;
  }
  const records = [initial, changed];
  const json = records.map((value) => JSON.stringify(value));
  const graphQL = records.map((value) => JSON.stringify(graphQLValue(value)));
  const selected = ViewerView({ count });
  const plan = getSelectionPlan(selected, null, { includeNestedViews: true });
  const request = { viewer: { view: selected } } as const;
  let version = 0;
  const transport = createGraphQLTransport({
    decodeNodeId: (_, id) => id,
    encodeNodeId: (_, id) => id,
    fetch: async (_, init) => {
      const { query } = JSON.parse(String(init?.body));
      const name = /\b(f\d+): viewer/.exec(query)?.[1];
      if (!name) {
        throw new Error('Missing fixture query alias.');
      }
      return new Response(`{"data":{"${name}":${graphQL[version]}}}`);
    },
    live: false,
    roots: rootConfig,
    schema,
    types,
    url: 'https://benchmark.invalid/graphql',
  });

  return {
    createClient: (mode: 'graphql' | 'native') =>
      createClient({
        roots,
        transport:
          mode === 'graphql'
            ? transport
            : {
                fetchById: async () => [],
                fetchQuery: async () => JSON.parse(json[version]),
                supportsAliases: true,
              },
        types: clientTypes,
      }),
    current: () => records[version],
    graphQLBytes: Buffer.byteLength(graphQL[0]),
    jsonBytes: Buffer.byteLength(json[0]),
    plan,
    request,
    selected,
    setVersion: (next: number) => {
      version = next % records.length;
    },
    transport,
  };
};
