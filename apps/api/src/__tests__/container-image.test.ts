import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const apiDir = new URL('../../', import.meta.url)

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, apiDir), 'utf8')
}

const dockerfile = read('Dockerfile')
const stages = dockerfile.split(/^FROM /m).slice(1)
const runtimeStage = stages[stages.length - 1]

describe('API container image', () => {
  it('builds in one stage and ships a separate runtime stage', () => {
    expect(stages).toHaveLength(2)
    expect(stages[0]).toMatch(/^node:22-slim AS builder/)
  })

  it('runs the compiled output with plain node as a non-root user', () => {
    expect(runtimeStage).toMatch(/^USER node$/m)
    expect(runtimeStage).toMatch(/^CMD \["node", "dist\/index\.js"\]$/m)
    expect(dockerfile).not.toMatch(/\btsx\b/)
  })

  it('installs production dependencies only and never copies the builder node_modules', () => {
    expect(runtimeStage).toContain('npm ci --omit=dev --workspace=@stealthmark/api')
    expect(runtimeStage).not.toMatch(/COPY --from=builder \/app\/node_modules/)
    expect(runtimeStage).not.toMatch(/COPY --from=builder \/app\/apps\/api\s/)
  })

  it('compiles the TypeScript workspace packages the API imports at runtime', () => {
    expect(stages[0]).toContain('for pkg in db shared')
    expect(stages[0]).toContain('npm pkg set main=./dist/index.js')
    expect(runtimeStage).toContain('COPY --from=builder /app/packages/db/dist packages/db/dist')
    expect(runtimeStage).toContain('COPY --from=builder /app/packages/shared/dist packages/shared/dist')
  })

  it('keeps the /health probe on the port the service listens on', () => {
    expect(runtimeStage).toContain('ENV PORT=8080')
    expect(runtimeStage).toMatch(/HEALTHCHECK .*\n\s+CMD node -e .*\/health/)
  })

  it('does not copy the whole repository into the build stage', () => {
    expect(stages[0]).not.toMatch(/^COPY \. \.$/m)
  })
})

describe('API package manifest', () => {
  const manifest: {
    scripts: Record<string, string>
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  } = JSON.parse(read('package.json'))

  it('starts from the compiled output and keeps tsx for development only', () => {
    expect(manifest.scripts.start).toBe('node dist/index.js')
    expect(manifest.dependencies).not.toHaveProperty('tsx')
    expect(manifest.devDependencies).toHaveProperty('tsx')
    expect(manifest.scripts.dev).toContain('tsx')
  })

  it('builds from a tsconfig that leaves the test files out of dist', () => {
    const build: { exclude: string[] } = JSON.parse(read('tsconfig.build.json'))

    expect(manifest.scripts.build).toBe('tsc -p tsconfig.build.json')
    expect(build.exclude).toEqual(expect.arrayContaining(['src/**/__tests__/**', 'src/**/*.test.ts']))
    expect(manifest.scripts.typecheck).toBe('tsc --noEmit')
  })
})
