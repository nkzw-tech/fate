import { fate as coreFate } from '@nkzw/fate/vite';

export type FateVitePluginOptions = {
  generatedFile?: false | string;
  module: string;
  transport?: 'native' | 'trpc';
  tsconfigFile?: false | string;
};

export const fate: (options: FateVitePluginOptions) => ReturnType<typeof coreFate> = (options) =>
  coreFate({
    ...options,
    clientModule: 'react-fate',
  } as Parameters<typeof coreFate>[0]);
