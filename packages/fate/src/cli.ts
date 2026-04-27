#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, styleText } from 'node:util';
import { createClientSource } from './codegen/client.ts';

const root = process.cwd();

const isClientTransport = (value: unknown): value is 'native' | 'trpc' =>
  value === 'native' || value === 'trpc';

const usage = (message?: string): never => {
  if (message) {
    console.error(styleText('red', message));
    console.error();
  }

  console.error(
    `${styleText('bold', 'Usage:')} ${styleText('blue', `pnpm fate generate <moduleName> <targetFile>`)}

Generates the fate client from a server module.

  ${styleText('dim', '<moduleName>')}  The server module to import.
  ${styleText('dim', '<targetFile>')}  The file path to write the generated client to.
  ${styleText('dim', '--transport')}   Transport target: "trpc" (default) or "native".
  
  ${styleText('bold', 'Example:')} ${styleText('blue', `pnpm fate generate @org/server/trpc/router.ts client/lib/fate.ts`)}
  ${styleText('bold', 'Native:')}  ${styleText('blue', `pnpm fate generate --transport native @org/server/http.ts client/lib/fate.ts`)}
`,
  );
  process.exit(1);
};

const parsedArgs: ReturnType<typeof parseArgs> = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        transport: {
          default: 'trpc',
          type: 'string',
        },
      },
    });
  } catch (error) {
    return usage(error instanceof Error ? error.message : undefined);
  }
})();

const [command, moduleName, targetFile] = parsedArgs.positionals;
const parsedTransport = parsedArgs.values.transport;

const clientTransport = isClientTransport(parsedTransport)
  ? parsedTransport
  : usage(`Invalid transport '${String(parsedTransport)}'.`);

if (command !== 'generate' || !moduleName || !targetFile) {
  usage();
}

const serverModuleName = moduleName;
const outputTargetFile = targetFile;

const generate = async () => {
  console.log(styleText('bold', `Generating fate client…\n`));

  const moduleExports = await import(serverModuleName);
  const outputPath = path.join(root, outputTargetFile);
  writeFileSync(
    outputPath,
    createClientSource({ moduleExports, moduleName: serverModuleName, transport: clientTransport }),
  );

  console.log(
    styleText('green', `  \u2713 fate client generated at '${path.relative(root, outputPath)}'.`),
  );
};

await generate();
