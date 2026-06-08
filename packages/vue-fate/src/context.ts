import type { FateClient as FateClientT, FateMutations } from '@nkzw/fate';
import {
  computed,
  defineComponent,
  inject,
  isRef,
  provide,
  shallowRef,
  toValue,
  type App,
  type ComputedRef,
  type InjectionKey,
  type MaybeRefOrGetter,
  type PropType,
  type Plugin,
  type Ref,
} from 'vue';
import type { Roots } from './useRequest.ts';

type GeneratedFateClient = ReturnType<typeof import('vue-fate/client').createFateClient>;
type Mutations = [GeneratedFateClient] extends [never]
  ? FateMutations
  : GeneratedFateClient extends FateClientT<any, infer M>
    ? M
    : FateMutations;

type FateClientSource = ComputedRef<FateClientT<any, any>> | Ref<FateClientT<any, any>>;

export const FateClientKey: InjectionKey<FateClientSource> = Symbol('FateClient');

const clientProxyCache = new WeakMap<FateClientSource, FateClientT<any, any>>();
const FateClientSourceTag: unique symbol = Symbol('FateClientSource');

/**
 * Provides a configured fate client to Vue composables.
 */
export const FateClient = defineComponent({
  name: 'FateClient',
  props: {
    client: {
      required: true,
      type: [Function, Object] as PropType<MaybeRefOrGetter<FateClientT<any, any>>>,
    },
  },
  setup(props, { slots }) {
    provide(
      FateClientKey,
      computed(() => toValue(props.client)),
    );
    return () => slots.default?.();
  },
});

const toClientSource = (client: MaybeRefOrGetter<FateClientT<any, any>>): FateClientSource =>
  typeof client === 'function'
    ? computed(client as () => FateClientT<any, any>)
    : isRef(client)
      ? client
      : shallowRef(toValue(client));

export const provideFateClient = (client: MaybeRefOrGetter<FateClientT<any, any>>) => {
  provide(FateClientKey, toClientSource(client));
};

export const createFatePlugin = (client: MaybeRefOrGetter<FateClientT<any, any>>): Plugin => ({
  install(app: App) {
    app.provide(FateClientKey, toClientSource(client));
  },
});

function injectFateClientSource(): FateClientSource {
  const client = inject(FateClientKey, null);
  if (!client) {
    throw new Error(`vue-fate: '<FateClient :client="fate">' is missing.`);
  }
  return client;
}

const createClientProxy = (source: FateClientSource): FateClientT<any, any> =>
  new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === FateClientSourceTag) {
        return source;
      }

      const value = Reflect.get(source.value, property);
      return typeof value === 'function' ? value.bind(source.value) : value;
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(source.value, property);
      return descriptor ? { ...descriptor, configurable: true } : descriptor;
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(source.value);
    },
    has(_target, property) {
      return property in source.value;
    },
    ownKeys() {
      return Reflect.ownKeys(source.value);
    },
    set(_target, property, value) {
      return Reflect.set(source.value, property, value);
    },
  }) as FateClientT<any, any>;

export const getFateClientSource = (client: FateClientT<any, any>): FateClientSource => {
  const source = (
    client as FateClientT<any, any> & {
      readonly [FateClientSourceTag]?: FateClientSource;
    }
  )[FateClientSourceTag];
  if (!source) {
    throw new Error(`vue-fate: internal client source is missing.`);
  }
  return source;
};

/**
 * Returns the nearest fate client from Vue dependency injection.
 */
export function useFateClient<T extends [Roots, Mutations] = [Roots, Mutations]>(): FateClientT<
  T[0],
  T[1]
> {
  const source = injectFateClientSource();
  let proxy = clientProxyCache.get(source);
  if (!proxy) {
    proxy = createClientProxy(source);
    clientProxyCache.set(source, proxy);
  }
  return proxy as FateClientT<T[0], T[1]>;
}
