import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

const workflowFiles = readdirSync(join(root, '.github', 'workflows')).filter((name) => name.endsWith('.yml'))
const deployScripts = ['infrastructure/scripts/deploy-platform.sh', 'infrastructure/scripts/deploy-web.sh']

test('every workflow action is pinned to a full commit SHA', () => {
  for (const file of workflowFiles) {
    const lines = read(`.github/workflows/${file}`).split('\n')
    for (const line of lines) {
      const match = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)/)
      if (!match || match[1].startsWith('./')) continue
      assert.match(match[1], /@[0-9a-f]{40}$/, `${file}: ${match[1]} is not pinned to a commit SHA`)
    }
  }
})

test('no workflow or deploy script points at a GCP project other than stealthmark-prod', () => {
  const files = [...workflowFiles.map((file) => `.github/workflows/${file}`), ...deployScripts, '.github/dependabot.yml']
  for (const file of files) {
    for (const [, project] of read(file).matchAll(/(?:--project[= ]|GCP_PROJECT:-|docker\.pkg\.dev\/)([a-z][a-z0-9-]*)/g)) {
      assert.equal(project, 'stealthmark-prod', `${file} references GCP project ${project}`)
    }
  }
})

test('deploy scripts never set a sandbox auth flag', () => {
  for (const file of deployScripts) {
    assert.doesNotMatch(read(file), /AUTH_SANDBOX/, `${file} sets an auth sandbox flag`)
  }
})

test('deploy-platform.sh deploys only the API, keeps min-instances 1 and does not wipe env vars', () => {
  const script = read('infrastructure/scripts/deploy-platform.sh')
  assert.match(script, /--config infrastructure\/cloudbuild-api\.yaml/)
  assert.match(script, /--min-instances 1\b/)
  assert.match(script, /--max-instances 5\b/)
  assert.match(script, /--update-env-vars/)
  assert.doesNotMatch(script, /--set-env-vars/)
  assert.doesNotMatch(script, /gcloud run deploy stealthmark-web/)
  assert.doesNotMatch(script, /cloudbuild-web\.yaml/)
})

test('deploy-api.yml builds with --config, keeps live scaling and env vars, and fails loudly without credentials', () => {
  const workflow = read('.github/workflows/deploy-api.yml')
  assert.doesNotMatch(workflow, /--file\b/)
  assert.match(workflow, /--config infrastructure\/cloudbuild-api\.yaml/)
  assert.match(workflow, /--min-instances 1\b/)
  assert.match(workflow, /--max-instances 5\b/)
  assert.match(workflow, /--update-env-vars/)
  assert.doesNotMatch(workflow, /--set-env-vars/)
  assert.match(workflow, /needs:\s*test\b/)
  assert.match(workflow, /\n  test:\n/)
  assert.match(workflow, /WIF_PROVIDER[\s\S]*?exit 1/)
  assert.doesNotMatch(workflow, /configured=false/)
})

test('deploy-api.yml runs only by hand: the production API is on the VM, and a push to main must not recreate the Cloud Run service', () => {
  const workflow = read('.github/workflows/deploy-api.yml')
  const triggers = workflow.match(/^on:\n((?: {2}.*\n)+)/m)?.[1]
  assert.equal(triggers, '  workflow_dispatch:\n')
})

test('publish-npm.yml cannot run in this repository', () => {
  const workflow = read('.github/workflows/publish-npm.yml')
  assert.match(workflow, /if:\s*github\.repository == 'stealthmark-io\/stealthmark-sdk'/)
})

test('CI runs the gateway pytest suite and this guard', () => {
  const ci = read('.github/workflows/ci.yml')
  assert.match(ci, /python-version:\s*'3\.11'/)
  assert.match(ci, /requirements-dev\.txt/)
  assert.match(ci, /python -m pytest -q/)
  assert.match(ci, /node --test infrastructure\/scripts\/deploy-config\.test\.mjs/)
})

test('the gateway image never receives .env files or .claude/ state', () => {
  const ignored = read('infrastructure/gateway-lab/.dockerignore').split('\n').map((line) => line.trim())
  for (const pattern of ['.env*', '**/.env*', '.claude', '**/.claude', '.venv']) {
    assert.ok(ignored.includes(pattern), `infrastructure/gateway-lab/.dockerignore is missing ${pattern}`)
  }
})

test('dependabot watches npm, pip and github-actions', () => {
  const config = read('.github/dependabot.yml')
  assert.match(config, /package-ecosystem:\s*npm/)
  assert.match(config, /package-ecosystem:\s*pip/)
  assert.match(config, /directory:\s*\/infrastructure\/gateway-lab/)
  assert.match(config, /package-ecosystem:\s*github-actions/)
})

test('SECURITY.md makes no response-time, support-window or hall-of-fame promises', () => {
  const policy = read('SECURITY.md')
  assert.doesNotMatch(policy, /48 hours|7 business days|Hall of Fame|1\.x\.x|24-48 hours/i)
  assert.match(policy, /no guaranteed response time/i)
  assert.match(policy, /latest commit on `main`/i)
})

test('README.md claims nothing the product does not do', () => {
  const readme = read('README.md')
  const forbidden = [
    /326 Bytes/i,
    /99\.\d% Token/i,
    /sub-10\s?ms/i,
    /DEFCON Perimeter/i,
    /Global KYA Registry/i,
    /\$79\/mo/i,
    /Retained for 1 Year/i,
    /interactive scaffold wizard/i,
  ]
  for (const pattern of forbidden) assert.doesNotMatch(readme, pattern, `README.md still contains ${pattern}`)
  assert.match(readme, /published to npm with provenance/i)
  assert.doesNotMatch(readme, /lives publicly|public stealthmark-sdk repository|in the public repository|Yes, mirrored/i)
  assert.match(readme, /Starter \$9[^\n]*\(15k events\), Growth \$29[^\n]*\(60k events\) and Scale \$79[^\n]*\(250k events\)/)
})
