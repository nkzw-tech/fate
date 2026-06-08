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

const frontendFrameworks = {
  react: {
    description: 'React with react-fate',
    label: 'React',
  },
  vue: {
    description: 'Vue with vue-fate',
    label: 'Vue',
  },
};

const fateDependencyNames = ['@nkzw/fate', 'react-fate', 'void-fate', 'vue-fate'];

const usage = () => {
  process.stdout
    .write(`Usage: create-fate [directory] [--template void|drizzle|graphql|graphql-client|http|prisma] [--framework react|vue]

Create a new fate app.

Options:
  --framework, -f UI framework to create (react or vue)
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
  let framework;
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

    if (arg === '--framework' || arg === '-f' || arg === '--ui') {
      framework = args[++index];
      continue;
    }

    if (arg?.startsWith('--framework=')) {
      framework = arg.slice('--framework='.length);
      continue;
    }

    if (arg?.startsWith('--ui=')) {
      framework = arg.slice('--ui='.length);
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

  return { framework, setup, targetDir, variant };
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

const promptForFramework = async () => {
  const result = await select({
    initialValue: 'react',
    message: 'Select a UI framework',
    options: Object.entries(frontendFrameworks).map(([value, framework]) => ({
      hint: framework.description,
      label: framework.label,
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
      dependencies.map(async (dependencyName) => {
        try {
          return [dependencyName, `^${await fetchLatestPackageVersion(dependencyName)}`];
        } catch (error) {
          if (dependencyName === 'vue-fate') {
            return [dependencyName, 'latest'];
          }

          throw error;
        }
      }),
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

const readPackageJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const writePackageJson = (filePath, json) => {
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
};

const removePackageEntries = (record, names) => {
  if (!record) {
    return;
  }

  for (const name of names) {
    delete record[name];
  }
};

const reactPackageEntries = [
  '@nkzw/babel-preset-fbtee',
  '@radix-ui/react-slot',
  '@nkzw/stack',
  '@rolldown/plugin-babel',
  '@types/react',
  '@types/react-dom',
  '@vitejs/plugin-react',
  '@void/react',
  'babel-plugin-react-compiler',
  'eslint-plugin-react-hooks',
  'fbtee',
  'lucide-react',
  'react',
  'react-dom',
  'react-error-boundary',
  'react-fate',
];

const vueAgentsGuide = `# Using _fate_ for Vue applications

This guidance is for agents working in projects bootstrapped from the fate Vue template. It focuses on Vue-native composables for fate's view composition and request execution.

## Core Workflow

- **Define views with explicit selections:** Define reusable view objects with \`view<T>()({...})\`, compose them via spreads, and resolve them with \`useView\`.
- **Resolve data via references:** Avoid passing raw fetched objects; instead pass \`ViewRef\` values to downstream components to keep selections scoped and cache-aware. Then call \`const result = useView(viewDefinition, ref)\` in the component that reads the data.
- **Request data at route roots:** Use \`useRequest\` to compose all views required for a route into a single typed request; use Vue \`<Suspense>\` and an error boundary around route content.
- **Compose reusable views:** Extract nested selections into their own views, such as \`UserView\`, and compose them inside parent views, such as \`author: UserView\`, to avoid duplication and overfetching.

## Mutations

- **Use generated mutations deliberately:** Trigger mutations through the generated fate client APIs and pass optimistic payloads when the UI should update immediately.
- **Select extra fields when side effects matter:** When a mutation affects related entities, pass a \`view\` to fetch the needed fields in the same round-trip and keep the cache coherent for all dependent views.
- **Handle loading and errors explicitly:** Vue components should expose pending and error states through refs/resources rather than React Action patterns.
- **Handle deletions and resets explicitly:** Use the \`delete: true\` flag to evict records from the cache, and send the \`'reset'\` token to clear stale mutation errors without re-running the mutation.

## Common Pitfalls

- **Use ViewRefs:** Pass references instead of raw data. Keep components focused on views and \`ViewRef\` values to let fate manage data masking and updates.
- **Co-locate data needs:** Keep view definitions near their components and compose them upward to the request root for predictable fetching.
- **Use Vue Suspense:** Wrap pages in \`<Suspense>\` and an error boundary instead of ad-hoc loading/error branches where route-level data is required.
- **Do not duplicate types:** Keep generated fate types and views imported from the server package. Avoid redefining entity shapes on the client.
- **\`useRequest\` only at route roots:** Create a dedicated \`useRequest\` call per screen root that pulls together all child views; do not scatter \`useRequest\` across leaf components unless it is necessary to issue a separate request.
- **fate client support:** fate's local client support files are maintained by the Vite/fate tooling. Do not manually edit \`.fate\` files; make the proper schema changes on the server and run \`pnpm fate:generate\` when working outside Vite dev.

Full documentation can be found on the filesystem at \`./client/node_modules/vue-fate/README.md\` or online at [fate.technology](https://fate.technology/).

## Review Checklist for Agents

- [ ] Every component that reads server data does so through \`useView\` and receives a \`ViewRef\` prop.
- [ ] Route components gather data with a single \`useRequest\` call.
- [ ] Mutations use generated fate client APIs with optimistic updates and necessary \`view\` selections.
- [ ] Shared selections live in reusable views using regular JavaScript object spreads rather than duplicated field lists.`;

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

const replaceInFiles = (dir, replacements) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      replaceInFiles(entryPath, replacements);
      continue;
    }

    let source = fs.readFileSync(entryPath, 'utf8');
    for (const [token, value] of Object.entries(replacements)) {
      source = source.replaceAll(token, value);
    }
    fs.writeFileSync(entryPath, source);
  }
};

