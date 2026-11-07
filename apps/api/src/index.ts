import { buildApp } from './app.js'
import { config } from './config.js'

async function main() {
  const app = await buildApp()

  await app.listen({ port: config.PORT, host: config.HOST })

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`)
    await app.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('Failed to start StealthMark API:', err)
  process.exit(1)
})
