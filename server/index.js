/**
 * Agent HTTP 服务（只做三件事）
 * 1. GET  /api/agent/health      — 健康检查
 * 2. POST /api/agent/chat        — SSE 对话，核心逻辑在 agent/agent.js
 * 3. POST /api/agent/tool-result — 前端回传工具执行结果
 */
import './env.js'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { runBackendAgent } from './agent/agent.js'
import { sessions } from './agent/session.js'

const PORT = Number(process.env.AGENT_PORT || 3001)
const HOST = process.env.AGENT_HOST || '0.0.0.0'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
})

function sseWrite(reply, payload) {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
  if (typeof reply.raw.flush === 'function') reply.raw.flush()
}

app.get('/api/agent/health', async () => {
  const hasApiKey = !!(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY)
  return {
    ok: hasApiKey,
    service: 'threejs-editor-agent',
    version: '3.0.0',
    stack: 'langgraph (4 files)',
    hasApiKey,
    hint: hasApiKey ? undefined : '请复制 server/.env.example 为 server/.env 并填入 AI_API_KEY',
  }
})

app.post('/api/agent/tool-result', async (req, reply) => {
  const { sessionId, callId, result, sceneSnapshot, error } = req.body || {}
  if (!sessionId || !callId) {
    return reply.code(400).send({ error: '缺少 sessionId 或 callId' })
  }

  const session = sessions.get(sessionId)
  if (!session) {
    return reply.code(404).send({ error: '会话不存在或已过期' })
  }

  const ok = session.resolveToolResult(callId, { result, sceneSnapshot, error })
  if (!ok) {
    return reply.code(404).send({ error: '未找到对应的 tool call' })
  }

  return { ok: true }
})

app.post('/api/agent/chat', async (req, reply) => {
  const { userMessage, history, sceneSnapshot, model } = req.body || {}
  if (!userMessage?.trim()) {
    return reply.code(400).send({ error: 'userMessage 不能为空' })
  }

  const abortController = new AbortController()
  // 注意：req 的 close 在 POST body 读完就会触发，不能用来取消 SSE
  reply.raw.on('close', () => abortController.abort())

  const session = sessions.create(abortController.signal)

  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  sseWrite(reply, { type: 'session', sessionId: session.id })

  try {
    await runBackendAgent({
      session,
      userMessage: userMessage.trim(),
      history: history || [],
      sceneSnapshot,
      model,
      signal: abortController.signal,
      emit: (event) => sseWrite(reply, event),
    })
    sseWrite(reply, { type: 'done' })
  } catch (e) {
    if (!abortController.signal.aborted) {
      sseWrite(reply, { type: 'error', message: e?.message || String(e) })
    }
  } finally {
    session.dispose()
    reply.raw.end()
  }
})

try {
  await app.listen({ port: PORT, host: HOST })
  app.log.info(`Agent server listening on http://${HOST}:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