const vueTransportConfigs = {
  drizzle: {
    clientImports: `import { httpBatchLink } from '@trpc/client';
import env from '../src/lib/env.ts';`,
    createOptions: `{
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      credentials: 'include',
    }),
  links: [
    httpBatchLink({
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          credentials: 'include',
        }),
      url: \`\${env('SERVER_URL')}/trpc\`,
    }),
  ],
  liveUrl: \`\${env('SERVER_URL')}/fate\`,
}`,
    dotenvConfig: `dotenv.config({
  path: join(root, '../server', process.env.NODE_ENV === 'development' || process.env.DEV ? '.env' : '.prod.env'),
  quiet: true,
})`,
    envKeys: `['SERVER_URL']`,
    envValues: `{
  SERVER_URL: import.meta.env.VITE_SERVER_URL,
}`,
    fateModule: '@app/server/src/router.ts',
    fateTransport: `transport: 'trpc',`,
    typeModule: '@app/server/src/router.ts',
  },
  graphql: {
    clientImports: `import env from '../src/lib/env.ts';`,
    createOptions: `{
  live: { url: \`\${env('SERVER_URL')}/graphql/stream\` },
  url: \`\${env('SERVER_URL')}/graphql\`,
}`,
    dotenvConfig: `dotenv.config({
  path: join(root, '../server', process.env.NODE_ENV === 'development' || process.env.DEV ? '.env' : '.prod.env'),
  quiet: true,
})`,
    envKeys: `['SERVER_URL']`,
    envValues: `{
  SERVER_URL: import.meta.env.VITE_SERVER_URL,
}`,
    fateModule: '@app/server/src/graphql/fate.ts',
    fateTransport: `transport: 'graphql',`,
    typeModule: '@app/server/src/graphql/fate.ts',
  },
  'graphql-client': {
    clientImports: ``,
    createOptions: `{
  live: import.meta.env.VITE_GRAPHQL_LIVE_URL
    ? { url: import.meta.env.VITE_GRAPHQL_LIVE_URL }
    : false,
  url: import.meta.env.VITE_GRAPHQL_URL,
}`,
    dotenvConfig: `dotenv.config({ path: join(root, '.env'), quiet: true })`,
    envKeys: `[]`,
    envValues: `{}`,
    fateModule: './src/fate/graphql.ts',
    fateTransport: `transport: 'graphql',`,
    typeModule: './fate/graphql.ts',
  },
  http: {
    clientImports: `import env from '../src/lib/env.ts';`,
    createOptions: `{
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      credentials: 'include',
    }),
  liveUrl: \`\${env('SERVER_URL')}/fate\`,
  url: \`\${env('SERVER_URL')}/fate\`,
}`,
    dotenvConfig: `dotenv.config({
  path: join(root, '../server', process.env.NODE_ENV === 'development' || process.env.DEV ? '.env' : '.prod.env'),
  quiet: true,
})`,
    envKeys: `['SERVER_URL']`,
    envValues: `{
  SERVER_URL: import.meta.env.VITE_SERVER_URL,
}`,
    fateModule: '@app/server/src/router.ts',
    fateTransport: `transport: 'native',`,
    typeModule: '@app/server/src/router.ts',
  },
  prisma: null,
  void: {
    clientImports: `import { useShared } from '@void/vue';
import type { SharedData } from '../src/lib/shared.ts';

const shared = useShared<SharedData>();`,
    createOptions: `{
  origin: shared.origin,
  userId: shared.auth.user?.id,
}`,
    dotenvConfig: `dotenv.config({ path: join(root, '.env'), quiet: true })`,
    envKeys: `[]`,
    envValues: `{}`,
    fateModule: './src/fate/server.ts',
    fateTransport: `transport: 'void',`,
    typeModule: './fate/server.ts',
  },
};
vueTransportConfigs.prisma = vueTransportConfigs.drizzle;

