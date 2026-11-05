import { cloneArgs, hashArgs } from './args.ts';
import type {
  AnyRecord,
  Entity,
  Selection,
  ValidateSelection,
  View,
  ViewPayload,
  ViewRef,
  ViewTag,
} from './types.ts';
import { getViewTag, isViewTag, ViewKind, ViewsTag } from './types.ts';
import { isTypeBranch, typeBranchPrefix } from './viewFor.ts';

type MutableSelection<T extends Entity, S extends Selection<T>> = {
  -readonly [K in keyof S]: S[K];
} extends infer Mutable extends Selection<T>
  ? Mutable
  : never;

const ParameterizedViewTag = Symbol('fate.parameterized-view');
const boundViews = new WeakMap<ViewPayload<any, any>, View<any, any>>();
const branchViewNames = new WeakMap<ReadonlySet<string>, Map<string, ReadonlySet<string>>>();
const namePayloads = new WeakMap<ReadonlySet<string>, Map<string, ViewPayload<any, any>>>();

export type ParameterizedView<T extends Entity, P extends object, S extends Selection<T>> = View<
  T,
  S
> &
  ((parameters: P) => View<T, S>);

export const addViewName = (names: Set<string>, name: string, payload: ViewPayload<any, any>) => {
  names.add(name);
  let payloads = namePayloads.get(names);
  if (!payloads) {
    payloads = new Map();
    namePayloads.set(names, payloads);
  }
  payloads.set(name, payload);
};

/** Resolve a definition using the binding carried by its ref, never ambient parameters. */
export const resolveView = <V extends View<any, any>>(view: V, ref: ViewRef<string> | null): V => {
  if (typeof view !== 'function' || !(ParameterizedViewTag in view)) {
    return view;
  }
  const definition = view[ParameterizedViewTag];
  const matches = [...(namePayloads.get(ref?.[ViewsTag] ?? new Set())?.values() ?? [])].filter(
    (payload) => payload.definition === definition,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? 'fate: Multiple bindings for this view are ambiguous. Use named fragment aliases.'
        : 'fate: Bind the view parameters before creating a request or ref.',
    );
  }
  return boundViews.get(matches[0]) as V;
};

/**
 * Collects all view payloads that apply to the given ref.
 */
export const getViewPayloads = <T extends Entity, S extends Selection<T>, V extends View<T, S>>(
  view: V,
  ref: ViewRef<T['__typename']> | null,
): ReadonlyArray<ViewPayload<T, S>> => {
  view = resolveView(view, ref);
  const result: Array<ViewPayload<T, S>> = [];
  for (const [key, value] of Object.entries(view)) {
    if (isViewTag(key) && (!ref || ref[ViewsTag]?.has(key))) {
      result.push(value);
    }
  }
  return result;
};

/**
 * Returns the set of view tags defined on a view composition.
 */
export const getViewNames = <T extends Entity, S extends Selection<T>, V extends View<T, S>>(
  view: V,
): Set<ViewTag> => {
  view = resolveView(view, null);
  const result = new Set<ViewTag>();
  for (const [key, payload] of Object.entries(view)) {
    if (isViewTag(key)) {
      addViewName(result, key, payload);
    }
  }
  return result;
};

export const collectSelectionViewNames = (names: Set<string>, selection: AnyRecord) => {
  for (const [name, value] of Object.entries(selection)) {
    if (isViewTag(name)) {
      addViewName(names, name, value as ViewPayload<any, any>);
    } else if (isTypeBranch(value)) {
      if (!branchViewNames.has(names)) {
        branchViewNames.set(names, new Map());
      }
      const prefix = `${typeBranchPrefix}${value.type}:`;
      for (const [tag, payload] of Object.entries(value.view)) {
        if (!isViewTag(tag)) {
          continue;
        }
        addViewName(names, `${prefix}${tag}`, payload);
        for (const [child, childPayload] of Object.entries(payload.select)) {
          if (isViewTag(child)) {
            addViewName(names, `${prefix}${child}`, childPayload as ViewPayload<any, any>);
          }
        }
      }
    }
  }
};

