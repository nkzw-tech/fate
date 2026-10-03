/**
 * Preact stand-ins for the React 19 async-action APIs used by the React
 * example: `startTransition`, `useTransition`, `useActionState`,
 * `useOptimistic`, `useFormStatus` and `<form action={fn}>` (as `<Form>`).
 *
 * Preact renders synchronously and has no transition lanes, so a transition is
 * just a scope that tracks when its callback, and every action dispatched
 * synchronously inside it, settles. Pending flags stay true until then,
 * optimistic values revert when it ends, and errors are rethrown during render
 * so the nearest error boundary catches them, as in React.
 */
import { createContext, type ComponentChildren, type HTMLAttributes } from 'preact';
import { useCallback, useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';

type Transition = {
  done: Promise<void>;
  entangled: Array<PromiseLike<unknown>>;
};

let currentTransition: Transition | null = null;

const runTransition = (callback: () => unknown): Promise<void> => {
  let settle!: () => void;
  const transition: Transition = {
    done: new Promise<void>((resolve) => {
      settle = resolve;
    }),
    entangled: [],
  };

  const previousTransition = currentTransition;
  currentTransition = transition;
  let result: Promise<void>;
  try {
    const value = callback();
    result = Promise.all([value, ...transition.entangled]).then(() => {});
  } catch (error) {
    result = Promise.reject(error);
  } finally {
    currentTransition = previousTransition;
  }

  result.then(settle, settle);
  return result;
};

/**
 * Stores an error from an async callback so the next render can throw it to
 * the nearest error boundary. Call `throwIfFailed` after all other hooks.
 */
const useRethrow = () => {
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const rethrow = useCallback((error: unknown) => setFailure({ error }), []);
  const throwIfFailed = () => {
    if (failure) {
      throw failure.error;
    }
  };
  return [rethrow, throwIfFailed] as const;
};

/** React's module-level `startTransition`. */
export function startTransition(callback: () => unknown): void {
  runTransition(callback).catch(reportError);
}

/** React's `useTransition`: `isPending` stays true until the callback settles. */
export function useTransition(): [boolean, (callback: () => unknown) => void] {
  const [pendingCount, setPendingCount] = useState(0);
  const [rethrow, throwIfFailed] = useRethrow();

  const start = useCallback(
    (callback: () => unknown) => {
      setPendingCount((count) => count + 1);
      runTransition(callback)
        .catch(rethrow)
        .finally(() => setPendingCount((count) => count - 1));
    },
    [rethrow],
  );

  throwIfFailed();
  return [pendingCount > 0, start];
}

/**
 * React's `useActionState`: dispatched actions run one after another, each
 * receiving the previous state. `isPending` is true while any is queued, and a
 * thrown error is rethrown during render, skipping the remaining actions.
 */
export function useActionState<State>(
  action: (state: Awaited<State>) => State | Promise<State>,
  initialState: Awaited<State>,
): [state: Awaited<State>, dispatch: () => void, isPending: boolean];
export function useActionState<State, Payload>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
): [state: Awaited<State>, dispatch: (payload: Payload) => void, isPending: boolean];
export function useActionState<State, Payload>(
  action: (state: Awaited<State>, payload?: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
): [state: Awaited<State>, dispatch: (payload?: Payload) => void, isPending: boolean] {
  const [state, setState] = useState(initialState);
  const [pendingCount, setPendingCount] = useState(0);
  const [rethrow, throwIfFailed] = useRethrow();
  const actionRef = useRef(action);
  const valueRef = useRef(initialState);
  const tailRef = useRef<Promise<void> | null>(null);
  const failedRef = useRef(false);

  // Like React, a dispatch uses the action from the latest committed render.
  useLayoutEffect(() => {
    actionRef.current = action;
  }, [action]);

  const dispatch = useCallback(
    (payload?: Payload) => {
      const action = actionRef.current;
      const run = async () => {
        if (failedRef.current) {
          return;
        }

        try {
          const value = await action(valueRef.current, payload);
          valueRef.current = value;
          setState(() => value);
        } catch (error) {
          failedRef.current = true;
          rethrow(error);
        }
      };

      setPendingCount((count) => count + 1);
      // Start right away when idle so the synchronous part of the action runs
      // in this tick, otherwise wait for the previously queued actions.
      const previous = tailRef.current;
      const promise = (previous ? previous.then(run) : run()).finally(() => {
        setPendingCount((count) => count - 1);
        if (tailRef.current === promise) {
          tailRef.current = null;
        }
      });
      tailRef.current = promise;
      currentTransition?.entangled.push(promise);
    },
    [rethrow],
  );

  throwIfFailed();
  return [state, dispatch, pendingCount > 0];
}

/**
 * React's `useOptimistic` (without a reducer): a value set inside a transition
 * is shown until that transition settles, then reverts to `passthrough`.
 */
export function useOptimistic<T>(passthrough: T): [T, (value: T) => void] {
  const [optimistic, setOptimistic] = useState<{ value: T } | null>(null);

  const set = useCallback((value: T) => {
    const entry = { value };
    const revert = () => setOptimistic((current) => (current === entry ? null : current));
    setOptimistic(entry);
    if (currentTransition) {
      currentTransition.done.then(revert);
    } else {
      // React reverts optimistic updates made outside of a transition immediately.
      revert();
    }
  }, []);

  return [optimistic ? optimistic.value : passthrough, set];
}

const FormStatusContext = createContext<{ pending: boolean }>({ pending: false });

/** React DOM's `useFormStatus`, for forms rendered with `<Form>`. */
export const useFormStatus = () => useContext(FormStatusContext);

/**
 * `<form action={fn}>`: Preact would stringify a function `action` into the
 * DOM attribute, so submit through `onSubmit` instead and run `action` as a
 * transition with the form's data, exposing its pending state to
 * `useFormStatus`.
 */
export function Form({
  action,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLFormElement>, 'action' | 'onSubmit' | 'role'> & {
  action: (formData: FormData) => unknown;
  children?: ComponentChildren;
}) {
  const [pendingCount, setPendingCount] = useState(0);
  const [rethrow, throwIfFailed] = useRethrow();

  throwIfFailed();
  return (
    <form
      {...props}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setPendingCount((count) => count + 1);
        runTransition(() => action(formData))
          .catch(rethrow)
          .finally(() => setPendingCount((count) => count - 1));
      }}
    >
      <FormStatusContext.Provider value={{ pending: pendingCount > 0 }}>
        {children}
      </FormStatusContext.Provider>
    </form>
  );
}