const vueTemplatePackage = () =>
  path.resolve(packageRoot, 'templates', 'fate', '_shared', 'vue-app');

const frontendRootForVariant = (targetPath, selectedVariant) =>
  selectedVariant === 'void' || selectedVariant === 'graphql-client'
    ? targetPath
    : path.join(targetPath, 'client');

const removeIfExists = (entryPath) => {
  if (fs.existsSync(entryPath)) {
    fs.rmSync(entryPath, { force: true, recursive: true });
  }
};

const removeReactFrontend = (frontendRoot, selectedVariant) => {
  if (selectedVariant === 'void' || selectedVariant === 'graphql-client') {
    for (const entry of ['pages', 'src/ui']) {
      removeIfExists(path.join(frontendRoot, entry));
    }
    removeIfExists(path.join(frontendRoot, 'src', 'App.css'));
    removeIfExists(path.join(frontendRoot, 'src', 'lib', 'cx.tsx'));
    removeIfExists(path.join(frontendRoot, 'src', 'user', 'AuthClient.tsx'));
    return;
  }

  removeIfExists(frontendRoot);
};

const configureVuePackageJson = (frontendRoot, selectedVariant, originalPackageJson) => {
  const packagePath = path.join(frontendRoot, 'package.json');
  const vuePackageJson = readPackageJson(packagePath);
  const packageJson = originalPackageJson
    ? {
        ...originalPackageJson,
        dependencies: {
          ...originalPackageJson.dependencies,
          ...vuePackageJson.dependencies,
        },
        devDependencies: {
          ...originalPackageJson.devDependencies,
          ...vuePackageJson.devDependencies,
        },
      }
    : vuePackageJson;

  removePackageEntries(packageJson.dependencies, reactPackageEntries);
  removePackageEntries(packageJson.devDependencies, reactPackageEntries);

  if (selectedVariant !== 'drizzle' && selectedVariant !== 'prisma') {
    delete packageJson.dependencies?.['@trpc/client'];
  }

  if (selectedVariant !== 'graphql' && selectedVariant !== 'graphql-client') {
    delete packageJson.dependencies?.['graphql-sse'];
  }

  if (selectedVariant !== 'graphql-client' && selectedVariant !== 'void') {
    packageJson.dependencies = {
      '@app/server': 'workspace:*',
      ...packageJson.dependencies,
    };
  }

  if (packageJson.description) {
    packageJson.description = packageJson.description.replaceAll('React', 'Vue');
  }

  writePackageJson(packagePath, packageJson);
};

const configureVueRootPackageJson = (targetPath) => {
  const packagePath = path.join(targetPath, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return;
  }

  const packageJson = readPackageJson(packagePath);
  removePackageEntries(packageJson.dependencies, reactPackageEntries);
  removePackageEntries(packageJson.devDependencies, reactPackageEntries);
  removePackageEntries(packageJson.peerDependencies, reactPackageEntries);

  if (packageJson.description) {
    packageJson.description = packageJson.description.replaceAll('React', 'Vue');
  }

  writePackageJson(packagePath, packageJson);
};

const configureVueVoidServerFiles = (frontendRoot) => {
  const oldSessionUser = path.join(frontendRoot, 'src', 'user', 'SessionUser.tsx');
  const nextSessionUser = path.join(frontendRoot, 'src', 'user', 'SessionUser.ts');
  if (fs.existsSync(oldSessionUser)) {
    fs.renameSync(oldSessionUser, nextSessionUser);
  }

  const contextPath = path.join(frontendRoot, 'src', 'fate', 'context.ts');
  fs.writeFileSync(
    contextPath,
    fs
      .readFileSync(contextPath, 'utf8')
      .replace('../user/SessionUser.tsx', '../user/SessionUser.ts'),
  );
};

const configureVueAgents = (targetPath) => {
  const agentsPath = path.join(targetPath, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, `${vueAgentsGuide}\n`);
    return;
  }

  const agents = fs.readFileSync(agentsPath, 'utf8');
  const vitePlusIndex = agents.indexOf('<!--VITE PLUS START-->');
  const suffix = vitePlusIndex === -1 ? agents : agents.slice(vitePlusIndex);
  fs.writeFileSync(agentsPath, `${vueAgentsGuide}\n\n${suffix.trim()}\n`);
};

