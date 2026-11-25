import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './app.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  const PORT = Number(process.env.CLAUDE_PANEL_PORT || 8787)
  const staticDir = process.env.CLAUDE_PANEL_STATIC
    ? path.resolve(process.env.CLAUDE_PANEL_STATIC)
    : null

  const { port, host } = await startServer({ port: PORT, staticDir })
  console.log(`Claude Panel API http://${host}:${port}`)
}
