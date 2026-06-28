/** 前后端共享（无 Three.js 依赖） */

export const CFG_KEY = 'AI_scene_config'
export const LAYOUT_KEY = 'AI_panel_layout'
export const CHATS_KEY = 'AI_chats'
export const AGENT_API_BASE = '/api/agent'
export const DEFAULT_MODEL = 'deepseek-v4-flash'
export const MAX_STEPS = 12

export const TOOL_STATUS = {
  inspectScene: '看场景', listResources: '查资源', openPanel: '开面板', getObject: '读对象', editObject: '改对象',
  addMesh: '加几何', addComponent: '加组件', addModel: '加模型', addLight: '加灯光',
  createMesh: '原生建模', setMaterial: '原生材质', setSceneProps: '原生场景',
  addNativeLight: '原生灯光', setLightProps: '灯光调参', applyTexture: '贴图',
  cloneObject: '克隆对象', lookAt: '朝向目标',
  deleteObject: '删除', placeOnGround: '贴地', setEnvironment: '设氛围', enableShadows: '开阴影',
  playAnimation: '播动画', history: '撤销/重做', buildScene: '搭建场景', runAdvanced: '高级操作',
}

export const CURATED = new Set([
  'inspectScene', 'listResources', 'openPanel', 'getObject', 'editObject',
  'addMesh', 'addComponent', 'addModel', 'addLight',
  'createMesh', 'setMaterial', 'setSceneProps', 'addNativeLight', 'setLightProps', 'applyTexture', 'cloneObject', 'lookAt',
  'deleteObject', 'placeOnGround', 'setEnvironment', 'enableShadows', 'focusCamera',
  'playAnimation', 'history', 'buildScene', 'runAdvanced',
])

export const ADVANCED_HINT = 'runEditorAction,openEditorPanel,exportSceneGlb,createInstancedMesh,createLatheMesh,addTubeMesh,...'
export const LIGHT_TYPES = ['环境光', '平行光', '点光源', '聚光灯', '半球光', '平面光']
export const MESH_TYPE_NAMES = ['立方体', '球体', '圆柱', '圆锥', '圆环', '平面', '二十面体', '八面体', '十二面体', '圆扭结']
export const MATERIAL_TYPES = ['MeshBasicMaterial', 'MeshStandardMaterial', 'MeshPhongMaterial', 'MeshLambertMaterial', 'MeshNormalMaterial', 'MeshPhysicalMaterial', 'MeshToonMaterial', 'MeshDepthMaterial']
export const GEOMETRY_TYPES = ['BoxGeometry', 'SphereGeometry', 'PlaneGeometry', 'CylinderGeometry', 'ConeGeometry', 'TorusGeometry', 'TorusKnotGeometry', 'IcosahedronGeometry']
export const TEXTURE_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']
export const BASIC_PANELS = ['渲染配置', '相机配置', '轨道配置', '变换配置', '环境配置', '后期处理']
export const SKY_NAMES = ['蓝天', '晴天', '森林', '清除']
export const COLOR_PALETTE_NAMES = ['黄昏暖调', '森林清晨', '海洋暮色', '极简中性', '霓虹赛博']

/** 精简美学规范（控制 token，供 buildSystemPrompt 注入） */
const VISUAL_GUIDE = `## 场景美学（简要）
- 光：主光(平行光 intensity 1~2，斜上方) + 环境/半球补光；有物体时用 enableShadows
- 色：背景+主体+点缀三色同温；雾色接近背景
- 材质：金属 metalness↑ roughness↓；地面 roughness 0.8，避免纯白
- 空间：position 是轴心，贴地 placeOnGround；改完 focusCamera；装饰物体积≈主体 0.2~0.5`

export function buildSystemPrompt(live) {
  const scene = []
  if (live?.ready) {
    scene.push(`对象数：${live.count}，地面Y=${live.groundY}`)
    if (!live.shadowsOn && live.count > 1) scene.push('⚠ 阴影未开启（enableShadows 一键开）')
    const c = live.colors || {}
    if (c.background) scene.push(`背景：${c.background}${c.fog ? `  雾：${c.fog}${c.fogRange ? ` (${c.fogRange})` : ''}` : ''}`)
    if (c.lights?.length) scene.push(`灯光：${c.lights.map(l => `${l.type} intensity=${l.intensity}${l.shadow ? ' ✓shadow' : ''}`).join('，')}`)
    if (c.meshColors?.length) scene.push(`场景主色：${c.meshColors.join(' ')}`)
    if (live.selected) scene.push(`选中：${live.selected.line}`)
    if (live.snapshot?.length) scene.push(`对象快照：\n${live.snapshot.map(s => '  ' + s).join('\n')}`)
    if (live.hints?.length) scene.push(`⚡ ${live.hints.join('；')}`)
  } else {
    scene.push('场景为空，可用 buildScene 快速搭建示例')
  }

  return `你是专为「数字孪生三维场景编辑器」定制的 AI 助手，直接操作 Three.js 编辑器视口。用户看视口结果，不看代码。

## 当前场景状态
${scene.join('\n')}

## 工作流程
1. **理解**：用户要什么视觉效果？（不是字面堆对象）
2. **感知**：不确定场景现状先 inspectScene；改物体前先 getObject 读 editHints/bounds/custom
3. **规划**：最少步骤达成目标，优先原生工具
4. **执行**：调工具落地，添加/大改后 focusCamera 确保用户看得见
5. **反馈**：告诉用户视口里发生了什么变化

## 操作规则
- **执行型请求必须调用工具**，禁止只给建议
- **改物体前必须 getObject**；贴地用 placeOnGround
- **加模型/组件**：先 listResources

${VISUAL_GUIDE}

## 回复格式
【理解】用户要什么效果（1句）
【做法】用什么手段（1-2句）
【结果】执行后视口里能看到什么`
}

export function normalizeChatHistory(history = []) {
  return history
    .filter(m => m.content?.trim() && !m.loading)
    .map(m => ({ role: m.placement === 'end' ? 'user' : 'assistant', content: String(m.content).trim().slice(0, 600) }))
    .slice(-8)
}

export function mergeStreamText(current, chunk) {
  const next = String(chunk || '')
  if (!next) return current
  if (!current) return next
  if (next.startsWith(current)) return next
  for (let i = Math.min(current.length, next.length); i > 0; i--) {
    if (current.slice(-i) === next.slice(0, i)) return current + next.slice(i)
  }
  return current + next
}
