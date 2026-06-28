/** 会话：后端等前端 POST tool-result 时用的「挂起 / 唤醒」机制 */
import { randomUUID } from 'node:crypto'

const TOOL_TIMEOUT_MS = 120_000

export class AgentSessionManager {
  constructor() {
    this.sessions = new Map()
  }

  create(abortSignal) {
    const id = randomUUID()
    const session = new AgentSession(id, abortSignal)
    this.sessions.set(id, session)
    session.onDispose = () => this.sessions.delete(id)
    return session
  }

  get(id) {
    return this.sessions.get(id) || null
  }
}

export class AgentSession {
  constructor(id, abortSignal) {
    this.id = id
    this.abortSignal = abortSignal
    this.pending = new Map()
    this.onDispose = null
    this.lastSnapshot = null
  }

  waitForToolResult(callId) {
    if (this.abortSignal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId)
        reject(new Error('工具执行超时'))
      }, TOOL_TIMEOUT_MS)

      const finish = (fn) => (value) => {
        clearTimeout(timer)
        this.pending.delete(callId)
        fn(value)
      }

      this.pending.set(callId, finish(resolve))

      this.abortSignal?.addEventListener('abort', () => {
        if (this.pending.has(callId)) {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          finish(reject)(err)
        }
      }, { once: true })
    })
  }

  resolveToolResult(callId, payload) {
    const resolve = this.pending.get(callId)
    if (!resolve) return false
    resolve(payload)
    return true
  }

  dispose() {
    for (const [, resolve] of this.pending) {
      resolve({ error: '会话已结束' })
    }
    this.pending.clear()
    this.onDispose?.()
  }
}

export const sessions = new AgentSessionManager()
