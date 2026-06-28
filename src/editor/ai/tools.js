import { CURATED, ADVANCED_HINT } from './shared.js'
import {
  allSceneTools, buildScene, enableSceneShadows, focusScene, getLiveContext,
  inspectScene, listEditorActions, listResources,
  mk, runEditorAction, validateEditInput,
} from './core.js'
import { defineSceneTools } from './sceneTools.js'

function snap(editor) {
  try { return editor.saveSceneEdit?.() ?? null } catch { return null }
}

function rollback(editor, s) {
  if (!s) return
  try { editor.resetEditorStorage?.(s) } catch { /* ignore */ }
}

function createLocalExecutors(editor, all) {
  const atomic = (name, toolObj) => async (input) => {
    const s = snap(editor)
    try {
      const out = await toolObj.execute(input)
      if (out?.error) { rollback(editor, s); return { ...out, reverted: true } }
      return out
    } catch (e) {
      rollback(editor, s)
      return { error: `${name} 失败：${e?.message || String(e)}`, reverted: true }
    }
  }

  return {
    inspectScene: (input) => inspectScene(editor, { ...input, includeObjects: true }),
    listResources: (input) => listResources(editor, input || {}),
    getObject: ({ id, children }) => all.getDetail.execute({ id, children }),
    editObject: async (input) => {
      const s = snap(editor)
      try {
        const bad = validateEditInput(editor, input)
        if (bad) return bad
        const { id, params, uniforms, metalness, roughness, emissive, ...rest } = input
        let last
        if (params || uniforms) {
          last = await all.setObjectParams.execute({ id, params, uniforms })
          if (last?.error) { rollback(editor, s); return { ...last, reverted: true } }
        }
        const mat = { metalness, roughness, emissive, color: rest.color, opacity: rest.opacity }
        if (Object.values(mat).some(v => v != null)) {
          last = await all.setMaterial.execute({ id, ...mat })
          if (last?.error) { rollback(editor, s); return { ...last, reverted: true } }
          delete rest.color; delete rest.opacity
        }
        if (Object.keys(rest).some(k => k !== 'id' && rest[k] != null)) {
          last = await all.setProps.execute({ id, ...rest })
        }
        const out = last || { error: '没有可应用的修改' }
        if (out?.error) return out
        const visual = params || uniforms || rest.position || rest.rotation || rest.scale
          || input.color != null || input.opacity != null || input.metalness != null
        if (visual) await all.focusObject.execute({ id: input.id }).catch(() => {})
        return out
      } catch (e) {
        rollback(editor, s)
        return { error: `editObject 失败：${e?.message || String(e)}`, reverted: true }
      }
    },
    addMesh: atomic('addMesh', all.addMesh),
    addComponent: atomic('addComponent', all.addComponent),
    addModel: atomic('addModel', all.addModel),
    addLight: atomic('addLight', all.addLight),
    cloneObject: atomic('cloneObject', all.cloneObject),
    deleteObject: atomic('deleteObject', all.deleteObject),
    placeOnGround: atomic('placeOnGround', all.placeOnGround),
    createMesh: atomic('createMesh', all.createMesh),
    setMaterial: atomic('setMaterial', all.setMaterial),
    setSceneProps: atomic('setSceneProps', all.setSceneProps),
    addNativeLight: atomic('addNativeLight', all.addNativeLight),
    setLightProps: atomic('setLightProps', all.setLightProps),
    applyTexture: atomic('applyTexture', all.applyTexture),
    lookAt: atomic('lookAt', all.lookAt),
    playAnimation: atomic('playAnimation', all.playAnimation),
    setEnvironment: async ({ sky, env, background, fog }) => {
      const out = {}
      if (sky) Object.assign(out, await all.setSky.execute({ name: sky }))
      if (env) Object.assign(out, await all.setEnv.execute({ name: env }))
      if (background !== undefined || fog !== undefined) Object.assign(out, await all.setSceneProps.execute({ background, fog }))
      return Object.keys(out).length ? out : { error: '请指定 sky/env/background/fog 之一' }
    },
    enableShadows: (input) => enableSceneShadows(editor, input || {}),
    focusCamera: async ({ objectId, position, target }) => {
      if (objectId != null) return all.focusObject.execute({ id: objectId })
      if (position && target) return all.focusView.execute({ position, target })
      return focusScene(editor)
    },
    history: ({ action }) => action === 'undo' ? all.undoEditor.execute({}) : all.redoEditor.execute({}),
    openPanel: ({ panel }) => all.openEditorPanel.execute(panel ? { panel, openMain: true } : {}),
    buildScene: ({ palette }) => {
      const s = snap(editor)
      return buildScene(editor, { palette }).catch(e => { rollback(editor, s); return { error: e?.message || String(e) } })
    },
    runAdvanced: async ({ tool: name, input = {} }) => {
      if (CURATED.has(name)) return { error: `请直接用「${name}」工具，不要走 runAdvanced` }
      if (name === 'openEditorPanel') return { error: '请直接用「openPanel」工具' }
      if (name === 'undoEditor' || name === 'redoEditor') return { error: '请直接用「history」工具' }
      if (name === 'runEditorAction') return runEditorAction(editor, { action: input.action, params: input.params || {} })
      if (name === 'listEditorActions') return listEditorActions(editor)
      const t = allSceneTools(editor)[name]
      if (!t?.execute) return { error: `未知工具「${name}」`, hint: ADVANCED_HINT }
      return t.execute(input)
    },
  }
}

function createSceneTools(editor) {
  const all = allSceneTools(editor)
  const executors = createLocalExecutors(editor, all)
  return defineSceneTools({ mk, atomic: (n, d, s, e) => mk(d, s, e), executors })
}

export function getSceneSnapshot() {
  const editor = window.threeEditor
  return editor ? getLiveContext(editor) : { ready: false }
}

export async function executeSceneTool(toolName, input) {
  const editor = window.threeEditor
  if (!editor) return { error: '编辑器尚未就绪' }
  const tool = createSceneTools(editor)[toolName]
  if (!tool?.execute) return { error: `未知工具「${toolName}」` }
  try {
    const result = await tool.execute(input ?? {})
    return { ok: !result?.error, result, sceneSnapshot: getLiveContext(editor) }
  } catch (e) {
    return { error: e?.message || String(e), sceneSnapshot: getLiveContext(editor) }
  }
}
