#!/usr/bin/env bash
set -euo pipefail

template="${1:-void}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
work_root="${tmp_root%/}/fate-template-tests"
target_dir="${work_root}/${template}"
package_dir="${work_root}/${template}-packages"
templates_root="${repo_root}/packages/create-fate/templates/fate"

if [[ ! -d "${templates_root}/${template}" ]]; then
  echo "Unknown fate template: ${template}" >&2
  exit 1
fi

cd "${repo_root}"
vp run --filter '@nkzw/fate' build
vp run --filter react-fate build
if [[ "${template}" == "void" ]]; then
  vp run --filter void-fate build
fi

rm -rf "${target_dir}"
mkdir -p "${work_root}"
node "${repo_root}/packages/create-fate/bin/create-fate.mjs" "${target_dir}" --template "${template}" --no-setup

# Install release artifacts so the template resolves its own peer dependencies.
mkdir -p "${package_dir}"
vp pm pack --filter '@nkzw/fate' --out "${package_dir}/fate.tgz"
vp pm pack --filter react-fate --out "${package_dir}/react-fate.tgz"
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
FATE_PACKAGE="file:${package_dir}/fate.tgz" \
REACT_FATE_PACKAGE="file:${package_dir}/react-fate.tgz" \
VOID_FATE_PACKAGE="file:${package_dir}/void-fate.tgz" \
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';

const path = `${process.env.TEMPLATE_DIR}/pnpm-workspace.yaml`;
const overrides = [
  `  '@nkzw/fate': ${JSON.stringify(process.env.FATE_PACKAGE)}`,
  `  react-fate: ${JSON.stringify(process.env.REACT_FATE_PACKAGE)}`,
  ...(process.env.TEMPLATE_DIR?.endsWith('/void')
    ? [`  void-fate: ${JSON.stringify(process.env.VOID_FATE_PACKAGE)}`]
    : []),
].join('\n');

const content = readFileSync(path, 'utf8');

if (!content.includes('overrides:\n')) {
  throw new Error('Expected pnpm-workspace.yaml to contain an overrides block.');
}

writeFileSync(path, content.replace('overrides:\n', `overrides:\n${overrides}\n`));
EOF

cd "${target_dir}"
vp install --no-frozen-lockfile
if [[ "${template}" == "drizzle" ]]; then
  vp run --filter '@app/client' dev:setup
else
  vp run dev:setup
fi
vp run fate:generate
vp check --fix
vp check
vp test
vp run build
