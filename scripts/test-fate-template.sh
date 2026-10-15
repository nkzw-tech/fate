#!/usr/bin/env bash
set -euo pipefail

template="${1:-void}"
framework="${2:-react}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_root="${repo_root}/.template-tests/apps"
target_dir="${work_root}/${template}-${framework}"
package_dir="${work_root}/${template}-${framework}-packages"
templates_root="${repo_root}/packages/create-fate/templates/fate"

if [[ ! -d "${templates_root}/${template}" ]]; then
  echo "Unknown fate template: ${template}" >&2
  exit 1
fi

if [[ "${framework}" != "react" && "${framework}" != "vue" ]]; then
  echo "Unknown UI framework: ${framework}" >&2
  exit 1
fi

cd "${repo_root}"
vp run --filter '@nkzw/fate' build
vp run --filter react-fate build
if [[ "${framework}" == "vue" ]]; then
  vp run --filter vue-fate build
fi
if [[ "${template}" == "void" ]]; then
  vp run --filter void-fate build
fi

rm -rf "${target_dir}"
mkdir -p "${work_root}"
node "${repo_root}/packages/create-fate/bin/create-fate.mjs" "${target_dir}" --template "${template}" --framework "${framework}" --no-setup

# Isolate generated-project checks from the repository ignore rules.
git init -q "${target_dir}"

# Install release artifacts so the template resolves its own peer dependencies.
mkdir -p "${package_dir}"
vp pm pack --filter '@nkzw/fate' --out "${package_dir}/fate.tgz"
vp pm pack --filter react-fate --out "${package_dir}/react-fate.tgz"
if [[ "${framework}" == "vue" ]]; then
  vp pm pack --filter vue-fate --out "${package_dir}/vue-fate.tgz"
fi
if [[ "${template}" == "void" ]]; then
  vp pm pack --filter void-fate --out "${package_dir}/void-fate.tgz"
fi

if [[ -d "${target_dir}/server" ]]; then
  test -f "${target_dir}/server/.env"
  cmp -s "${target_dir}/server/.env.example" "${target_dir}/server/.env"

  database_url="${DATABASE_URL:-postgresql://fate:echo@localhost:5432/fate}"
  better_auth_secret="${BETTER_AUTH_SECRET:-local-template-ci-secret-with-enough-entropy}"
  better_auth_url="${BETTER_AUTH_URL:-http://localhost:9000}"
  client_domain="${CLIENT_DOMAIN:-http://localhost:5173}"
  vite_server_url="${VITE_SERVER_URL:-http://localhost:9000}"

  cat >"${target_dir}/server/.env" <<EOF
DATABASE_URL="${database_url}"
BETTER_AUTH_SECRET="${better_auth_secret}"
BETTER_AUTH_URL="${better_auth_url}"
CLIENT_DOMAIN="${client_domain}"
VITE_SERVER_URL="${vite_server_url}"
EOF
fi

TEMPLATE_DIR="${target_dir}" \
TEMPLATE="${template}" \
FRAMEWORK="${framework}" \
FATE_PACKAGE="file:${package_dir}/fate.tgz" \
REACT_FATE_PACKAGE="file:${package_dir}/react-fate.tgz" \
VUE_FATE_PACKAGE="file:${package_dir}/vue-fate.tgz" \
VOID_FATE_PACKAGE="file:${package_dir}/void-fate.tgz" \
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';

const path = `${process.env.TEMPLATE_DIR}/pnpm-workspace.yaml`;
const overrides = [
  `  '@nkzw/fate': ${JSON.stringify(process.env.FATE_PACKAGE)}`,
  `  react-fate: ${JSON.stringify(process.env.REACT_FATE_PACKAGE)}`,
  ...(process.env.FRAMEWORK === 'vue'
    ? [`  vue-fate: ${JSON.stringify(process.env.VUE_FATE_PACKAGE)}`]
    : []),
  ...(process.env.TEMPLATE === 'void'
    ? [`  void-fate: ${JSON.stringify(process.env.VOID_FATE_PACKAGE)}`]
    : []),
].join('\n');

const content = readFileSync(path, 'utf8');

if (!content.includes('overrides:\n')) {
  throw new Error('Expected pnpm-workspace.yaml to contain an overrides block.');
}

writeFileSync(path, content.replace('overrides:\n', `overrides:\n${overrides}\n`));
EOF

if [[ "${template}" == "graphql-client" ]]; then
  cat >"${target_dir}/.env" <<EOF
VITE_GRAPHQL_URL="http://localhost:9000/graphql"
VITE_GRAPHQL_LIVE_URL=""
EOF
fi

cd "${target_dir}"
vp install --no-frozen-lockfile
vp run dev:setup
vp run fate:generate
if [[ "${template}" == "prisma" || "${template}" == "graphql" ]]; then
  vp run --filter '@app/server' prisma db push
  vp run --filter '@app/server' prisma db seed
fi
vp check --fix
vp test
vp run build
vp check

if [[ "${template}" != "graphql-client" ]]; then
  node "${repo_root}/scripts/test-fate-template-browser.mjs" "${target_dir}" "${framework}"
fi
