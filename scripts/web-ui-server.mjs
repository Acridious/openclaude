import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const PORT = Number(process.env.WEB_UI_PORT || 8787)
const HOST = process.env.WEB_UI_HOST || '127.0.0.1'
const WEB_ROOT = path.resolve(process.cwd(), 'web')

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function detectProvider() {
  const useOpenAI =
    process.env.CLAUDE_CODE_USE_OPENAI === '1' ||
    process.env.CLAUDE_CODE_USE_OPENAI === 'true' ||
    Boolean(process.env.OPENAI_BASE_URL)

  if (useOpenAI) {
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const model = process.env.OPENAI_MODEL || 'gpt-4o'
    const local = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(baseUrl)
    return {
      backend: 'openai-compatible',
      model,
      baseUrl,
      localInference: local,
    }
  }

  return {
    backend: 'anthropic',
    model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    baseUrl: 'https://api.anthropic.com/v1',
    localInference: false,
  }
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function callOpenAICompatible({ messages, systemPrompt }) {
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = process.env.OPENAI_MODEL || 'gpt-4o'
  const apiKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || ''
  const url = `${baseUrl}/chat/completions`

  const payload = {
    model,
    temperature: 0.7,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: String(systemPrompt) }] : []),
      ...messages.map(m => ({ role: m.role, content: String(m.content || '') })),
    ],
  }

  const headers = {
    'Content-Type': 'application/json',
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = data?.error?.message || JSON.stringify(data) || `${response.status} ${response.statusText}`
    throw new Error(`Provider error: ${detail}`)
  }

  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part?.text || ''))
      .join('\n')
      .trim()
  }
  return 'No response content from provider.'
}

async function callAnthropic({ messages, systemPrompt }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for Anthropic mode.')
  }

  const model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
  const payload = {
    model,
    max_tokens: 1024,
    system: systemPrompt || undefined,
    messages: messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role,
        content: String(m.content || ''),
      })),
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = data?.error?.message || JSON.stringify(data) || `${response.status} ${response.statusText}`
    throw new Error(`Anthropic error: ${detail}`)
  }

  const text = (data?.content || [])
    .map(block => (block?.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()

  return text || 'No response content from Anthropic.'
}

async function callModel({ messages, systemPrompt }) {
  const provider = detectProvider()
  if (provider.backend === 'openai-compatible') {
    return callOpenAICompatible({ messages, systemPrompt })
  }
  return callAnthropic({ messages, systemPrompt })
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

async function serveStatic(req, res) {
  const reqPath = req.url === '/' ? '/index.html' : req.url
  const normalized = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '')
  const filePath = path.join(WEB_ROOT, normalized)
  const inWebRoot = filePath.startsWith(WEB_ROOT)
  if (!inWebRoot) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  try {
    const file = await readFile(filePath)
    res.statusCode = 200
    res.setHeader('Content-Type', contentType(filePath))
    res.end(file)
  } catch {
    res.statusCode = 404
    res.end('Not Found')
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      const provider = detectProvider()
      json(res, 200, {
        ok: true,
        provider,
      })
      return
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = await parseBody(req)
      const messages = Array.isArray(body?.messages) ? body.messages : []
      const systemPrompt =
        typeof body?.systemPrompt === 'string' ? body.systemPrompt : ''

      if (messages.length === 0) {
        json(res, 400, { ok: false, error: 'messages[] is required' })
        return
      }

      const cleanMessages = messages
        .map(msg => ({
          role: msg?.role,
          content: msg?.content,
        }))
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .slice(-20)

      const assistantReply = await callModel({
        messages: cleanMessages,
        systemPrompt,
      })

      json(res, 200, {
        ok: true,
        message: {
          role: 'assistant',
          content: assistantReply,
        },
      })
      return
    }

    await serveStatic(req, res)
  } catch (error) {
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unexpected server error',
    })
  }
})

server.listen(PORT, HOST, () => {
  const provider = detectProvider()
  // biome-ignore lint/suspicious/noConsole: startup info for local users
  console.log(`OpenClaude Web UI running at http://${HOST}:${PORT}`)
  // biome-ignore lint/suspicious/noConsole: startup info for local users
  console.log(`Backend: ${provider.backend} (${provider.model})`)
})
