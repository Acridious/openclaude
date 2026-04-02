import process from 'node:process'

const model = process.env.OPENAI_MODEL || 'qwen2.5-coder:7b'
const baseUrl = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1'

async function checkOllamaHealth() {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags')
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const healthy = await checkOllamaHealth()
  if (!healthy) {
    console.error('Ollama is not reachable at http://127.0.0.1:11434.')
    console.error('Start it first: ollama serve')
    process.exit(1)
  }

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = baseUrl
  process.env.OPENAI_MODEL = model
  delete process.env.ANTHROPIC_API_KEY

  console.log('Starting OpenClaude Web UI in local Ollama mode...')
  console.log(`OPENAI_BASE_URL=${process.env.OPENAI_BASE_URL}`)
  console.log(`OPENAI_MODEL=${process.env.OPENAI_MODEL}`)
  console.log('Open: http://localhost:8787')
  if (dryRun) return

  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, ['scripts/web-ui-server.mjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  child.on('exit', code => process.exit(code ?? 0))
}

await main()
