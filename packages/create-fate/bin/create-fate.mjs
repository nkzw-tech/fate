#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { cancel, intro, isCancel, outro, select, text } from '@clack/prompts';

const variants = {
  drizzle: {
    description: 'tRPC with Drizzle',
    label: 'Drizzle',
    template: 'drizzle',
  },
  graphql: {
    description: 'GraphQL with Prisma',
    label: 'GraphQL',
    template: 'graphql',
  },
  'graphql-client': {
    description: 'Existing GraphQL server',
    label: 'GraphQL Client',
    template: 'graphql-client',
  },
  http: {
    description: 'Native HTTP with Drizzle',
    label: 'Native HTTP',
    template: 'http',
  },
  prisma: {
    description: 'tRPC with Prisma',
    label: 'Prisma',
    template: 'prisma',
  },
  void: {
    description: 'Void with void-fate and Drizzle',
    label: 'Void',
    template: 'void',
  },
};

const fateDependencyNames = ['@nkzw/fate', 'react-fate', 'void-fate'];

const usage = () => {
  process.stdout
    .write(`Usage: create-fate [directory] [--template void|drizzle|graphql|graphql-client|http|prisma]

Create a new fate app.

Options:
  --template, -t  Template variant to create
  --no-setup      Skip dependency installation and fate client generation
  --help, -h      Show this help message
`);
};

const normalizePackageName = (name) =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'my-app';

const parseArgs = (args) => {
  let setup = true;
  let targetDir;
  let variant;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }

    if (arg === '--no-setup') {
      setup = false;
      continue;
    }

    if (arg === '--template' || arg === '-t' || arg === '--variant') {
      variant = args[++index];
      continue;
    }

    if (arg?.startsWith('--template=')) {
      variant = arg.slice('--template='.length);
      continue;
    }

    if (arg?.startsWith('--variant=')) {
      variant = arg.slice('--variant='.length);
      continue;
    }

    if (!targetDir) {
      targetDir = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return { setup, targetDir, variant };
};

const validateTargetDir = (value) => {
  const targetDir = value?.trim();
  if (!targetDir) {
    throw new Error('Target directory is required.');
  }

  const normalized = path.normalize(targetDir);
  if (
    !path.isAbsolute(normalized) &&
    (normalized === '.' || normalized.startsWith('..') || normalized.includes(`${path.sep}..`))
  ) {
    throw new Error('Target directory cannot escape the current directory.');
  }

  return normalized;
};

const validateTargetDirInput = (value) => {
  try {
    validateTargetDir(value || 'my-app');
    return;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const abortPrompt = () => {
  cancel('Create fate app cancelled.');
  process.exit(0);
};

const promptForTargetDir = async () => {
  const result = await text({
    defaultValue: 'my-app',
    message: 'Project directory',
    placeholder: 'my-app',
    validate: validateTargetDirInput,
  });

  if (isCancel(result)) {
    abortPrompt();
  }

  return result;
};

const promptForVariant = async () => {
  const result = await select({
    message: 'Select a fate template',
    options: Object.entries(variants).map(([value, variant]) => ({
      hint: variant.description,
      label: variant.label,
      value,
    })),
  });

  if (isCancel(result)) {
    abortPrompt();
  }

  return result;
};

const getRegistryURL = () => {
  const registry = process.env.npm_config_registry || 'https://registry.npmjs.org/';
  return registry.endsWith('/') ? registry : `${registry}/`;
};

const fetchLatestPackageVersion = async (packageName) => {
  const response = await globalThis.fetch(
    new URL(encodeURIComponent(packageName), getRegistryURL()),
  );
  if (!response.ok) {
    throw new Error(`Could not fetch ${packageName} from npm registry.`);
  }

  const metadata = await response.json();
  const version = metadata?.['dist-tags']?.latest;
  if (typeof version !== 'string' || !version) {
    throw new Error(`Could not resolve latest version for ${packageName}.`);
  }

  return version;
};

const collectFateDependencies = (dir, dependencies = new Set()) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFateDependencies(entryPath, dependencies);
      continue;
    }

    if (entry.name !== 'package.json') {
      continue;
    }

    const json = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
    for (const dependencyType of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const packageDependencies = json[dependencyType];
      if (!packageDependencies) {
        continue;
      }

      for (const dependencyName of fateDependencyNames) {
        if (packageDependencies[dependencyName]) {
          dependencies.add(dependencyName);
        }
      }
    }
  }

  return dependencies;
};

const resolveFateDependencyVersions = async (rootDir) => {
  const dependencies = [...collectFateDependencies(rootDir)];
  return Object.fromEntries(
    await Promise.all(
      dependencies.map(async (dependencyName) => [
        dependencyName,
        `^${await fetchLatestPackageVersion(dependencyName)}`,
      ]),
    ),
  );
};

