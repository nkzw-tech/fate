import type { EntityId } from './types.ts';

export type ViewCoverage = ReadonlyMap<EntityId, ReadonlySet<string>> & { share?: () => void };

// Ownership belongs to a single walk. A global WeakSet of shared field sets can
// retain a large backing table after millions of short-lived dependency sets.
// Completed coverage is immutable; readers copy its sets before adding fields.
export class ViewCoverageBuilder extends Map<EntityId, Set<string>> {
  // Fresh walks own all fields until they borrow a set from completed coverage.
  // Avoid an extra per-entity index for walks that rebuild every dependency.
  private owned?: Set<EntityId>;

  constructor(
    entries?: Iterable<readonly [EntityId, Set<string>]>,
    private previous?: ViewCoverage,
  ) {
    super(entries);
  }

  addField(id: EntityId, field: string) {
    const fields = this.get(id);
    if (fields) {
      if (!fields.has(field)) {
        this.own(id).add(field);
      }
      return;
    }
    const previous = this.previous?.get(id);
    if (previous && previous.size === 1 && previous.has(field)) {
      this.useShared(id, previous);
    } else {
      this.set(id, new Set<string>().add(field));
      this.owned?.add(id);
    }
  }

  own(id: EntityId) {
    let fields = this.get(id);
    if (!fields || (this.owned && !this.owned.has(id))) {
      fields = new Set(fields);
      this.set(id, fields);
      this.owned?.add(id);
    }
    return fields;
  }

  share() {
    this.previous = undefined;
    this.owned = new Set();
  }

  private useShared(id: EntityId, fields: ReadonlySet<string>) {
    this.owned ??= new Set(this.keys());
    this.owned.delete(id);
    this.set(id, fields as Set<string>);
  }

  merge(id: EntityId, fields: ReadonlySet<string>) {
    const previous = this.get(id);
    if (!previous) {
      this.useShared(id, fields);
    } else if (previous !== fields) {
      let next: Set<string> | undefined;
      for (const field of fields) {
        if (!previous.has(field)) {
          (next ??= this.own(id)).add(field);
        }
      }
    }
  }
}

export function addViewCoverage(target: ViewCoverageBuilder, id: EntityId, field: string) {
  target.addField(id, field);
}

export function mergeViewCoverage(target: ViewCoverageBuilder, source: ViewCoverage) {
  source.share?.();
  for (const [id, fields] of source) {
    target.merge(id, fields);
  }
}
