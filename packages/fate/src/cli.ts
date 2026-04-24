#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';
import { createClientSource } from './codegen/client.ts';

const root = process.cwd();
const [, , command, moduleName, targetFile] = process.argv;

if (command !== 'generate' || !moduleName || !targetFile) {
  console.error(
    `${styleText('bold', 'Usage:')} ${styleText('blue', `pnpm fate generate <moduleName> <targetFile>`)}

Generates the fate client from the server's tRPC router.

  ${styleText('dim', '<moduleName>')}  The module name to import the tRPC router from.
  ${styleText('dim', '<targetFile>')}  The file path to write the generated client to.
  
  ${styleText('bold', 'Example:')} ${styleText('blue', `pnpm fate generate @org/server/trpc/router.ts client/lib/fate.ts`)}
`,
  );
  process.exit(1);
}

const generate = async () => {
  console.log(styleText('bold', `Generating fate client…\n`));

  const moduleExports = await import(moduleName);
  const outputPath = path.join(root, targetFile);
  writeFileSync(outputPath, createClientSource({ moduleExports, moduleName }));

  console.log(
    styleText('green', `  \u2713 fate client generated at '${path.relative(root, outputPath)}'.`),
  );
};

await generate();
