/**
 * Agent 核心（LangGraph 编排）
 *
 * 整体流程：
 *   用户消息 → route（判断聊天还是改场景）
 *            → chat：纯对话，不调工具
 *            → execute：ReAct Agent 循环调工具
 *            → verify：规则检查执行结果
 *
 * 读代码建议顺序：runBackendAgent → buildGraph → 四个 node 函数
 */
import { StateGraph, START, END, Annotation } from '@langchain/langgraph'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { ChatAnthropic } from '@langchain/anthropic'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import {
  MAX_STEPS, TOOL_STATUS, buildSystemPrompt, mergeStreamText, normalizeChatHistory,
} from '../../src/editor/ai/shared.js'
import { getAgentConfig } from './config.js'
import { createTools, createRemoteExecutor } from './tools.js'

// ── 1. 意图路由：概念问答 vs 场景操作 ─────────────────────────────

const CHAT_PATTERNS = [/^你好|^您好|^hi$|^hello$/i, /^什么是|^什么叫|什么意思|怎么理解/, /three\.?js\s*(是什么|怎么用)/i]
const EXECUTE_HINTS = [/加|删|改|建|搭|读|查|看|场景|阴影|光照|材质|相机|对准|inspect/i, /add|delete|create|build|shadow|light|inspect/i]

function routeIntent(text) {
  const msg = String(text || '').trim()
  if (!msg) return { mode: 'chat', reason: 'empty' }
  if (CHAT_PATTERNS.some(p => p.test(msg))) return { mode: 'chat', reason: 'concept' }
  if (EXECUTE_HINTS.some(p => p.test(msg))) return { mode: 'execute', reason: 'action' }
  return { mode: 'execute', reason: 'default' }
}

// ── 2. 场景验收：不调用 LLM，用规则检查快照 ───────────────────────

function verifyScene(snapshot, steps = []) {
  if (!snapshot?.ready) return { notes: [] }
  const notes = []
  if ((snapshot.count ?? 0) > 1 && !snapshot.shadowsOn) notes.push('有多个对象但阴影未开启')
  if (steps.length >= 8) notes.push(`已执行 ${steps.length} 步，建议 focusCamera`)
  if (snapshot.hints?.length) notes.push(...snapshot.hints)
  return { notes }
}

// ── 3. 小工具函数 ───────────────────────────────────────────────

function createLLM(modelName) {
  const cfg = getAgentConfig({ model: modelName })
  return new ChatAnthropic({
    model: cfg.model,
    anthropicApiKey: cfg.apiKey,
    clientOptions: { baseURL: cfg.baseURL },
    streaming: true,
  })
}

function toMessages(history) {
  return normalizeChatHistory(history).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
  )
}

function textOf(chunk) {
  if (typeof chunk.content === 'string') return chunk.content
  if (Array.isArray(chunk.content)) {
    return chunk.content.map((p) => {
      if (typeof p === 'string') return p
      if (p?.type === 'text') return p.text || ''
      return p?.text || ''
    }).join('')
  }
  return ''
}

function extractFinalText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = textOf(messages[i])
    if (t.trim()) return t.trim()
  }
  return ''
}

/** 把 LLM 流式 token 实时推给前端（只推正文，不推 thinking） */
function streamTextToClient(chunk, meta, emit, draftRef) {
  if (meta?.langgraph_node && meta.langgraph_node !== 'agent') return draftRef.current
  const delta = textOf(chunk)
  if (!delta) return draftRef.current
  draftRef.current = mergeStreamText(draftRef.current, delta)
  emit({ type: 'text', delta, content: draftRef.current })
  return draftRef.current
}

async function streamLLM(llm, messages, emit, signal) {
  const draft = { current: '' }
  for await (const chunk of await llm.stream(messages, { signal })) {
    if (signal?.aborted) break
    streamTextToClient(chunk, { langgraph_node: 'agent' }, emit, draft)
  }
  return draft.current.trim() || '好的。'
}

async function streamReactAgent(agent, inputs, emit, signal) {
  const draft = { current: '' }
  let lastMessages = []
  const stream = await agent.stream(inputs, {
    streamMode: ['messages', 'values'],
    recursionLimit: MAX_STEPS * 2 + 2,
    signal,
  })

  for await (const item of stream) {
    if (signal?.aborted) break

    if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string') {
      const [mode, data] = item
      if (mode === 'messages') streamTextToClient(data[0], data[1], emit, draft)
      if (mode === 'values' && data?.messages) lastMessages = data.messages
      continue
    }

    if (Array.isArray(item) && item[1]?.langgraph_node !== undefined) {
      streamTextToClient(item[0], item[1], emit, draft)
      continue
    }

    if (item?.messages) lastMessages = item.messages
  }

  let reply = draft.current.trim() || extractFinalText(lastMessages)
  return reply
}