const updatePackageJsonFiles = (rootDir, dir, packageName, fateDependencyVersions) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      updatePackageJsonFiles(rootDir, entryPath, packageName, fateDependencyVersions);
      continue;
    }

    if (entry.name !== 'package.json') {
      continue;
    }

    const json = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
    if (entryPath === path.join(rootDir, 'package.json')) {
      json.name = packageName;
    }

    for (const dependencyType of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const dependencies = json[dependencyType];
      if (!dependencies) {
        continue;
      }

      for (const [dependencyName, version] of Object.entries(fateDependencyVersions)) {
        if (dependencies[dependencyName]) {
          dependencies[dependencyName] = version;
        }
      }
    }

    fs.writeFileSync(entryPath, `${JSON.stringify(json, null, 2)}\n`);
  }
};

const restoreTemplateFileNames = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      restoreTemplateFileNames(entryPath);
      continue;
    }

    if (entry.name === '_gitignore') {
      fs.renameSync(entryPath, path.join(dir, '.gitignore'));
    }
  }
};

const copyExampleEnvFiles = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      copyExampleEnvFiles(entryPath);
      continue;
    }

    if (!entry.name.endsWith('.env.example')) {
      continue;
    }

    const envPath = path.join(dir, entry.name.slice(0, -'.example'.length));
    if (!fs.existsSync(envPath)) {
      fs.copyFileSync(entryPath, envPath);
    }
  }
};

const runCommand = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(' ')}`);
  }
};

const setupProject = (targetPath, selectedVariant) => {
  runCommand('vp', ['install'], targetPath);

  switch (selectedVariant) {
    case 'graphql':
    case 'prisma':
      runCommand('vp', ['run', '--filter', '@app/server', 'dev:setup'], targetPath);
      runCommand('vp', ['run', 'fate:generate'], targetPath);
      break;
    case 'graphql-client':
      runCommand('vp', ['run', 'prepare:void'], targetPath);
      runCommand('vp', ['run', 'fate:generate'], targetPath);
      break;
    case 'void':
      runCommand('vp', ['run', 'prepare:void'], targetPath);
      runCommand('vp', ['run', 'fate:generate'], targetPath);
      break;
    default:
      runCommand('vp', ['run', 'fate:generate'], targetPath);
      break;
  }
};

const printReadme = (targetPath) => {
  const readmePath = path.join(targetPath, 'README.md');
  if (!fs.existsSync(readmePath)) {
    return;
  }

  process.stdout.write(`\nNext steps are in README.md. Follow these instructions:\n\n`);
  process.stdout.write(fs.readFileSync(readmePath, 'utf8'));
  process.stdout.write('\n');
};

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const resolveTemplateRoot = (template) => {
  const templateRoot = path.resolve(packageRoot, 'templates', 'fate', template);
  if (!fs.existsSync(templateRoot)) {
    throw new Error(`Template '${template}' could not be found.`);
  }

  return templateRoot;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (interactive) {
    intro('create-fate');
  }

  const selectedVariant = options.variant ?? (interactive ? await promptForVariant() : 'void');
  if (!selectedVariant || !variants[selectedVariant]) {
    throw new Error(
      `Unknown template '${selectedVariant}'. Expected one of: ${Object.keys(variants).join(', ')}.`,
    );
  }

  const targetDir = validateTargetDir(
    options.targetDir ?? (interactive ? await promptForTargetDir() : 'my-app'),
  );
  const targetPath = path.resolve(process.cwd(), targetDir);
  if (fs.existsSync(targetPath) && fs.readdirSync(targetPath).length > 0) {
    throw new Error(`Target directory '${targetDir}' is not empty.`);
  }

  const templateRoot = resolveTemplateRoot(variants[selectedVariant].template);
  const fateDependencyVersions = await resolveFateDependencyVersions(templateRoot);
  fs.mkdirSync(targetPath, { recursive: true });
  fs.cpSync(templateRoot, targetPath, { recursive: true });
  restoreTemplateFileNames(targetPath);
  copyExampleEnvFiles(targetPath);
  updatePackageJsonFiles(
    targetPath,
    targetPath,
    normalizePackageName(path.basename(targetDir)),
    fateDependencyVersions,
  );

  if (options.setup) {
    setupProject(targetPath, selectedVariant);
  }

  const message = `Created ${variants[selectedVariant].label} fate app in ${targetDir}`;
  if (interactive) {
    outro(message);
  } else {
    process.stdout.write(`${message}\n`);
  }

  printReadme(targetPath);
};

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
