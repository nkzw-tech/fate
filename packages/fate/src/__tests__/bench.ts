import { test } from 'vite-plus/test';

type Benchmark = () => void | Promise<void>;

const bench = (name: string, fn: Benchmark) => {
  test(name, async ({ bench }) => {
    await bench(name, fn).run();
  });
};

export default bench;