const configureVueReadme = (targetPath, selectedVariant) => {
  const readmePath = path.join(targetPath, 'README.md');
  if (!fs.existsSync(readmePath)) {
    return;
  }

  const readme = fs.readFileSync(readmePath, 'utf8');
  fs.writeFileSync(
    readmePath,
    readme
      .replaceAll(
        `vp create fate my-app --template ${selectedVariant}`,
        `vp create fate my-app --template ${selectedVariant} --framework vue`,
      )
      .replaceAll('modern data client for React', 'modern data client for Vue')
      .replaceAll(
        'data masking, Async React features, and',
        'data masking, Vue-native composables, and',
      )
      .replaceAll('React applications', 'Vue applications')
      .replaceAll(
        '- [React](https://reactjs.org/) with [React Compiler](https://react.dev/learn/react-compiler) enabled',
        '- [Vue](https://vuejs.org/)',
      )
      .replaceAll('The React client application', 'The Vue client application')
      .replaceAll('React components', 'Vue components')
      .replaceAll('React client', 'Vue client')
      .replaceAll('`react-fate`', '`vue-fate`')
      .replaceAll('`@void/react`', '`@void/vue`')
      .replaceAll(', and React Compiler', '')
      .replaceAll(' and React Compiler', '')
      .replaceAll(
        'This template uses the Void pages router with Drizzle, `void-fate`, `vue-fate`, Better Auth, Tailwind.',
        'This template uses Vue, the Void pages router with Drizzle, `void-fate`, `vue-fate`, Better Auth, and Tailwind.',
      ),
  );
};

const configureVueVoidDemoContent = (targetPath) => {
  replaceInFiles(targetPath, {
    'Actions in fate are exposed for useActionState, and mutations can carry an optimistic object alongside the input. The cache applies the optimistic update immediately, re-renders affected views, and rolls the affected records back if the server rejects the mutation. This example uses the like button because it is easy to see, but the same model works for comments and other records.':
      'Mutations in fate can carry an optimistic object alongside the input. The cache applies the optimistic update immediately, re-renders affected views, and rolls the affected records back if the server rejects the mutation. This example uses the like button because it is easy to see, but the same model works for comments and other records.',
    'async-react': 'vue-runtime',
    'Async React, Suspense, Actions, and the react-fate hooks.':
      'Vue composables, Suspense, resources, and the vue-fate APIs.',
    'normal React': 'the host framework',
    'react-fate': 'vue-fate',
    'React Integration': 'Vue Integration',
    'Suspense, Actions, use, and concurrent rendering patterns.':
      'Vue Suspense, composables, resources, and reactive rendering patterns.',
    'The cache lifetime post is a good reminder to retain manual requests outside React.':
      'The cache lifetime post is a good reminder to retain manual requests outside component setup.',
    'The React integration leans on Suspense instead of local loading flags.':
      'The Vue integration uses Suspense and composables instead of local loading flags.',
    'The React integration posts make it clear that fate is not trying to replace React state.':
      'The Vue integration posts make it clear that fate is not trying to replace Vue state.',
    'The server adapters now cover Prisma and Drizzle with the same data view concepts. Sources describe how to resolve records, fields, lists, counts, and computed values, while fate builds the selected shape for the client. This makes the examples useful for teams with different database layers without changing the React component model.':
      'The server adapters now cover Prisma and Drizzle with the same data view concepts. Sources describe how to resolve records, fields, lists, counts, and computed values, while fate builds the selected shape for the client. This makes the examples useful for teams with different database layers without changing the component data model.',
    'The useActionState integration is practical because the form code still looks like React instead of a custom mutation framework.':
      'The Vue composable integration is practical because the component code still looks like Vue instead of a custom mutation framework.',
    'The Void example is a nice proof that the transport and React APIs are portable.':
      'The Void example is a nice proof that the transport and framework adapters are portable.',
    'The Void example uses the same fate ideas in a full-stack app with file-system routing, shared data, auth, mutations, live comments, categories, tags, and events. It exists to prove the core protocol and React APIs are not tied to one server framework. The seed data includes this post so search and category views can show the newest example alongside the Prisma and Drizzle servers.':
      'The Void example uses the same fate ideas in a full-stack app with file-system routing, shared data, auth, mutations, live comments, categories, tags, and events. It exists to prove the core protocol and framework adapters are not tied to one server framework. The seed data includes this post so search and category views can show the newest example alongside the Prisma and Drizzle servers.',
  });
};

