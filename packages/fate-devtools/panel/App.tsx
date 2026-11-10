import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  parseListKey,
  type ChangeEntry,
  type ClientSnapshot,
  type DevtoolsAction,
  type ListEntry,
  type OperationEntry,
  type RecordEntry,
  type RequestEntry,
} from '../src/protocol.ts';
import JsonTree, { RefLink } from './JsonTree.tsx';
import useDevtools from './useDevtools.ts';

type Tab = 'cache' | 'requests' | 'network' | 'lists' | 'changes';

type Selection = Readonly<Partial<Record<Tab, string>>>;

type Navigate = Readonly<{
  list: (key: string) => void;
  record: (id: string) => void;
}>;

const tabs: ReadonlyArray<readonly [Tab, string]> = [
  ['cache', 'Cache'],
  ['requests', 'Requests'],
  ['network', 'Network'],
  ['lists', 'Lists'],
  ['changes', 'Changes'],
];

const formatTime = (time: number) => {
  const date = new Date(time);
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`;
};

const formatDuration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);

const useNow = (active: boolean) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) {
      return;
    }
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [active]);
  return now;
};

const labelFields = ['title', 'name', 'displayName', 'username', 'label', 'content', 'text'];

/** A short human-readable label for a record, so rows are not just IDs. */
const recordLabel = (record: RecordEntry) => {
  const value = record.record;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  for (const field of labelFields) {
    const label = (value as Record<string, unknown>)[field];
    if (typeof label === 'string' && label.trim()) {
      return label.length > 80 ? `${label.slice(0, 80)}…` : label;
    }
  }
  return null;
};

const matches = (query: string, ...values: ReadonlyArray<string | undefined>) => {
  const needle = query.trim().toLowerCase();
  return !needle || values.some((value) => value?.toLowerCase().includes(needle));
};

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Section({
  actions,
  children,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="section">
      <header className="section-header">
        <h3>{title}</h3>
        {actions}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

function MasterDetail({
  detail,
  filter,
  list,
  onFilter,
  placeholder,
  toolbar,
}: {
  detail: ReactNode;
  filter: string;
  list: ReactNode;
  onFilter: (value: string) => void;
  placeholder: string;
  toolbar?: ReactNode;
}) {
  return (
    <div className="master-detail">
      <div className="master">
        <div className="filter">
          <input
            onChange={(event) => onFilter(event.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            type="search"
            value={filter}
          />
        </div>
        {toolbar}
        <div className="rows">{list}</div>
      </div>
      <div className="detail">{detail}</div>
    </div>
  );
}

function Row({
  children,
  onSelect,
  selected,
}: {
  children: ReactNode;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button className={`row ${selected ? 'selected' : ''}`} onClick={onSelect} type="button">
      {children}
    </button>
  );
}

/* Cache */

function CacheTab({
  navigate,
  run,
  selected,
  snapshot,
}: {
  navigate: Navigate;
  run: (action: DevtoolsAction) => void;
  selected: string | undefined;
  snapshot: ClientSnapshot;
}) {
  const [filter, setFilter] = useState('');
  const [type, setType] = useState<string | null>(null);
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of snapshot.records) {
      counts.set(record.type, (counts.get(record.type) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [snapshot.records]);
  const records = snapshot.records
    .filter(
      (record) =>
        (!type || record.type === type) &&
        matches(filter, record.id, JSON.stringify(record.record)),
    )
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const record = snapshot.records.find(({ id }) => id === selected);

  return (
    <MasterDetail
      detail={
        record ? (
          <RecordDetail navigate={navigate} record={record} run={run} snapshot={snapshot} />
        ) : (
          <Empty>Select a record to inspect its data, loaded fields, and list memberships.</Empty>
        )
      }
      filter={filter}
      list={
        records.length ? (
          records.map((entry) => (
            <Row
              key={entry.id}
              onSelect={() => navigate.record(entry.id)}
              selected={entry.id === selected}
            >
              <span className="row-title">
                <span className="type">{entry.type}</span>
                <span className="label">
                  {recordLabel(entry) ?? <span className="muted">{entry.rawId}</span>}
                </span>
              </span>
              <span className="row-meta">
                {entry.optimistic && <Badge tone="purple">optimistic</Badge>}
                {entry.stale.length > 0 && <Badge tone="amber">stale</Badge>}
                <span className="muted">{entry.coverage.length} fields</span>
              </span>
            </Row>
          ))
        ) : (
          <Empty>{snapshot.records.length ? 'No matching records.' : 'The cache is empty.'}</Empty>
        )
      }
      onFilter={setFilter}
      placeholder="Filter records by id or value…"
      toolbar={
        typeCounts.length > 1 && (
          <div className="chips">
            <button
              className={`chip ${type === null ? 'active' : ''}`}
              onClick={() => setType(null)}
              type="button"
            >
              All <span className="count">{snapshot.records.length}</span>
            </button>
            {typeCounts.map(([name, count]) => (
              <button
                className={`chip ${type === name ? 'active' : ''}`}
                key={name}
                onClick={() => setType(type === name ? null : name)}
                type="button"
              >
                {name} <span className="count">{count}</span>
              </button>
            ))}
          </div>
        )
      }
    />
  );
}

function RecordDetail({
  navigate,
  record,
  run,
  snapshot,
}: {
  navigate: Navigate;
  record: RecordEntry;
  run: (action: DevtoolsAction) => void;
  snapshot: ClientSnapshot;
}) {
  const stale = new Set(record.stale);
  const changes = snapshot.changes
    .filter(({ key }) => key === record.id)
    .slice(-20)
    .reverse();
  const referencedBy = snapshot.records.filter(
    ({ id, record: value }) =>
      id !== record.id && JSON.stringify(value).includes(`"$ref":"${record.id}"`),
  );

  return (
    <div className="detail-body">
      <header className="detail-header">
        <div>
          <h2>
            <span className="type">{record.type}</span>
            <span className="muted">:</span>
            {record.rawId}
          </h2>
          <div className="detail-badges">
            {record.optimistic && <Badge tone="purple">optimistic</Badge>}
            {record.stale.length > 0 && <Badge tone="amber">{record.stale.length} stale</Badge>}
            <Badge>{record.coverage.length} fields loaded</Badge>
          </div>
        </div>
        <div className="button-group">
          <button onClick={() => run({ id: record.id, type: 'invalidate-record' })} type="button">
            Invalidate
          </button>
          <button onClick={() => run({ id: record.id, type: 'log-record' })} type="button">
            Log to console
          </button>
          <button
            className="danger"
            onClick={() => run({ id: record.id, type: 'delete-record' })}
            type="button"
          >
            Remove
          </button>
        </div>
      </header>
      <Section title="Data">
        <JsonTree depth={2} onRef={navigate.record} value={record.record} />
      </Section>
      <Section title="Loaded fields">
        <div className="paths">
          {record.coverage.map((path) => (
            <span className={`path ${stale.has(path) ? 'stale' : ''}`} key={path}>
              {path}
            </span>
          ))}
        </div>
      </Section>
      {record.lists.length > 0 && (
        <Section title="In lists">
          <div className="link-list">
            {record.lists.map((key) => (
              <ListLabel key={key} listKey={key} onSelect={() => navigate.list(key)} />
            ))}
          </div>
        </Section>
      )}
      {referencedBy.length > 0 && (
        <Section title="Referenced by">
          <div className="paths">
            {referencedBy.map(({ id }) => (
              <RefLink id={id} key={id} onRef={navigate.record} />
            ))}
          </div>
        </Section>
      )}
      {changes.length > 0 && (
        <Section title="Recent changes">
          <ChangeRows changes={changes} />
        </Section>
      )}
    </div>
  );
}

/* Lists */

/** List hashes for lists without arguments. */
const defaultListHashes = new Set(['default', 'object:{}']);

function ListLabel({ listKey, onSelect }: { listKey: string; onSelect?: () => void }) {
  const { field, hash, owner } = parseListKey(listKey);
  const content = (
    <>
      {owner && <span className="type">{owner}</span>}
      {owner && <span className="muted">.</span>}
      <span>{field}</span>
      {!defaultListHashes.has(hash) && <span className="muted hash">({hash})</span>}
    </>
  );
  return onSelect ? (
    <button className="link" onClick={onSelect} type="button">
      {content}
    </button>
  ) : (
    <span>{content}</span>
  );
}

function ListsTab({
  navigate,
  selected,
  snapshot,
}: {
  navigate: Navigate;
  selected: string | undefined;
  snapshot: ClientSnapshot;
}) {
  const [filter, setFilter] = useState('');
  const lists = snapshot.lists.filter((list) => matches(filter, list.key, list.ids.join(' ')));
  const list = snapshot.lists.find(({ key }) => key === selected);
  return (
    <MasterDetail
      detail={
        list ? (
          <ListDetail list={list} navigate={navigate} />
        ) : (
          <Empty>Select a list to see its items and pagination state.</Empty>
        )
      }
      filter={filter}
      list={
        lists.length ? (
          lists.map((entry) => (
            <Row
              key={entry.key}
              onSelect={() => navigate.list(entry.key)}
              selected={entry.key === selected}
            >
              <span className="row-title">
                <ListLabel listKey={entry.key} />
              </span>
              <span className="row-meta">
                {entry.optimistic && <Badge tone="purple">optimistic</Badge>}
                <span className="muted">{entry.ids.length} items</span>
              </span>
            </Row>
          ))
        ) : (
          <Empty>{snapshot.lists.length ? 'No matching lists.' : 'No lists are cached.'}</Empty>
        )
      }
      onFilter={setFilter}
      placeholder="Filter lists…"
    />
  );
}

function ListDetail({ list, navigate }: { list: ListEntry; navigate: Navigate }) {
  const { ids: _ids, ...state } = list.state as Record<string, never>;
  return (
    <div className="detail-body">
      <header className="detail-header">
        <div>
          <h2>
            <ListLabel listKey={list.key} />
          </h2>
          <div className="detail-badges">
            {list.optimistic && <Badge tone="purple">optimistic</Badge>}
            <Badge>{list.ids.length} items</Badge>
            {list.owner && list.owner !== '__root__' && (
              <span className="muted">
                owned by <RefLink id={list.owner} onRef={navigate.record} />
              </span>
            )}
          </div>
        </div>
      </header>
      {list.pagination !== undefined && (
        <Section title="Pagination">
          <JsonTree depth={1} value={list.pagination} />
        </Section>
      )}
      <Section title="Items">
        <ol className="id-list">
          {list.ids.map((id, index) => (
            <li key={`${id}-${index}`}>
              <RefLink id={id} onRef={navigate.record} />
            </li>
          ))}
        </ol>
      </Section>
      <Section title="State">
        <JsonTree depth={1} value={state} />
      </Section>
    </div>
  );
}

/* Requests */

const describeItem = (item: RequestEntry['items'][number]) => {
  switch (item.kind) {
    case 'node':
      return `${item.type}(${item.ids?.join(', ')})`;
    case 'nodes':
      return `${item.type}[${item.ids?.length ?? 0}]`;
    case 'list':
      return `${item.procedure ?? item.name}[]`;
    default:
      return `${item.procedure ?? item.name}()`;
  }
};

const requestStatus = (request: RequestEntry) => {
  const statuses = request.modes.map(({ status }) => status);
  return statuses.includes('pending')
    ? 'pending'
    : statuses.includes('rejected')
      ? 'error'
      : request.retainers > 0
        ? 'active'
        : 'inactive';
};

const statusTone: Record<string, string> = {
  active: 'green',
  closed: 'neutral',
  error: 'red',
  inactive: 'neutral',
  live: 'blue',
  pending: 'amber',
  success: 'green',
};

function RequestsTab({
  navigate,
  onSelect,
  selected,
  snapshot,
}: {
  navigate: Navigate;
  onSelect: (key: string) => void;
  selected: string | undefined;
  snapshot: ClientSnapshot;
}) {
  const [filter, setFilter] = useState('');
  const requests = snapshot.requests.filter((request) =>
    matches(filter, ...request.items.map((item) => `${item.name} ${describeItem(item)}`)),
  );
  const request = snapshot.requests.find(({ key }) => key === selected);
  return (
    <MasterDetail
      detail={
        request ? (
          <RequestDetail navigate={navigate} request={request} />
        ) : (
          <Empty>
            Select a request to see its roots, arguments, and the fields it selects. Requests stay
            here while a component or `retain` call holds them.
          </Empty>
        )
      }
      filter={filter}
      list={
        requests.length ? (
          requests.map((entry) => {
            const status = requestStatus(entry);
            return (
              <Row
                key={entry.key}
                onSelect={() => onSelect(entry.key)}
                selected={entry.key === selected}
              >
                <span className="row-title">
                  <span className={`dot dot-${statusTone[status]}`} />
                  {entry.items.map((item) => item.name).join(', ')}
                </span>
                <span className="row-meta">
                  <span className="muted">{entry.retainers} observers</span>
                  <Badge tone={statusTone[status]}>{status}</Badge>
                </span>
              </Row>
            );
          })
        ) : (
          <Empty>No requests are retained.</Empty>
        )
      }
      onFilter={setFilter}
      placeholder="Filter requests…"
    />
  );
}

function RequestDetail({ navigate, request }: { navigate: Navigate; request: RequestEntry }) {
  const status = requestStatus(request);
  return (
    <div className="detail-body">
      <header className="detail-header">
        <div>
          <h2>{request.items.map((item) => item.name).join(', ')}</h2>
          <div className="detail-badges">
            <Badge tone={statusTone[status]}>{status}</Badge>
            <Badge>{request.retainers} observers</Badge>
            {request.modes.map(({ mode, status }) => (
              <Badge key={mode}>
                {mode}: {status}
              </Badge>
            ))}
          </div>
        </div>
      </header>
      {request.items.map((item) => (
        <Section key={item.name} title={`${item.name} · ${item.kind}`}>
          <dl className="props">
            <dt>Root</dt>
            <dd className="mono">{describeItem(item)}</dd>
            {item.type && (
              <>
                <dt>Type</dt>
                <dd className="mono">{item.type}</dd>
              </>
            )}
            {item.ids && (
              <>
                <dt>IDs</dt>
                <dd className="paths">
                  {item.ids.map((id) => (
                    <RefLink id={`${item.type}:${id}`} key={id} onRef={navigate.record} />
                  ))}
                </dd>
              </>
            )}
            {item.args !== undefined && (
              <>
                <dt>Arguments</dt>
                <dd>
                  <JsonTree depth={2} value={item.args} />
                </dd>
              </>
            )}
            <dt>Selection</dt>
            <dd className="paths">
              {item.paths.map((path) => (
                <span className="path" key={path}>
                  {path}
                </span>
              ))}
            </dd>
          </dl>
        </Section>
      ))}
    </div>
  );
}

/* Network */

const kindLabel: Record<OperationEntry['kind'], string> = {
  fetchById: 'byId',
  fetchList: 'list',
  fetchQuery: 'query',
  mutate: 'mutation',
  mutateDurably: 'mutation',
  subscribeById: 'live',
  subscribeConnection: 'live',
};

function NetworkTab({
  onSelect,
  selected,
  snapshot,
}: {
  onSelect: (id: string) => void;
  selected: string | undefined;
  snapshot: ClientSnapshot;
}) {
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const pending = snapshot.operations.some(({ status }) => status === 'pending');
  const now = useNow(pending);
  const operations = snapshot.operations
    .filter(
      (operation) =>
        (!kind || kindLabel[operation.kind] === kind) &&
        matches(filter, operation.name, operation.kind),
    )
    .toReversed();
  const operation = snapshot.operations.find(({ id }) => String(id) === selected);
  const kinds = ['byId', 'list', 'query', 'mutation', 'live'];

  return (
    <MasterDetail
      detail={
        operation ? (
          <OperationDetail now={now} operation={operation} />
        ) : (
          <Empty>
            Select an operation to see what fate asked the server for and what came back.
          </Empty>
        )
      }
      filter={filter}
      list={
        operations.length ? (
          operations.map((entry) => (
            <Row
              key={entry.id}
              onSelect={() => onSelect(String(entry.id))}
              selected={String(entry.id) === selected}
            >
              <span className="row-title">
                <span className={`dot dot-${statusTone[entry.status]}`} />
                <span className={`kind kind-${kindLabel[entry.kind]}`}>
                  {kindLabel[entry.kind]}
                </span>
                {entry.name}
              </span>
              <span className="row-meta">
                {entry.events !== undefined && <span className="muted">{entry.events} events</span>}
                <span className="muted">
                  {entry.kind.startsWith('subscribe')
                    ? entry.status
                    : formatDuration((entry.endedAt ?? now) - entry.startedAt)}
                </span>
              </span>
            </Row>
          ))
        ) : (
          <Empty>No network activity yet.</Empty>
        )
      }
      onFilter={setFilter}
      placeholder="Filter operations…"
      toolbar={
        <div className="chips">
          <button
            className={`chip ${kind === null ? 'active' : ''}`}
            onClick={() => setKind(null)}
            type="button"
          >
            All
          </button>
          {kinds.map((name) => (
            <button
              className={`chip ${kind === name ? 'active' : ''}`}
              key={name}
              onClick={() => setKind(kind === name ? null : name)}
              type="button"
            >
              {name}
            </button>
          ))}
        </div>
      }
    />
  );
}

function OperationDetail({ now, operation }: { now: number; operation: OperationEntry }) {
  return (
    <div className="detail-body">
      <header className="detail-header">
        <div>
          <h2>
            <span className={`kind kind-${kindLabel[operation.kind]}`}>{operation.kind}</span>
            {operation.name}
          </h2>
          <div className="detail-badges">
            <Badge tone={statusTone[operation.status]}>{operation.status}</Badge>
            <span className="muted">
              {formatTime(operation.startedAt)} ·{' '}
              {formatDuration((operation.endedAt ?? now) - operation.startedAt)}
            </span>
            {operation.events !== undefined && <Badge tone="blue">{operation.events} events</Badge>}
          </div>
        </div>
      </header>
      {operation.error && (
        <Section title="Error">
          <pre className="error">{operation.error}</pre>
        </Section>
      )}
      {operation.input !== undefined && (
        <Section title="Input">
          <JsonTree depth={2} value={operation.input} />
        </Section>
      )}
      {operation.args !== undefined && operation.args !== null && (
        <Section title="Arguments">
          <JsonTree depth={2} value={operation.args} />
        </Section>
      )}
      <Section title={`Selection (${operation.select.length})`}>
        <div className="paths">
          {operation.select.map((path) => (
            <span className="path" key={path}>
              {path}
            </span>
          ))}
        </div>
      </Section>
      {operation.result !== undefined && (
        <Section title={operation.kind.startsWith('subscribe') ? 'Last event' : 'Response'}>
          <JsonTree depth={2} value={operation.result} />
        </Section>
      )}
    </div>
  );
}

/* Changes */

function ChangeRows({
  changes,
  onList,
  onRecord,
}: {
  changes: ReadonlyArray<ChangeEntry>;
  onList?: (key: string) => void;
  onRecord?: (id: string) => void;
}) {
  return (
    <table className="changes">
      <tbody>
        {changes.map((change) => (
          <tr key={change.id}>
            <td className="muted mono">{formatTime(change.at)}</td>
            <td>
              <Badge tone={change.kind === 'list' ? 'blue' : 'neutral'}>{change.kind}</Badge>
            </td>
            <td className="mono">
              {change.kind === 'record' ? (
                <RefLink id={change.key} onRef={onRecord} />
              ) : (
                <ListLabel listKey={change.key} onSelect={onList && (() => onList(change.key))} />
              )}
            </td>
            <td>
              {change.invalidated && <Badge tone="amber">invalidated</Badge>}
              {change.optimistic && <Badge tone="purple">optimistic</Badge>}{' '}
              {change.paths && <span className="muted mono">{change.paths.join(', ')}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangesTab({ navigate, snapshot }: { navigate: Navigate; snapshot: ClientSnapshot }) {
  const [filter, setFilter] = useState('');
  const changes = snapshot.changes
    .filter((change) => matches(filter, change.key, change.paths?.join(' ')))
    .toReversed();
  return (
    <div className="log">
      <div className="filter">
        <input
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter changes…"
          spellCheck={false}
          type="search"
          value={filter}
        />
      </div>
      {changes.length ? (
        <ChangeRows changes={changes} onList={navigate.list} onRecord={navigate.record} />
      ) : (
        <Empty>No cache changes recorded yet.</Empty>
      )}
    </div>
  );
}

/* Shell */

function Waiting() {
  return (
    <div className="waiting">
      <div className="logo large">f</div>
      <h2>Waiting for a fate client…</h2>
      <p>Connect your client in development:</p>
      <pre className="code">{`import { connectFateDevtools } from '@nkzw/fate-devtools';

if (import.meta.env.DEV) {
  connectFateDevtools(fate);
}`}</pre>
      <p>
        Or, with React, render <code>{'<FateDevtools />'}</code> from{' '}
        <code>@nkzw/fate-devtools/react</code> inside <code>{'<FateClient>'}</code>.
      </p>
    </div>
  );
}

export default function App() {
  const { clients, hostPageId, run, select, selectedId, snapshot } = useDevtools();
  const [tab, setTab] = useState<Tab>('cache');
  const [selection, setSelection] = useState<Selection>({});

  const choose = (target: Tab, key: string) => {
    setTab(target);
    setSelection((current) => ({ ...current, [target]: key }));
  };
  const navigate: Navigate = {
    list: (key) => choose('lists', key),
    record: (id) => choose('cache', id),
  };

  if (!snapshot) {
    return clients.length ? <div className="empty">Loading…</div> : <Waiting />;
  }

  const counts: Record<Tab, number> = {
    cache: snapshot.records.length,
    changes: snapshot.changes.length,
    lists: snapshot.lists.length,
    network: snapshot.operations.length,
    requests: snapshot.requests.length,
  };
  const pending = snapshot.operations.filter(({ status }) => status === 'pending').length;
  const live = snapshot.operations.filter(({ status }) => status === 'live').length;
  const stale = snapshot.records.filter(({ stale }) => stale.length > 0).length;

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="logo">f</span>
          <span className="brand-name">fate</span>
          {clients.length > 1 && (
            <select onChange={(event) => select(event.target.value)} value={selectedId ?? ''}>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                  {client.pageId === hostPageId ? '' : ` · ${new URL(client.url).pathname}`} (
                  {client.id})
                </option>
              ))}
            </select>
          )}
        </div>
        <nav className="tabs">
          {tabs.map(([id, label]) => (
            <button
              className={`tab ${tab === id ? 'active' : ''}`}
              key={id}
              onClick={() => setTab(id)}
              type="button"
            >
              {label}
              <span className="count">{counts[id]}</span>
            </button>
          ))}
        </nav>
        <div className="stats">
          {pending > 0 && <Badge tone="amber">{pending} in flight</Badge>}
          {live > 0 && <Badge tone="blue">{live} live</Badge>}
          {stale > 0 && <Badge tone="amber">{stale} stale</Badge>}
          {snapshot.optimisticUpdates && <Badge tone="purple">optimistic updates</Badge>}
        </div>
        <div className="button-group">
          <button
            onClick={() => run({ type: 'invalidate-all' })}
            title="Mark every record stale"
            type="button"
          >
            Invalidate all
          </button>
          <button onClick={() => run({ type: 'gc' })} title="Run garbage collection" type="button">
            Collect garbage
          </button>
          <button
            onClick={() => run({ type: 'clear-log' })}
            title="Clear network and change logs"
            type="button"
          >
            Clear log
          </button>
        </div>
      </header>
      <main className="content">
        {tab === 'cache' && (
          <CacheTab navigate={navigate} run={run} selected={selection.cache} snapshot={snapshot} />
        )}
        {tab === 'requests' && (
          <RequestsTab
            navigate={navigate}
            onSelect={(key) => choose('requests', key)}
            selected={selection.requests}
            snapshot={snapshot}
          />
        )}
        {tab === 'network' && (
          <NetworkTab
            onSelect={(id) => choose('network', id)}
            selected={selection.network}
            snapshot={snapshot}
          />
        )}
        {tab === 'lists' && (
          <ListsTab navigate={navigate} selected={selection.lists} snapshot={snapshot} />
        )}
        {tab === 'changes' && <ChangesTab navigate={navigate} snapshot={snapshot} />}
      </main>
    </div>
  );
}