export const restoreViewNames = (names: Array<string>): ReadonlySet<string> => {
  const result = new Set(names);
  if (names.some((name) => name.startsWith(typeBranchPrefix))) {
    branchViewNames.set(result, new Map());
  }
  return result;
};

export const viewNamesForType = (names: ReadonlySet<string>, type: string): ReadonlySet<string> => {
  const byType = branchViewNames.get(names);
  if (!byType) {
    return names;
  }
  const existing = byType.get(type);
  if (existing) {
    return existing;
  }
  const prefix = `${typeBranchPrefix}${type}:`;
  const result = new Set<string>();
  const payloads = namePayloads.get(names);
  for (const name of names) {
    if (name.startsWith(typeBranchPrefix) && !name.startsWith(prefix)) {
      continue;
    }
    const tag = name.startsWith(prefix) ? name.slice(prefix.length) : name;
    const payload = payloads?.get(name);
    if (payload) {
      addViewName(result, tag, payload);
    } else {
      result.add(tag);
    }
  }
  byType.set(type, result);
  return result;
};

let id = 0;
const importMetaEnvironment = import.meta.env;
const isDevelopment =
  typeof importMetaEnvironment?.DEV === 'boolean'
    ? importMetaEnvironment.DEV
    : typeof process !== 'undefined'
      ? process.env.NODE_ENV !== 'production'
      : false;
let viewModulePath: string | null = null;

const getStableId = () => {
  if (isDevelopment) {
    try {
      const error = new Error();
      const capturesCaller = typeof Error.captureStackTrace === 'function';
      if (capturesCaller) {
        // Source-mapped stack paths can differ from import.meta.url.
        Error.captureStackTrace(error, view);
      } else if (viewModulePath == null) {
        viewModulePath = new URL(import.meta.url).pathname;
      }

      const stack = error.stack?.split('\n');
      if (stack) {
        for (let i = 1; i < stack.length; i++) {
          const frame = stack[i].trim();
          const match = frame.match(/\(?([^()]+):(\d+):(\d+)\)?$/);
          if (!match) {
            continue;
          }

          const [, source, line, column] = match;
          if (capturesCaller || !source.includes(viewModulePath!)) {
            const file = source.startsWith('at ') ? source.slice(3) : source;
            return `${/^[A-Za-z][\d+.A-Za-z-]*:/.test(file) ? new URL(file).pathname : file}:${line}:${column}`;
          }
        }
      }
    } catch {
      /* empty */
    }
  }

  return String(id++);
};

/**
 * Creates a reusable view for an object using the declared selection.
 *
 * @example
 * const PostView = view<Post>()({
 *   id: true,
 *   title: true,
 * });
 */
export function view<T extends Entity>() {
  const viewId = getStableId();

  // Contextualize callbacks before the open selection shape can widen their literals.
  function define<P extends object, const S extends Selection<T>>(
    select: (parameters: P) => S & ValidateSelection<T, S>,
  ): ParameterizedView<T, P, MutableSelection<T, S>>;
  function define<const S extends Selection<T>>(
    select: S & ValidateSelection<T, S>,
  ): View<T, MutableSelection<T, S>>;
  function define(select: Selection<T> | ((parameters: AnyRecord) => Selection<T>)) {
    const create = (select: Selection<T>, tag: ViewTag, definition?: string) => {
      const payload = Object.freeze({ definition, select, [ViewKind]: true }) as ViewPayload<T>;
      const composition = Object.freeze({ [tag]: payload });
      boundViews.set(payload, composition);
      return composition;
    };
    const tag = getViewTag(viewId);
    if (typeof select === 'function') {
      const bind = (parameters: AnyRecord) => {
        const cloned = cloneArgs(parameters, 'parameters');
        const key = hashArgs(cloned);
        return create(select(cloned), getViewTag(`${viewId}:${key}`), tag);
      };
      Object.defineProperty(bind, ParameterizedViewTag, { value: tag });
      Object.defineProperty(bind, tag, {
        enumerable: true,
        get() {
          throw new Error('fate: Bind the view parameters before spreading a view.');
        },
      });
      return Object.freeze(bind);
    }
    return create(select, tag);
  }
  return define;
}