const configureVueTemplate = (targetPath, selectedVariant) => {
  const frontendRoot = frontendRootForVariant(targetPath, selectedVariant);
  const originalPackageJson =
    selectedVariant === 'void' || selectedVariant === 'graphql-client'
      ? readPackageJson(path.join(frontendRoot, 'package.json'))
      : null;

  removeReactFrontend(frontendRoot, selectedVariant);
  fs.mkdirSync(frontendRoot, { recursive: true });
  fs.cpSync(vueTemplatePackage(), frontendRoot, { recursive: true });

  if (selectedVariant === 'void') {
    configureVueVoidServerFiles(frontendRoot);
  }

  configureVuePackageJson(frontendRoot, selectedVariant, originalPackageJson);
  if (frontendRoot !== targetPath) {
    configureVueRootPackageJson(targetPath);
  }
  configureVueAgents(targetPath);
  if (selectedVariant === 'void') {
    configureVueVoidDemoContent(targetPath);
  }

  const config = vueTransportConfigs[selectedVariant];
  replaceInFiles(frontendRoot, {
    __CREATE_FATE_OPTIONS__: config.createOptions,
    __DOTENV_CONFIG__: config.dotenvConfig,
    __ENV_KEYS__: config.envKeys,
    __ENV_VALUES__: config.envValues,
    __FATE_MODULE__: config.fateModule,
    __FATE_TYPE_MODULE__: config.typeModule,
    __FMT_IGNORE_PATTERNS__:
      selectedVariant === 'void' || selectedVariant === 'graphql-client'
        ? "['.fate/', '.void/', 'dist/', 'node_modules/', 'pnpm-lock.yaml']"
        : "['.fate/', '.void/', 'dist/', 'node_modules/', '../dist/', 'pnpm-lock.yaml']",
    __LINT_IGNORE_PATTERNS__:
      selectedVariant === 'void' || selectedVariant === 'graphql-client'
        ? "['.fate', '.void', 'dist', 'node_modules', 'vite.config.ts.timestamp-*']"
        : "['.fate', '.void', 'dist', 'node_modules', '../dist', 'vite.config.ts.timestamp-*']",
    __TSCONFIG_EXTENDS__:
      selectedVariant === 'void' || selectedVariant === 'graphql-client'
        ? './.void/tsconfig.json'
        : '../tsconfig.json',
    '"__TSCONFIG_INCLUDE__"':
      selectedVariant === 'void'
        ? `[
    ".fate/**/*.ts",
    ".void/**/*.d.ts",
    "db/**/*.ts",
    "middleware/**/*.ts",
    "pages/**/*.ts",
    "pages/**/*.vue",
    "routes/**/*.ts",
    "src/**/*.ts",
    "src/**/*.vue"
  ]`
        : `[
    ".fate/**/*.ts",
    ".void/**/*.d.ts",
    "pages/**/*.ts",
    "pages/**/*.vue",
    "src/**/*.ts",
    "src/**/*.vue"
  ]`,
    '/* __BUILD_CONFIG__ */':
      selectedVariant === 'void' || selectedVariant === 'graphql-client'
        ? 'build: {},'
        : "build: { outDir: join(root, '../dist/client') },",
    '/* __CLIENT_IMPORTS__ */': config.clientImports,
    '/* __FATE_TRANSPORT__ */': config.fateTransport,
  });
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
  const selectedFramework =
    options.framework ?? (interactive ? await promptForFramework() : 'react');
  if (!selectedFramework || !frontendFrameworks[selectedFramework]) {
    throw new Error(
      `Unknown framework '${selectedFramework}'. Expected one of: ${Object.keys(frontendFrameworks).join(', ')}.`,
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
  fs.mkdirSync(targetPath, { recursive: true });
  fs.cpSync(templateRoot, targetPath, { recursive: true });
  if (selectedFramework === 'vue') {
    configureVueTemplate(targetPath, selectedVariant);
  }
  restoreTemplateFileNames(targetPath);
  if (selectedFramework === 'vue') {
    configureVueReadme(targetPath, selectedVariant);
  }
  copyExampleEnvFiles(targetPath);
  const fateDependencyVersions = await resolveFateDependencyVersions(targetPath);
  updatePackageJsonFiles(
    targetPath,
    targetPath,
    normalizePackageName(path.basename(targetDir)),
    fateDependencyVersions,
  );

  if (options.setup) {
    setupProject(targetPath, selectedVariant);
  }

  const message = `Created ${frontendFrameworks[selectedFramework].label} ${variants[selectedVariant].label} fate app in ${targetDir}`;
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
