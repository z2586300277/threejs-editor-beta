import {
  AGENT_API_BASE, CFG_KEY, CHATS_KEY, DEFAULT_MODEL, LAYOUT_KEY,
  mergeStreamText, TOOL_STATUS,
} from './shared.js'
import {
  getEditorApi, getEditorSettings, listEditorActions, listObjects,
  openEditorPanel, runEditorAction,
} from './core.js'
import { executeSceneTool, getSceneSnapshot } from './tools.js'

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
const API = AGENT_API_BASE
let agentOnline = null

const loadJson = (key, legacy) => {
  try {
    let raw = localStorage.getItem(key)
    if (!raw && legacy) { raw = localStorage.getItem(legacy); if (raw) localStorage.setItem(key, raw) }
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export async function refreshAgentMode() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(`${API}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    const data = await res.json()
    agentOnline = res.ok && data?.ok && data?.hasApiKey
  } catch { agentOnline = false }
  return agentOnline ? 'backend' : 'offline'
}

export function formatChatLabel(chat) {
  const first = chat.messages.find(m => m.placement === 'end' && m.content?.trim())
  if (first) {
    const t = first.content.trim()
    return t.length > 24 ? `${t.slice(0, 24)}...` : t
  }
  const d = new Date(chat.updatedAt || Date.now())
  return `新对话 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const emptyChat = (id = String(Date.now())) => ({ id, msgId: 0, messages: [], updatedAt: Date.now() })

export function loadChats() {
  let store = loadJson(CHATS_KEY) || { activeId: '', chats: [] }
  if (!store.chats.length) {
    const legacy = loadJson('AI_chat')
    if (legacy?.messages?.length) {
      const id = String(Date.now())
      store.chats.unshift({ id, msgId: legacy.msgId || 0, messages: legacy.messages.filter(m => !m.loading), updatedAt: Date.now() })
      store.activeId = id
    }
  }
  if (!store.chats.length) {
    const chat = emptyChat()
    store = { activeId: chat.id, chats: [chat] }
  }
  if (!store.chats.some(c => c.id === store.activeId)) store.activeId = store.chats[0].id
  localStorage.setItem(CHATS_KEY, JSON.stringify(store))
  return store
}

export const getActiveChat = (store) => store.chats.find(c => c.id === store.activeId) || store.chats[0]

export function persistActiveChat(store, { msgId, messages }) {
  const chat = getActiveChat(store)
  chat.msgId = msgId
  chat.messages = messages.filter(m => !m.loading)
  chat.updatedAt = Date.now()
  localStorage.setItem(CHATS_KEY, JSON.stringify(store))
}

export function createNewChat(store) {
  if (!getActiveChat(store).messages.length) return getActiveChat(store)
  const chat = emptyChat()
  store.chats.unshift(chat)
  if (store.chats.length > 30) store.chats.length = 30
  store.activeId = chat.id
  localStorage.setItem(CHATS_KEY, JSON.stringify(store))
  return chat
}

export function switchChat(store, id) {
  const chat = store.chats.find(c => c.id === id)
  if (!chat || store.activeId === id) return null
  store.activeId = id
  localStorage.setItem(CHATS_KEY, JSON.stringify(store))
  return chat
}

export function deleteChat(store, id) {
  const idx = store.chats.findIndex(c => c.id === id)
  if (idx === -1) return null
  const wasActive = store.activeId === id
  store.chats.splice(idx, 1)
  if (!store.chats.length) {
    const chat = emptyChat()
    store.chats.push(chat)
    store.activeId = chat.id
  } else if (wasActive) store.activeId = store.chats[0].id
  localStorage.setItem(CHATS_KEY, JSON.stringify(store))
  return wasActive ? getActiveChat(store) : null
}

export function getAiConfig() {
  const saved = loadJson(CFG_KEY) || {}
  return { model: saved.model || DEFAULT_MODEL }
}

export function formatAiError(err) {
  const msg = (err?.message || String(err)).trim()
  if (/insufficient balance/i.test(msg)) return '账户余额不足，请充值后再试。'
  if (/invalid api key|authentication/i.test(msg)) return 'API Key 无效，请检查 server/.env。'
  if (/未配置 AI_API_KEY|DEEPSEEK_API_KEY/i.test(msg)) return '未配置 API Key：复制 server/.env.example 为 server/.env 并填入 AI_API_KEY，然后重启 pnpm dev:agent。'
  if (/Agent 服务|Failed to fetch|ECONNREFUSED/i.test(msg)) return 'Agent 未启动，请另开终端运行 pnpm dev:agent'
  return msg || '请求失败'
}

function parseSse(block) {
  const data = block.replace(/\r\n/g, '\n').split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('')
  try { return data ? JSON.parse(data) : null } catch { return null }
}

async function postToolResult(sessionId, callId, payload) {
  const res = await fetch(`${API}/tool-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, callId, ...payload }),
  })
  if (!res.ok) throw new Error(await res.text().catch(() => '') || `工具上报失败 (${res.status})`)
}

async function runAgentChat(userMessage, history, { model, onText, onStatus, onDone, signal }) {
  const res = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ userMessage, history, sceneSnapshot: getSceneSnapshot(), model }),
    signal,
  })
  if (!res.ok) {
    let msg = `Agent 错误 (${res.status})`
    try { const e = await res.json(); msg = e.message || e.error || msg } catch { /* ignore */ }
    throw new Error(msg)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', sessionId = '', draft = ''

  const handle = async (ev) => {
    switch (ev?.type) {
      case 'session': sessionId = ev.sessionId || sessionId; break
      case 'status': onStatus?.(ev.message || '思考中...'); break
      case 'text':
        if (ev.delta) { draft = mergeStreamText(draft, ev.delta); onText?.(draft) }
        else if (ev.content) { draft = ev.content; onText?.(draft) }
        break
      case 'tool_call': {
        const label = TOOL_STATUS[ev.toolName] || ev.toolName
        onStatus?.(`${label}...`)
        const out = await executeSceneTool(ev.toolName, ev.input)
        await postToolResult(sessionId, ev.callId, { result: out.result ?? out, sceneSnapshot: out.sceneSnapshot, error: out.error })
        break
      }
      case 'error': throw new Error(ev.message || 'Agent 执行失败')
      case 'done':
        onDone?.()
        return true
    }
    return false
  }

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let i
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const ev = parseSse(buffer.slice(0, i))
        buffer = buffer.slice(i + 2)
        if (ev && await handle(ev)) return draft || '（无内容返回）'
      }
    }
    onDone?.()
    return draft || '（连接已结束，未收到回复）'
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') return draft || '已停止。'
    throw e
  } finally {
    reader.releaseLock?.()
  }
}

export async function chatWithSceneAi(userMessage, history, model, { onText, onStatus, onDone, signal } = {}) {
  if (!window.threeEditor) throw new Error('编辑器尚未就绪')
  if (agentOnline === null) await refreshAgentMode()
  if (!agentOnline) {
    throw new Error('Agent 未就绪：请运行 pnpm dev:agent，并在 server/.env 配置 AI_API_KEY')
  }
  localStorage.setItem(CFG_KEY, JSON.stringify({ model: model?.trim() || DEFAULT_MODEL }))
  return runAgentChat(userMessage, history, { model: model?.trim() || DEFAULT_MODEL, onText, onStatus, onDone, signal })
}

export function restoreLayout({ btnSize = 48, minW = 320, minH = 400 } = {}) {
  const saved = loadJson(LAYOUT_KEY, 'ai_panel_layout')
  return {
    btn: saved?.btn
      ? { x: clamp(saved.btn.x, 0, innerWidth - btnSize), y: clamp(saved.btn.y, 0, innerHeight - btnSize) }
      : { x: Math.max(0, innerWidth - 365), y: Math.max(0, innerHeight - 80) },
    box: saved?.box
      ? { x: clamp(saved.box.x, 0, innerWidth - minW), y: clamp(saved.box.y, 0, innerHeight - minH), w: clamp(saved.box.w, minW, innerWidth), h: clamp(saved.box.h, minH, innerHeight) }
      : { x: Math.max(0, innerWidth - 680), y: 160, w: 380, h: 520 },
    open: !!saved?.open,
    showConfig: saved?.showConfig ?? false,
  }
}

export function savePanelLayout(layout) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
}

export function mountSceneAI(threeEditor) {
  window.sceneAI = {
    list: () => listObjects(threeEditor),
    getSettings: () => getEditorSettings(threeEditor),
    getApi: () => getEditorApi(threeEditor),
    listActions: () => listEditorActions(threeEditor),
    run: (action, params) => runEditorAction(threeEditor, { action, params: params || {} }),
    openPanel: (panel) => openEditorPanel(threeEditor, typeof panel === 'string' ? { panel } : panel || {}),
  }
}
