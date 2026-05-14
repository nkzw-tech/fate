import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  runnerImport,
  transformWithOxc,
  type InlineConfig,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer,
} from 'vite';
import { createClientSource } from './codegen/client.ts';
import type { FateViteTransport } from './viteTypes.ts';

type ClientRuntime = '@nkzw/fate' | 'react-fate';

type ModuleExports = Record<string, unknown>;

export type FateVitePluginOptions = {
  clientModule?: ClientRuntime;
  generatedFile?: false | string;
  module: string;
  transport?: FateViteTransport;
  tsconfigFile?: false | string;
};

export type { FateViteTransport };

const defaultClientRuntime: ClientRuntime = '@nkzw/fate';
const defaultClientModule = `${defaultClientRuntime}/client`;
const defaultGeneratedFile = '.fate/client.generated.ts';
const legacyDeclarationFile = '.fate/client.d.ts';
const defaultTsconfigFile = '.fate/tsconfig.json';
const resolvedClientModule = `\0${defaultClientModule}.ts`;

const toTsconfigPath = (fromFile: string, toFile: string) => {
  const relativePath = path.relative(path.dirname(fromFile), toFile).replaceAll(path.sep, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
};

const toGeneratedModuleName = ({
  fromFile,
  moduleName,
  root,
}: {
  fromFile: string;
  moduleName: string;
  root: string;
}) => {
  if (!moduleName.startsWith('.') && !path.isAbsolute(moduleName)) {
    return moduleName;
  }

  return toTsconfigPath(
    fromFile,
    path.isAbsolute(moduleName) ? moduleName : path.resolve(root, moduleName),
  );
};

const toVirtualRuntimeModuleName = ({ moduleName, root }: { moduleName: string; root: string }) => {
  if (!moduleName.startsWith('.') && !path.isAbsolute(moduleName)) {
    return moduleName;
  }

  const resolvedModule = path.isAbsolute(moduleName) ? moduleName : path.resolve(root, moduleName);
  const rootRelativeModule = path.relative(root, resolvedModule).replaceAll(path.sep, '/');

  return rootRelativeModule.startsWith('..') || path.isAbsolute(rootRelativeModule)
    ? `/@fs/${resolvedModule.replaceAll(path.sep, '/')}`
    : `/${rootRelativeModule}`;
};

const writeIfChanged = async (file: string, contents: string) => {
  try {
    if ((await readFile(file, 'utf8')) === contents) {
      return;
    }
  } catch {
    // The generated file does not exist yet.
  }

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
};

const removeIfExists = async (file: string) => {
  try {
    await rm(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
};

export const fate = (options: FateVitePluginOptions): Plugin => {
  const clientModule = `${options.clientModule ?? defaultClientRuntime}/client`;
  const clientModules = new Set([defaultClientModule, clientModule]);
  let config: ResolvedConfig;
  let dependencies = new Set<string>();
  let generatedSource: string | null = null;
  let generationPromise: Promise<string> | null = null;
  let server: ViteDevServer | null = null;

  const getGeneratedFile = () =>
    options.generatedFile === false
      ? null
      : path.resolve(config.root, options.generatedFile ?? defaultGeneratedFile);

  const getTsconfigFile = () =>
    options.tsconfigFile === false
      ? null
      : path.resolve(config.root, options.tsconfigFile ?? defaultTsconfigFile);

  const writeGeneratedFiles = async (moduleExports: ModuleExports) => {
    const generatedFile = getGeneratedFile();
    if (!generatedFile) {
      return;
    }

    await writeIfChanged(
      generatedFile,
      createClientSource({
        clientModule: options.clientModule ?? defaultClientRuntime,
        moduleExports,
        moduleName: toGeneratedModuleName({
          fromFile: generatedFile,
          moduleName: options.module,
          root: config.root,
        }),
        transport: options.transport ?? 'trpc',
      }),
    );
    await removeIfExists(path.resolve(config.root, legacyDeclarationFile));

    const tsconfigFile = getTsconfigFile();
    if (!tsconfigFile) {
      return;
    }

    await writeIfChanged(
      tsconfigFile,
      `${JSON.stringify(
        {
          files: [toTsconfigPath(tsconfigFile, generatedFile)],
        },
        null,
        2,
      )}\n`,
    );
  };

  const importServerModule = async () => {
    const inlineConfig: InlineConfig = {
      configFile: false,
      mode: config.mode,
      resolve: {
        alias: config.resolve.alias,
        conditions: config.resolve.conditions,
      },
      root: config.root,
    };

    const result = await runnerImport<ModuleExports>(options.module, inlineConfig);
    dependencies = new Set(result.dependencies.map((dependency) => path.normalize(dependency)));
    return result.module;
  };

  const generate = async () => {
    const moduleExports = await importServerModule();
    const source = createClientSource({
      clientModule: options.clientModule ?? defaultClientRuntime,
      moduleExports,
      moduleName: options.module,
      runtimeModuleName: toVirtualRuntimeModuleName({
        moduleName: options.module,
        root: config.root,
      }),
      transport: options.transport ?? 'trpc',
    });

    generatedSource = source;
    await writeGeneratedFiles(moduleExports);
    server?.watcher.add([...dependencies]);

    return source;
  };

  const ensureGenerated = () => {
    generationPromise ??= generate().finally(() => {
      generationPromise = null;
    });

    return generationPromise;
  };

  return {
    buildStart: async function () {
      await ensureGenerated();

      const resolvedServerModule = await this.resolve(options.module);
      if (resolvedServerModule) {
        dependencies.add(path.normalize(resolvedServerModule.id));
      }

      for (const dependency of dependencies) {
        this.addWatchFile(dependency);
      }
    },
    config: () => ({
      ssr: {
        noExternal: [
          ...new Set([defaultClientRuntime, options.clientModule ?? defaultClientRuntime]),
        ],
      },
    }),
    configResolved: (resolvedConfig) => {
      config = resolvedConfig;
    },
    configureServer: (viteServer) => {
      server = viteServer;
    },
    enforce: 'pre',
    handleHotUpdate: async ({ file, server: viteServer }) => {
      if (!dependencies.has(path.normalize(file))) {
        return;
      }

      generatedSource = null;
      await ensureGenerated();

      const clientModuleNode = viteServer.moduleGraph.getModuleById(resolvedClientModule);
      if (clientModuleNode) {
        viteServer.moduleGraph.invalidateModule(clientModuleNode);
        return [clientModuleNode];
      }
    },
    load: async (id) => {
      if (id !== resolvedClientModule) {
        return;
      }

      return transformWithOxc(generatedSource ?? (await ensureGenerated()), id, {
        lang: 'ts',
      });
    },
    name: '@nkzw/fate',
    resolveId: (id) => (clientModules.has(id) ? resolvedClientModule : undefined),
  };
};
