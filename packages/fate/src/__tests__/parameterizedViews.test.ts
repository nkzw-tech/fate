import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import { getSelectionPlan } from '../selection.ts';
import type { SelectionOf, ViewData, ViewRef } from '../types.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; id: string; name: string };
const Name = view<User>()(({ locale }: { locale: string }) => ({ name: { args: { locale } } }));
const setup = () => {
  const fetchById = vi.fn(async (_type, ids, _select, args) =>
    ids.map((id: string | number) => ({
      __typename: 'User',
      id,
      name: args.name.locale,
    })),
  );
  const roots = { User: clientRoot<User, 'User'>('User') };
  const client = createClient<[typeof roots, Record<never, never>]>({
    roots,
    transport: { fetchById },
    types: [{ type: 'User' }],
  });
  return { client, fetchById };
};

test('binds view parameters once and resolves the definition from the resulting ref', async () => {
  const { client, fetchById } = setup();
  const bound = Name({ locale: 'en' });
  const ref = client.ref('User', '1', bound);
  expect((await client.readView(Name, ref)).data).toMatchObject({ name: 'en' });
  expect(
    (await client.readView(Name, client.ref('User', '1', Name({ locale: 'ja' })))).data,
  ).toMatchObject({ name: 'ja' });
  expect((await client.readView(Name, ref)).data).toMatchObject({ name: 'en' });
  expect(fetchById).toHaveBeenCalledTimes(2);
  expectTypeOf<ViewData<User, SelectionOf<typeof Name>>['name']>().toEqualTypeOf<string>();
});

test('equivalent bindings preserve ref and snapshot identity without memoizing the call', async () => {
  const { client } = setup();
  const first = client.ref('User', '1', Name({ locale: 'en' }));
  const second = client.ref('User', '1', Name({ locale: 'en' }));
  expect(second).toBe(first);
  expect(await client.readView(Name, second)).toBe(await client.readView(Name, first));
});

test('explains parameter mismatches without accepting a different binding', async () => {
  const { client, fetchById } = setup();
  const ref = client.ref('User', '1', Name({ locale: 'en' }));
  expect(() => client.readView(Name({ locale: 'ja' }), ref)).toThrow(
    /View parameters do not match the reference.*useView\(ViewDefinition, ref\)/,
  );
  expect(fetchById).not.toHaveBeenCalled();
  expect((await client.readView(Name, ref)).data).toMatchObject({ name: 'en' });
});

test('distinguishes omitted defaults from explicit parameters and missing views', () => {
  const { client } = setup();
  const DefaultName = view<User>()(({ locale = 'en' }: { locale?: string }) => ({
    name: { args: { locale } },
  }));
  const ref = client.ref('User', '1', DefaultName({}));
  expect(() => client.readView(DefaultName({ locale: 'en' }), ref)).toThrow(
    /View parameters do not match the reference/,
  );
  expect(() => client.readView(Name({ locale: 'en' }), ref)).toThrow(/Invalid view reference/);
  const Missing = view<User>()({ id: true });
  expect(() => client.readView({ ...DefaultName({ locale: 'en' }), ...Missing }, ref)).toThrow(
    /Invalid view reference/,
  );
});

test('bound parameters survive ordinary view spreads and nested entity refs', async () => {
  const { client } = setup();
  const Parent = view<User>()({ id: true, ...Name({ locale: 'ja' }) });
  client.write('User', { id: '1' }, new Set(['id']));
  const parent = (await client.readView(Parent, client.ref('User', '1', Parent))).data;
  expect((await client.readView(Name, parent)).data).toMatchObject({ name: 'ja' });
});

test('rejects unbound definitions and ambiguous bindings with actionable errors', () => {
  const { client } = setup();
  expect(() => client.ref('User', '1', Name)).toThrow(/bind|parameter/i);
  const Both = { ...Name({ locale: 'en' }), ...Name({ locale: 'ja' }) };
  expect(() =>
    client.readView<User, SelectionOf<typeof Name>, typeof Name>(
      Name,
      client.ref('User', '1', Both) as ViewRef<'User'>,
    ),
  ).toThrow(/ambiguous|multiple/i);
  const checkTypes = () => {
    // @ts-expect-error Parameters are checked.
    Name({ language: 'en' });
    // @ts-expect-error Factory selections are checked too.
    view<User>()(({ locale }: { locale: string }) => ({ missing: locale }));
  };
  expect(checkTypes).toBeTypeOf('function');
});

test('request descriptors and results stay stable across equivalent parameter objects', async () => {
  const { client, fetchById } = setup();
  const request = () => ({ User: { id: '1', view: Name({ locale: 'ja' }) } });
  const first = await client.request(request());
  const second = await client.request(request());
  expect(second).toBe(first);
  expect((await client.readView(Name, first.User)).data).toMatchObject({ name: 'ja' });
  expect(fetchById).toHaveBeenCalledTimes(1);
});

test('accepts parameter interfaces and snapshots caller-owned argument objects', async () => {
  interface Parameters {
    settings: { locale: string };
  }
  const InterfaceView = view<User>()(({ settings }: Parameters) => ({ name: { args: settings } }));
  const parameters: Parameters = { settings: { locale: 'ja' } };
  const bound = InterfaceView(parameters);
  parameters.settings.locale = 'en';
  const { client } = setup();
  expect((await client.readView(InterfaceView, client.ref('User', '1', bound))).data).toMatchObject(
    { name: 'ja' },
  );
});

test('unbound definitions cannot silently disappear in spreads or nested selections', () => {
  expect(() => ({ ...Name })).toThrow(/bind|parameter/i);
  type Parent = { __typename: 'Parent'; child: User };
  const Parent = view<Parent>()({ child: Name });
  expect(() => getSelectionPlan(Parent, null)).toThrow(/bind|parameter/i);
});