function cfg(config) {
  return config?.configurable || {}
}

// ── 4. LangGraph 状态与节点 ───────────────────────────────────────

const State = Annotation.Root({
  userMessage: Annotation(),
  history: Annotation({ default: () => [] }),
  mode: Annotation({ default: () => 'execute' }),
  reply: Annotation({ default: () => '' }),
  steps: Annotation({
    default: () => [],
    reducer: (a, b) => [...(a || []), ...(Array.isArray(b) ? b : b ? [b] : [])],
  }),
})

async function routeNode(state, config) {
  const { emit } = cfg(config)
  const route = routeIntent(state.userMessage)
  emit?.({ type: 'route', mode: route.mode, reason: route.reason })
  return { mode: route.mode }
}

async function chatNode(state, config) {
  const { emit, model, signal } = cfg(config)
  emit({ type: 'status', message: '思考中...' })

  const llm = createLLM(model)
  const messages = [
    new SystemMessage('你是 Three.js 编辑器助手。纯问答时简洁回答，不要假装已改场景。'),
    ...toMessages(state.history),
    new HumanMessage(state.userMessage),
  ]

  const reply = await streamLLM(llm, messages, emit, signal)
  emit({ type: 'text', content: reply })
  return { reply }
}

async function executeNode(state, config) {
  const { session, emit, model, signal, sceneSnapshot } = cfg(config)
  const steps = []

  const tools = createTools(session, emit, {
    onToolStart: (name) => {
      const label = TOOL_STATUS[name] || name
      steps.push(label)
      emit({ type: 'step', label, toolName: name })
      emit({ type: 'status', message: `${label}...` })
    },
  })

  const system = buildSystemPrompt(sceneSnapshot || session.lastSnapshot || { ready: false })
  const agent = createReactAgent({ llm: createLLM(model), tools, prompt: system })
  emit({ type: 'status', message: '规划并执行...' })

  const inputs = { messages: [...toMessages(state.history), new HumanMessage(state.userMessage)] }
  let reply = await streamReactAgent(agent, inputs, emit, signal)

  if (signal?.aborted) return { reply: reply || '已停止。', steps }

  if (!reply) reply = steps.length ? '已执行操作。' : '未能完成，请重试。'
  if (steps.length && !/已执行/.test(reply)) {
    reply += `\n\n（已执行：${steps.join(' → ')}）`
    emit({ type: 'text', content: reply })
  }
  return { reply, steps }
}

async function verifyNode(state, config) {
  const { session, emit, sceneSnapshot } = cfg(config)
  let reply = state.reply || ''
  const { notes } = verifyScene(session.lastSnapshot || sceneSnapshot, state.steps || [])

  if (notes.length) {
    emit({ type: 'verify', notes })
    reply += `\n\n（场景检查：${notes.join('；')}）`
    if ((state.steps?.length ?? 0) >= 3) {
      try {
        emit({ type: 'status', message: '对准场景...' })
        await createRemoteExecutor(session, emit)('focusCamera')({})
      } catch { /* 可选 */ }
    }
  }

  emit({ type: 'text', content: reply })
  return { reply }
}

function buildGraph() {
  return new StateGraph(State)
    .addNode('route', routeNode)
    .addNode('chat', chatNode)
    .addNode('execute', executeNode)
    .addNode('verify', verifyNode)
    .addEdge(START, 'route')
    .addConditionalEdges('route', s => (s.mode === 'chat' ? 'chat' : 'execute'))
    .addEdge('chat', END)
    .addEdge('execute', 'verify')
    .addEdge('verify', END)
    .compile()
}

const graph = buildGraph()

// ── 5. 对外入口（index.js 调用） ─────────────────────────────────

export async function runBackendAgent({ session, userMessage, history, sceneSnapshot, model, emit, signal }) {
  session.lastSnapshot = sceneSnapshot || null
  const result = await graph.invoke(
    { userMessage, history: history || [], steps: [] },
    { configurable: { session, emit, model, signal, sceneSnapshot }, signal },
  )
  return result.reply || ''
}
