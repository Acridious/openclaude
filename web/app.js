const form = document.getElementById('chat-form')
const input = document.getElementById('prompt')
const messages = document.getElementById('messages')
const endpointEl = document.getElementById('endpoint')
const modelEl = document.getElementById('model')
const modeEl = document.getElementById('mode')
const statusDot = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')

let inFlight = false

function addMessage(role, content) {
  const row = document.createElement('div')
  row.className = `message ${role}`

  const label = document.createElement('div')
  label.className = 'message-role'
  label.textContent = role === 'user' ? 'You' : 'Assistant'

  const body = document.createElement('div')
  body.className = 'message-body'
  body.textContent = content

  row.appendChild(label)
  row.appendChild(body)
  messages.appendChild(row)
  messages.scrollTop = messages.scrollHeight
}

function setBusy(busy) {
  inFlight = busy
  form.querySelector('button').disabled = busy
  input.disabled = busy
}

async function loadHealth() {
  try {
    const res = await fetch('/api/health')
    const data = await res.json()
    endpointEl.textContent = data.baseUrl
    modelEl.textContent = data.model
    modeEl.textContent = data.mode
    statusText.textContent = 'Connected'
    statusDot.style.background = '#22c55e'
  } catch {
    statusText.textContent = 'Disconnected'
    statusDot.style.background = '#ef4444'
  }
}

form.addEventListener('submit', async e => {
  e.preventDefault()
  if (inFlight) return

  const text = input.value.trim()
  if (!text) return

  addMessage('user', text)
  input.value = ''
  setBusy(true)

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })

    const data = await res.json()
    if (!res.ok) {
      addMessage('assistant', `Error: ${data.error || 'request failed'}`)
    } else {
      addMessage('assistant', data.reply || '(empty reply)')
    }
  } catch (err) {
    addMessage('assistant', `Network error: ${String(err)}`)
  } finally {
    setBusy(false)
    input.focus()
  }
})

loadHealth()
