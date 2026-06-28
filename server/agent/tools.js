/**
 * 远程工具（后端 → 前端）
 *
 * 流程：
 * 1. LLM 决定调用某个 tool
 * 2. remote() 通过 SSE 告诉前端「请执行」
 * 3. 前端执行完 POST /api/agent/tool-result
 * 4. session.resolveToolResult 解除等待，把结果还给 LLM
 */
import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import { z, toJSONSchema } from 'zod/v4'
import { defineSceneTools } from '../../src/editor/ai/sceneTools.js'

/** LangChain + DeepSeek 需要标准 JSON Schema；z.any() 会序列化失败 */
function toolSchema(zodSchema) {
  try {
    const js = toJSONSchema(zodSchema)
    if (js.type === 'object') return js
  } catch { /* z.any() 等 */ }
  return { type: 'object', properties: {}, additionalProperties: true }
}

function mkTool(name, description, zodSchema, execute) {
  return tool(execute, { name, description, schema: toolSchema(zodSchema) })
}

/** 把「工具名 + 参数」发给前端，并等待结果 */
export function createRemoteExecutor(session, emit, { onToolStart } = {}) {
  return (name) => async (input) => {
    onToolStart?.(name)
    const callId = randomUUID()
    emit({ type: 'tool_call', callId, toolName: name, input: input ?? {} })
    const payload = await session.waitForToolResult(callId)
    if (payload?.sceneSnapshot) session.lastSnapshot = payload.sceneSnapshot
    if (payload?.error) return { error: payload.error }
    return payload?.result ?? payload
  }
}

/** 3 个高层技能：比逐步 addMesh 更省事 */
function skillTools(remote) {
  return [
    mkTool('skillQuickShowcase', '快速搭建完整展示场景。用户要「示例/演示场景」时优先用',
      z.object({ palette: z.string().optional() }),
      ({ palette }) => remote('buildScene')({ palette }),
    ),
    mkTool('skillSetupLighting', '标准打光 + 阴影。场景偏暗或用户要「开阴影/打光」时用',
      z.object({ warm: z.boolean().optional() }),
      async ({ warm }) => {
      const steps = [
        await remote('addLight')({ type: '环境光', intensity: 0.4 }),
        await remote('addLight')({ type: '平行光', position: warm ? [5, 9, 4] : [6, 10, 4], intensity: warm ? 1.2 : 1.1 }),
        await remote('enableShadows')({}),
      ]
      if (steps.find(s => s?.error)) return steps.find(s => s?.error)
      return { ok: true, message: '已配置灯光并开启阴影' }
    }),
    mkTool('skillFocusScene', '相机对准场景或指定对象',
      z.object({ objectId: z.number().optional() }),
      ({ objectId }) => remote('focusCamera')({ objectId }),
    ),
  ]
}

const TOOL_NAMES = [
  'inspectScene', 'listResources', 'getObject', 'editObject', 'addMesh', 'addComponent',
  'addModel', 'addLight', 'cloneObject', 'deleteObject', 'placeOnGround', 'createMesh',
  'setMaterial', 'setSceneProps', 'addNativeLight', 'setLightProps', 'applyTexture',
  'lookAt', 'setEnvironment', 'enableShadows', 'focusCamera', 'playAnimation', 'history',
  'openPanel', 'buildScene', 'runAdvanced',
]

/** 全部工具（场景原子工具 + 技能），供 LangGraph ReAct Agent 使用 */
export function createTools(session, emit, { onToolStart } = {}) {
  const remote = createRemoteExecutor(session, emit, { onToolStart })
  const executors = Object.fromEntries(TOOL_NAMES.map(n => [n, remote(n)]))

  const defs = defineSceneTools({
    mk: (desc, schema, exec) => ({ desc, schema, exec }),
    atomic: (_n, desc, schema, exec) => ({ desc, schema, exec }),
    executors,
  })

  const sceneTools = Object.entries(defs).map(([name, def]) =>
    mkTool(name, def.desc, def.schema, def.exec),
  )

  return [...sceneTools, ...skillTools(remote)]
}
