import { useState } from 'react';
import type { JSONValue } from '../src/protocol.ts';

type Props = Readonly<{
  /** Expand nodes up to this depth by default. */
  depth?: number;
  onRef?: (id: string) => void;
  value: JSONValue | undefined;
}>;

const isRef = (value: JSONValue): value is { $ref: string } =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  typeof (value as { $ref?: unknown }).$ref === 'string';

export function RefLink({ id, onRef }: { id: string; onRef?: (id: string) => void }) {
  return onRef ? (
    <button className="ref" onClick={() => onRef(id)} title={`Show ${id}`} type="button">
      {id}
    </button>
  ) : (
    <span className="ref">{id}</span>
  );
}

function Primitive({ value }: { value: JSONValue }) {
  if (value === null) {
    return <span className="json-null">null</span>;
  }
  switch (typeof value) {
    case 'string':
      return <span className="json-string">{JSON.stringify(value)}</span>;
    case 'number':
      return <span className="json-number">{value}</span>;
    case 'boolean':
      return <span className="json-boolean">{String(value)}</span>;
    default:
      return null;
  }
}

function Node({
  depth,
  initialDepth,
  name,
  onRef,
  value,
}: {
  depth: number;
  initialDepth: number;
  name?: string;
  onRef?: (id: string) => void;
  value: JSONValue;
}) {
  const [open, setOpen] = useState(depth < initialDepth);
  const label = name !== undefined && <span className="json-key">{name}: </span>;

  if (value === null || typeof value !== 'object') {
    return (
      <div className="json-row">
        {label}
        <Primitive value={value} />
      </div>
    );
  }

  if (isRef(value)) {
    return (
      <div className="json-row">
        {label}
        <RefLink id={value.$ref} onRef={onRef} />
      </div>
    );
  }

  const entries: ReadonlyArray<readonly [string, JSONValue]> = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value);
  const isArray = Array.isArray(value);
  const summary = isArray ? `Array(${entries.length})` : `{${entries.length}}`;

  if (entries.length === 0) {
    return (
      <div className="json-row">
        {label}
        <span className="json-null">{isArray ? '[]' : '{}'}</span>
      </div>
    );
  }

  return (
    <div className="json-node">
      <button className="json-row json-toggle" onClick={() => setOpen(!open)} type="button">
        <span className={`caret ${open ? 'open' : ''}`}>▸</span>
        {label}
        <span className="json-summary">{summary}</span>
      </button>
      {open && (
        <div className="json-children">
          {entries.map(([key, entry]) => (
            <Node
              depth={depth + 1}
              initialDepth={initialDepth}
              key={key}
              name={key}
              onRef={onRef}
              value={entry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function JsonTree({ depth = 1, onRef, value }: Props) {
  if (value === undefined) {
    return <div className="json-null">undefined</div>;
  }
  if (value === null || typeof value !== 'object' || isRef(value)) {
    return <Node depth={0} initialDepth={depth} onRef={onRef} value={value} />;
  }
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value);
  return (
    <div className="json">
      {entries.length === 0 ? (
        <span className="json-null">{Array.isArray(value) ? '[]' : '{}'}</span>
      ) : (
        entries.map(([key, entry]) => (
          <Node depth={0} initialDepth={depth} key={key} name={key} onRef={onRef} value={entry} />
        ))
      )}
    </div>
  );
}
