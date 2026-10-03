import { fate as coreFate, type FateViteTransport } from '@nkzw/fate/vite';

export type FateVitePluginOptions = {
  generatedFile?: false | string;
  module: string;
  transport?: FateViteTransport;
  tsconfigFile?: false | string;
};

export const fate: (options: FateVitePluginOptions) => ReturnType<typeof coreFate> = (options) =>
  coreFate({
    ...options,
    clientModule: 'preact-fate',
  } as Parameters<typeof coreFate>[0]);
