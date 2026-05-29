import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText, stepCountIs } from 'ai'
import { z } from 'zod/v4'
import {
  ADVANCED_HINT,
  CURATED,
  MAX_HISTORY,
  MAX_STEPS,
  TOOL_STATUS,
} from './config.js'
import {
  allSceneTools,
  buildScene,
  enableSceneShadows,
  focusScene,
  getLiveContext,
  inspectScene,
  listEditorActions,
  listResources,
  mk,
  runEditorAction,
  validateEditInput,
  vec3,
  vec3req,
} from './core.js'
import {
  COLOR_EDIT_GUIDE,
  EDIT_WORKFLOW,
  MASTER_THINKING,
  REPLY_FORMAT,
  SCENE_COMPOSE_GUIDE,
  SHADER_EDIT_GUIDE,
  SHADOW_GUIDE,
  SPATIAL_EDIT_GUIDE,
} from './config.js'
import { guardAdvancedInvocation, safetyPromptAddon } from './policy.js'

const BUSINESS_SCENARIOS = [
  { domain: '营销展示', re: /(营销|转化|品牌|展厅|发布会|招商|宣传|获客|线索|产品演示|新品|销售)/ },
  { domain: '工业运维', re: /(工厂|机房|产线|设备|告警|监控|巡检|孪生|运维|能源|安防)/ },
  { domain: '园区城市', re: /(园区|城市|智慧城市|交通|楼宇|建筑|地图|地块|规划)/ },
  { domain: '教育培训', re: /(教学|培训|课程|科普|课堂|演示案例|学习)/ },
  { domain: '文旅展陈', re: /(文旅|博物馆|展陈|文物|景区|导览|沉浸式)/ },
]

const BUSINESS_GOALS = [
  { goal: '提升转化', re: /(转化|下单|咨询|留资|报名|点击|cta|按钮)/i, kpi: '3 秒内识别主体和行动路径' },
  { goal: '强化品牌调性', re: /(品牌|调性|高级感|质感|统一|视觉语言)/, kpi: '色彩和材质风格统一，避免杂乱' },
  { goal: '提高信息可读性', re: /(可读|看清|层级|信息|数据|图表|监控|指标)/, kpi: '主次分层清晰，关键对象可快速定位' },
  { goal: '突出空间叙事', re: /(故事|叙事|路径|导览|沉浸|氛围|体验)/, kpi: '镜头路径和光影引导一致' },
]

const READONLY_ADVANCED_TOOLS = new Set([
  'getDetail',
  'listComponentSchema',
  'listAnimations',
  'getObjectBox3Info',
  'getObjectMaterials',
  'getEditorSettings',
  'getEditorApi',
  'listScenes',
  'listSkies',
  'listViewAngles',
  'listClippingPlanes',
  'getSceneStats',
  'getShareLink',
])

const READONLY_EDITOR_ACTIONS = new Set([
  'listViewAngles',
  'listClippingPlanes',
  'getSceneStats',
  'getShareLink',
  'listBlendShaders',
])

const MUTATING_TOOL_NAMES = new Set([
  'editObject',
  'addMesh',
  'addComponent',
  'addModel',
  'addLight',
  'createMesh',
  'setMaterial',
  'setSceneProps',
  'addNativeLight',
  'setLightProps',
  'applyTexture',
  'cloneObject',
  'lookAt',
  'deleteObject',
  'placeOnGround',
  'setEnvironment',
  'enableShadows',
  'focusCamera',
  'playAnimation',
  'history',
  'buildScene',
  'runAdvanced',
])

const CREATE_TOOL_NAMES = new Set([
  'addMesh',
  'addComponent',
  'addModel',
  'addLight',
  'createMesh',
  'addNativeLight',
  'cloneObject',
  'buildScene',
])

const CREATE_ADVANCED_TOOLS = new Set([
  'addMesh',
  'addComponent',
  'addModel',
  'addLight',
  'buildScene',
  'addInnerMesh',
  'addCoreLight',
  'loadOnlineModel',
  'createMesh',
  'addNativeLight',
  'cloneObject',
  'createGroup',
  'createBufferMesh',
  'createInstancedMesh',
  'createLatheMesh',
  'addTubeMesh',
])

const CREATE_EDITOR_ACTIONS = new Set([
  'addInnerMesh',
  'addCoreLight',
  'loadOnlineModel',
])

const TOOL_BASE_ORDER = [
  'inspectScene',
  'listResources',
  'openPanel',
  'getObject',
  'editObject',
  'addMesh',
  'addComponent',
  'addModel',
  'addLight',
  'deleteObject',
  'placeOnGround',
  'setEnvironment',
  'enableShadows',
  'focusCamera',
  'buildScene',
  'playAnimation',
  'history',
  'runAdvanced',
]

const TOOL_CREATION_SET = new Set([
  'addMesh',
  'addComponent',
  'addModel',
  'addLight',
  'createMesh',
  'addNativeLight',
  'cloneObject',
  'buildScene',
])

const TOOL_NATIVE_ORDER = [
  'createMesh',
  'setMaterial',
  'setSceneProps',
  'addNativeLight',
  'setLightProps',
  'applyTexture',
  'cloneObject',
  'lookAt',
]

const PANEL_TOOL_OPTIONS = ['渲染配置', '相机配置', '轨道配置', '变换配置', '环境配置', '后期处理']
const PANEL_INTENT_RULES = [
  { panel: '后期处理', re: /(后期|后处理|post|特效)/i },
  { panel: '渲染配置', re: /(渲染|renderer|webgl)/i },
  { panel: '相机配置', re: /(相机|camera)/i },
  { panel: '轨道配置', re: /(轨道|orbit|控制器)/i },
  { panel: '变换配置', re: /(变换|transform|平移|旋转|缩放)/i },
  { panel: '环境配置', re: /(环境|fog|雾|背景)/i },
]

const DIRECT_MODEL_ALIAS_MAP = {
  狐狸: 'fox',
  狐狸模型: 'fox',
  fox: 'fox',
}

const LIB_CAPABILITY_GUIDE = [
  '底层能力来自 ThreeEditor 与 lib：scene/camera/renderer/controls/transformControls/effectComposer。',
  '可以稳定调用：saveSceneEdit/resetEditorStorage/openControlPanel/getSceneEvent/setCss2dDOM/setCss3dDOM。',
  '优先走 core 提供的安全封装工具，尽量避免直接改未知内部字段。',
  '原生 Three.js 能力可直接用：createMesh/setMaterial/setSceneProps/addNativeLight/setLightProps/applyTexture/lookAt/cloneObject。',
  '模型优先走编辑器本地模型库：先 listResources 查看 models，再 addModel；不要默认去 three.js 官方或外网找资源。',
].join('\n')

const ADVANCED_TOOL_WHITELIST = [
  'placeOnGround',
  'getDetail',
  'setObjectParams',
  'listComponentSchema',
  'listAnimations',
  'playAnimation',
  'stopAnimation',
  'setAnimationPlayParams',
  'runEditorAction',
  'listEditorActions',
  'openEditorPanel',
  'openObjectPanel',
  'setEditorMode',
  'undoEditor',
  'redoEditor',
  'saveEditorScene',
  'captureScreenshot',
  'exportSceneJson',
  'exportSceneGlb',
  'getObjectBox3Info',
  'getObjectMaterials',
  'getEditorSettings',
  'setEditorSettings',
  'setProps',
  'selectObject',
  'deleteObject',
  'addModel',
  'addComponent',
  'addLight',
  'addMesh',
  'addMeshes',
  'createGroup',
  'reparentObject',
  'cloneObject',
  'lookAt',
  'createMesh',
  'setMaterial',
  'replaceGeometry',
  'addLine',
  'addPoints',
  'setSceneProps',
  'applyTexture',
  'setLightProps',
  'createBufferMesh',
  'addNativeLight',
  'addSprite',
  'createInstancedMesh',
  'createLatheMesh',
  'addTubeMesh',
  'updateMeshGeometry',
  'addMeshWireframe',
  'listScenes',
  'loadScene',
  'listSkies',
  'setSky',
  'setEnv',
  'setHelpers',
  'focusObject',
  'focusView',
]

const ADVANCED_TOOL_NAME_SET = new Set(ADVANCED_TOOL_WHITELIST)

function compactContent(text = '', maxLen = 420) {
  const t = String(text || '').trim().replace(/\s+/g, ' ')
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen)}...`
}

function localModelNames() {
  return (window.models || [])
    .map((url) => String(url || '').split('/').pop())
    .filter(Boolean)
}

function normDirectToken(value = '') {
  return String(value || '').toLowerCase().replace(/[\s_\-]+/g, '')
}

function extractObjectId(text = '') {
  const src = String(text || '')
  const fromHash = src.match(/#(\d+)/)
  if (fromHash) return Number(fromHash[1])
  const fromId = src.match(/id\s*[:：=]?\s*(\d+)/i)
  if (fromId) return Number(fromId[1])
  return null
}

function isQuestionLike(text = '') {
  return /(为什么|怎么|如何|可不可以|能不能|是不是|吗|？|\?)/.test(String(text || ''))
}

function hasStrongDirectVerb(text = '') {
  return /(加载|导入|引入|打开|开启|撤销|重做|删除|移除|贴地|聚焦|对准|切换|模式|投影|阴影)/.test(String(text || ''))
}

function hasPanelOpenVerb(text = '') {
  return /(打开|开启|调出|进入|显示|弹出|切到|切换到|open)/i.test(String(text || ''))
}

function resolvePanelIntent(text = '') {
  for (const rule of PANEL_INTENT_RULES) {
    if (rule.re.test(String(text || ''))) return rule.panel
  }
  return null
}

function isPanelCommand(text = '') {
  const t = String(text || '')
  return hasPanelOpenVerb(t) && /(面板|控制板|配置|后期|渲染|相机|轨道|变换|环境|panel)/i.test(t)
}

function isModelLoadCommand(text = '') {
  const t = String(text || '')
  const hasModelCue = /(\.glb|\.gltf|\.fbx|模型|model)/i.test(t)
  const hasLoadVerb = /(加载|导入|引入|载入|接入|添加|加个|放上|摆上|使用)/.test(t)
  return hasModelCue && hasLoadVerb
}

function isShadowCommand(text = '') {
  const t = String(text || '')
  const hasShadowWord = /(阴影|投影|投射|castshadow|receiveshadow)/i.test(t)
  const hasActionVerb = /(开|开启|打开|启用|加|投|投射|投影|设置|应用|让)/.test(t)
  return hasShadowWord && hasActionVerb
}

function isFocusCommand(text = '') {
  return /(聚焦|对准|看向|看清|飞到|拉近|focus|frame)/i.test(String(text || ''))
}

function isDeleteCommand(text = '') {
  const t = String(text || '')
  return /(删除|移除|删掉|清掉)/.test(t) && /(选中|当前|这个|它|id|#\d+)/i.test(t)
}

function isPlaceOnGroundCommand(text = '') {
  return /(贴地|放到地面|落地|对齐地面|贴到地面|放地上|落到地面)/.test(String(text || ''))
}

function resolveTransformMode(text = '') {
  const t = String(text || '')
  if (/(旋转模式|旋转工具|rotate)/i.test(t)) return 'rotate'
  if (/(缩放模式|缩放工具|scale)/i.test(t)) return 'scale'
  if (/(平移模式|移动模式|位移模式|translate)/i.test(t)) return 'translate'
  return null
}

function resolveTargetObjectId(editor, text = '') {
  const fromText = extractObjectId(text)
  if (fromText != null) return fromText
  return editor.transformControls?.object?.id ?? null
}

function resolveModelNameFromText(text = '', modelNames = []) {
  const src = String(text || '')
  const fileMatch = src.match(/([A-Za-z0-9_\-]+\.(?:glb|gltf|fbx))/i)
  if (fileMatch) {
    const needle = normDirectToken(fileMatch[1])
    const exact = modelNames.find((name) => normDirectToken(name) === needle)
    if (exact) return exact
  }

  const dense = normDirectToken(src)
  const entries = modelNames.map((name) => {
    const stem = String(name).replace(/\.[^.]+$/, '')
    return { name, nameNorm: normDirectToken(name), stemNorm: normDirectToken(stem) }
  })

  const byName = entries.find((e) => dense.includes(e.nameNorm))
  if (byName) return byName.name
  const byStem = entries.find((e) => e.stemNorm && dense.includes(e.stemNorm))
  if (byStem) return byStem.name

  for (const [k, v] of Object.entries(DIRECT_MODEL_ALIAS_MAP)) {
    if (!dense.includes(normDirectToken(k))) continue
    const aliasNorm = normDirectToken(v)
    const hit = entries.find((e) => e.nameNorm.includes(aliasNorm) || e.stemNorm.includes(aliasNorm))
    if (hit) return hit.name
  }

  return null
}

async function tryDirectIntentExecution(editor, userMessage, onStatus) {
  const text = String(userMessage || '').trim()
  if (!text) return null

  if (isQuestionLike(text) && !hasStrongDirectVerb(text)) return null

  const all = allSceneTools(editor)

  if (isPanelCommand(text)) {
    const panel = resolvePanelIntent(text)
    onStatus?.('正在打开面板...')
    const out = panel
      ? await all.openEditorPanel.execute({ panel, openMain: true })
      : await all.openEditorPanel.execute({})
    if (out?.error) return `打开面板失败：${out.error}`
    return panel ? `已打开「${panel}」面板。` : '已打开控制面板。'
  }

  if (/(撤销|undo)/i.test(text) && !/(重做|redo)/i.test(text)) {
    onStatus?.('正在撤销...')
    const out = await all.undoEditor.execute({})
    return out?.error ? `撤销失败：${out.error}` : '已撤销上一步操作。'
  }

  if (/(重做|redo)/i.test(text)) {
    onStatus?.('正在重做...')
    const out = await all.redoEditor.execute({})
    return out?.error ? `重做失败：${out.error}` : '已重做上一步操作。'
  }

  const transformMode = resolveTransformMode(text)
  if (transformMode) {
    onStatus?.('正在切换变换模式...')
    const out = await all.setEditorMode.execute({ handlerMode: 'transform', transformMode })
    if (out?.error) return `切换模式失败：${out.error}`
    const zh = transformMode === 'translate' ? '平移' : transformMode === 'rotate' ? '旋转' : '缩放'
    return `已切换到${zh}模式。`
  }

  if (isDeleteCommand(text)) {
    const id = resolveTargetObjectId(editor, text)
    if (id == null) return '未找到可删除目标。请先选中对象或给出 id。'
    onStatus?.('正在删除对象...')
    const out = await all.deleteObject.execute({ id })
    if (out?.error) return `删除失败：${out.error}`
    return `已删除对象 #${id}。`
  }

  if (isPlaceOnGroundCommand(text)) {
    const id = resolveTargetObjectId(editor, text)
    if (id == null) return '未找到可贴地目标。请先选中对象或给出 id。'
    onStatus?.('正在贴地...')
    const out = await all.placeOnGround.execute({ id })
    if (out?.error) return `贴地失败：${out.error}`
    const fc = await all.focusObject.execute({ id })
    if (fc?.error) return `已贴地，但聚焦失败：${fc.error}`
    return `已将对象 #${id} 贴地并对准视角。`
  }

  const wantsModel = isModelLoadCommand(text)
  const wantsShadow = isShadowCommand(text)
  const wantsFocus = isFocusCommand(text)
  if (!wantsModel && !wantsShadow && !wantsFocus) return null

  const notes = []
  let modelId = null

  if (wantsModel) {
    const modelNames = localModelNames()
    const modelName = resolveModelNameFromText(text, modelNames)

    if (!modelName) {
      if (!modelNames.length) return '已识别为加载模型请求，但当前模型库为空或未加载。'
      const sample = modelNames.slice(0, 8).join('、')
      return `已识别为加载模型请求，但未定位到具体模型名。请直接说模型名，例如：${sample}。`
    }

    onStatus?.('正在加载本地模型...')
    const out = await all.addModel.execute({
      urlOrName: modelName,
      position: [0, 0, 0],
      onGround: true,
      flyTo: true,
    })
    if (out?.error) return `加载模型失败：${out.error}`
    modelId = out?.object?.id ?? null
    notes.push(`已加载模型「${modelName}」`)
  }

  if (wantsShadow) {
    onStatus?.('正在开启阴影...')
    const out = enableSceneShadows(editor, {})
    if (out?.error) return `开启阴影失败：${out.error}`
    notes.push('已开启阴影并设置投射/接收')
  }

  if (wantsFocus || modelId != null) {
    onStatus?.('正在对准视角...')
    let out
    if (modelId != null) {
      out = await all.focusObject.execute({ id: modelId })
    } else if (editor.transformControls?.object?.id != null) {
      out = await all.focusObject.execute({ id: editor.transformControls.object.id })
    } else {
      out = await focusScene(editor)
    }
    if (out?.error) return `对准视角失败：${out.error}`
    notes.push(modelId != null ? '已对准新模型' : '已对准当前目标')
  }

  if (notes.length) return `${notes.join('，')}。`

  return null
}

function normalizeHistory(history = []) {
  const cap = Math.min(MAX_HISTORY, 8)
  const list = history
    .filter((m) => m.content?.trim() && !m.loading)
    .map((m) => ({
      role: m.placement === 'end' ? 'user' : 'assistant',
      content: compactContent(m.content, 420),
    }))
    .slice(-cap)

  const totalChars = list.reduce((sum, m) => sum + (m.content?.length || 0), 0)
  if (totalChars <= 2400) return list
  return list.slice(-6)
}

function resolveStepBudget(userMessage) {
  const text = String(userMessage || '')

  if (isPanelCommand(text) || /(撤销|重做|undo|redo)/i.test(text)) return 2
  if (isShadowCommand(text) || isFocusCommand(text)) return 2
  if (isModelLoadCommand(text)) return 3
  if (isDeleteCommand(text) || isPlaceOnGroundCommand(text) || resolveTransformMode(text)) return 2

  if (/方案|两套|对比|业务|品牌|叙事|架构|系统|重构|从零/.test(text)) {
    return Math.min(MAX_STEPS, 10)
  }
  if (/解释|原理|思路|为什么|分析|排查|诊断/.test(text) && !/加|改|删|创建|生成|设置|移动|旋转|缩放/.test(text)) {
    return 4
  }
  if (/改|设置|调整|移动|旋转|缩放|材质|贴图|灯光|阴影|投影|投射|背景|雾|环境|删除|替换|应用|加载|导入|引入|载入/.test(text)) {
    return Math.min(MAX_STEPS, 7)
  }
  if (/快速|立刻|马上|直接/.test(text)) return Math.min(MAX_STEPS, 4)
  return Math.min(MAX_STEPS, 6)
}

function mergeStreamText(current, chunk) {
  const next = String(chunk || '')
  if (!next) return current
  if (!current) return next
  if (next.startsWith(current)) return next
  if (current.endsWith(next)) return current

  const limit = Math.min(current.length, next.length)
  for (let i = limit; i > 0; i -= 1) {
    if (current.slice(-i) === next.slice(0, i)) {
      return current + next.slice(i)
    }
  }
  return current + next
}

function deriveIntentPolicy(userMessage = '') {
  const text = String(userMessage || '').trim()
  const dense = text.replace(/\s+/g, '')

  const hasAction = /(加|改|删|创建|生成|搭建|新建|设置|调整|移动|旋转|缩放|应用|切换|打开|关闭|启用|禁用|播放|暂停|导出|保存|撤销|重做|修复|解决|优化|美化|聚焦|对准|放大|缩小|删除|替换|修改|换成|变成|弄|加载|导入|引入|载入|接入|投影|投射|摆上|放上)/.test(dense)
  const hasCreateVerb = /(创建|生成|搭建|来个|做个|做一个|新建|添加|布置|搭一个|加载|导入|引入|载入|接入)/.test(dense)
  const hasCreativeDirective = /(自由发挥|自行发挥|发挥一下|你来发挥|你来定|你决定|看着来|随便搭|整一个|整一套|来一套|来个场景|搭个场景|搭一个场景|漂亮场景|好看场景)/.test(dense)
  const hasCreateTarget = /(场景|模型|物体|组件|灯光|mesh|地面|天空|环境|特效|动画|粒子|材质)/i.test(dense)
  const hasReadonlyDirective = /(只分析|只诊断|只回答|先分析|先别改|不要改|不修改|不改场景|别改场景)/.test(dense)
  const hasWriteDirective = /(直接改|直接修改|可以修改|开始修改|你来改|按你判断改|动手改|可以动手)/.test(dense)
  const hasNoCreateConstraint = /(不新增|不要新增|别新增|不添加|别加|只改现有|不要新建|不许新增)/.test(dense)
  const looksQuestion = /(为什么|怎么|如何|是什么|啥|有没有|能不能|可不可以|是否|是不是|哪里|哪儿|排查|分析|解释|\?|？)/.test(dense)
  const looksProblem = /(不对|有问题|问题|异常|报错|错误|失败|不生效|没反应|不工作|坏了|瞎工作)/.test(dense)
  const hasAdjustmentCue = /(太亮|太暗|太大|太小|太高|太低|太近|太远|偏左|偏右|偏上|偏下|单调|杂乱|看不清|不协调|不自然|不真实|发灰|刺眼|不高级|不够好看)/.test(dense)
  const isCreativeOrBusiness = hasCreativeDirective || /(自由发挥|你来定|方案|风格|品牌|业务|营销|产品|体验|叙事|高级感|质感|漂亮|好看|创意|转化|展厅|发布会|招商|工业|园区|文旅)/.test(dense)
  const allowQuickBuild = /(快速搭场景|立刻搭场景|马上搭场景|直接搭场景|示例场景|demo场景)/.test(dense)
  const hasPointer = /(这个|那个|这里|那里|它|截图|图片|图里|画面|这张图)/.test(dense)
  const hasSpecificTarget = /(id\s*[:：=]?\s*\d+|#\d+|球|立方体|平面|地面|灯|模型|对象|选中|当前|材质|颜色|阴影|背景|环境|着色器|动画)/.test(dense)
  const hasModelCue = /(\.glb|\.gltf|\.fbx|模型|model)/i.test(dense)
  const hasModelLoadIntent = hasModelCue && /(加载|导入|引入|载入|接入|加|添加|放|上|使用|换成|来个|来一|有吗|不是吗|能用|可用|可以用)/.test(dense)

  const inferredFix = (looksProblem || hasAdjustmentCue) && hasSpecificTarget
  let allowMutations = hasWriteDirective || hasAction || inferredFix || hasCreativeDirective
  if (hasReadonlyDirective && !hasWriteDirective) allowMutations = false

  let allowCreation = (hasCreateVerb && hasCreateTarget)
    || (allowMutations && /(优化|美化|丰富|升级|重做|重塑|焕新)/.test(dense) && !hasNoCreateConstraint)
    || (hasCreativeDirective && !hasNoCreateConstraint)
    || hasModelLoadIntent
  if (hasReadonlyDirective && !hasWriteDirective) allowCreation = false

  const ambiguousComplaint = (looksProblem || hasPointer) && !allowMutations && !allowCreation
  const needsClarify = ambiguousComplaint && !hasCreativeDirective && (dense.length <= 40 || !looksQuestion)

  return {
    allowMutations,
    allowCreation,
    needsClarify,
    readonly: hasReadonlyDirective && !hasWriteDirective,
    inferredFix,
    preferPlanFirst: isCreativeOrBusiness,
    allowQuickBuild,
  }
}

function boostIntentPolicyByScene(policy, live, userMessage = '') {
  if (!policy) return policy
  if (policy.readonly) return policy
  if (live?.ready && Number(live.count) > 0) return policy

  const dense = String(userMessage || '').replace(/\s+/g, '')
  const hasNoCreateConstraint = /(不新增|不要新增|别新增|不添加|别加|只改现有|不要新建|不许新增)/.test(dense)
  if (hasNoCreateConstraint) return policy

  const hasCreativeNeed = /(自由发挥|自行发挥|发挥一下|你来发挥|你来定|你决定|看着来|随便搭|整一个|整一套|来一套|搭个场景|搭一个场景|漂亮|好看|氛围|展示|场景)/.test(dense)
  if (!hasCreativeNeed) return policy

  return {
    ...policy,
    allowMutations: true,
    allowCreation: true,
    needsClarify: false,
    preferPlanFirst: true,
  }
}

function deriveBusinessContext(userMessage = '') {
  const text = String(userMessage || '').trim()
  const domain = BUSINESS_SCENARIOS.find(item => item.re.test(text))?.domain || '通用三维展示'
  const goals = BUSINESS_GOALS.filter(item => item.re.test(text))
  const hints = []

  if (/简洁|极简|清爽|干净/.test(text)) hints.push('控制对象数量，保持画面简洁')
  if (/科技|未来|赛博/.test(text)) hints.push('偏冷色和高对比边缘光，强调科技感')
  if (/真实|写实|电影/.test(text)) hints.push('优先 PBR 材质与层次光照，避免纯色生硬块')
  if (/性能|流畅|轻量/.test(text)) hints.push('控制对象和后处理开销，优先低成本方案')
  if (/不要新增|别新增|只改现有/.test(text)) hints.push('仅微调现有对象，不新增资源')

  return { domain, goals, hints }
}

function buildBusinessPrompt(ctx) {
  if (!ctx) return ''
  const lines = [`业务场景：${ctx.domain}`]

  if (ctx.goals.length) {
    lines.push('业务目标：')
    for (const goal of ctx.goals.slice(0, 3)) {
      lines.push(`- ${goal.goal}（验收：${goal.kpi}）`)
    }
  } else {
    lines.push('业务目标：在不破坏现有场景语义的前提下，优先提升可读性与视觉层级。')
  }

  if (ctx.hints.length) {
    lines.push(`执行提示：${ctx.hints.slice(0, 3).join('；')}`)
  }

  return lines.join('\n')
}

function buildCapabilityPrompt(editor) {
  const info = listEditorActions(editor)
  const modelNames = localModelNames()
  const modelPreview = modelNames.slice(0, 8)
  const unsupported = (info.actions || []).filter((a) => !a.supported).map((a) => a.name)
  const head = unsupported.slice(0, 8)
  return [
    `runEditorAction 能力：可用 ${info.available}/${info.total}`,
    head.length ? `当前不可用 action：${head.join(', ')}` : '当前 action 全部可用',
    modelNames.length
      ? `本地模型库(${modelNames.length})：${modelPreview.join(', ')}${modelNames.length > modelPreview.length ? ' ...' : ''}`
      : '本地模型库：未加载到可用模型',
    '原生优先：createMesh/setMaterial/setSceneProps/addNativeLight/setLightProps/applyTexture/lookAt/cloneObject',
  ].join('\n')
}

export function buildSystemPrompt(live, capabilityText = '', businessText = '', intentPolicy = null) {
  const scene = []
  if (live?.ready) {
    scene.push(`【当前场景】${live.count} 个对象，地面 Y=${live.groundY}`)
    if (live.shadowsOn === false) scene.push('阴影关')
    if (live.colors?.background) scene.push(`背景 ${live.colors.background}${live.colors.fog ? ` 雾 ${live.colors.fog}` : ''}`)
    if (live.selected) scene.push(`选中 ${live.selected.line}`)
    if (live.snapshot?.length) scene.push(`布局 ${live.snapshot.join(' | ')}`)
    if (live.hints?.length) scene.push(`提示 ${live.hints.join('；')}`)
  } else {
    scene.push('【当前场景】空或未加载')
  }

  const intentLine = intentPolicy?.readonly
    ? '用户要求只分析不改场景：本轮禁止一切写操作。'
    : '若用户是问题反馈但目标不清，先澄清再执行。'

  const businessBlock = businessText ? `\n业务理解：\n${businessText}` : ''

  return `你是用户的 Three.js 大师搭档，负责把视觉结果直接落到编辑器视口中。用户主要看视口，不看代码。\n\n${MASTER_THINKING}\n\n回复格式：\n${REPLY_FORMAT}\n\n${scene.join('。')}\n\n底层能力认知：\n${LIB_CAPABILITY_GUIDE}\n${capabilityText ? `\n${capabilityText}` : ''}${businessBlock}\n\n执行备忘（思考后再选用）：\n· 改物体：${EDIT_WORKFLOW}｜空间 ${SPATIAL_EDIT_GUIDE}｜色彩 ${COLOR_EDIT_GUIDE}｜Shader ${SHADER_EDIT_GUIDE}\n· 搭场景：仅“快速示例场景”才允许 buildScene；创意/业务任务禁止直接 buildScene\n· 创意/业务任务固定流程：inspectScene -> 给出简短方案 -> 执行 2~4 个原生/编辑器动作\n· 加组件：listResources({ label }) 了解 -> addComponent -> editObject；简单体块优先 addMesh\n· 加模型：先 listResources({ query }) 或 listResources() 找本地模型名，再 addModel({ urlOrName })；找不到就回报候选，不去外网检索\n· 若工具集中存在 addMesh/addModel/addComponent/addLight，禁止声称“没有添加物体工具”\n· 原生优先：createMesh/setMaterial/setSceneProps/addNativeLight/setLightProps/applyTexture/lookAt/cloneObject\n· 每次添加/大改后 focusCamera（无 objectId 则框选全场景），确保用户立刻看得见变化\n· 氛围：仅用户明确要求天空/背景/雾时才 setEnvironment；只说投影/阴影时只用 enableShadows\n· 执行型请求必须至少调用 1 个工具并落地结果，禁止只给建议或空口解释\n· ${intentLine}\n\n${safetyPromptAddon()}\n\n硬约束：Y 轴向上；不碰相机/GridHelper；不 loadScene/清缓存，除非用户明确确认。`
}

export const SCENE_SYSTEM = buildSystemPrompt({ ready: true, count: 0, groundY: 0, roles: {} })

function classifyAdvancedInvocation(name, input = {}) {
  if (!name) return { mutating: true, creating: false }

  if (name === 'runEditorAction') {
    const action = String(input?.action || '')
    if (!action) return { mutating: true, creating: false }
    return {
      mutating: !READONLY_EDITOR_ACTIONS.has(action),
      creating: CREATE_EDITOR_ACTIONS.has(action),
    }
  }

  return {
    mutating: !READONLY_ADVANCED_TOOLS.has(name) && name !== 'listEditorActions',
    creating: CREATE_ADVANCED_TOOLS.has(name),
  }
}

function getInvocationProfile(toolName, input = {}) {
  if (toolName === 'runAdvanced') {
    return classifyAdvancedInvocation(String(input?.tool || ''), input?.input || {})
  }
  return {
    mutating: MUTATING_TOOL_NAMES.has(toolName),
    creating: CREATE_TOOL_NAMES.has(toolName),
  }
}

function guardInvocationByIntent(policy, { toolName, input } = {}) {
  if (!policy) return null
  const advancedTool = toolName === 'runAdvanced' ? String(input?.tool || '') : ''
  const effectiveToolName = advancedTool || toolName

  if (effectiveToolName === 'buildScene' && policy.preferPlanFirst && !policy.allowQuickBuild) {
    return {
      error: '当前是创意/业务导向任务，已禁用模板化 buildScene。请先分析场景后用原生能力组合执行。',
      blocked: true,
      needClarify: false,
      hint: '建议流程：inspectScene -> listResources -> createMesh/setMaterial/addNativeLight/setSceneProps -> focusCamera',
    }
  }

  const profile = getInvocationProfile(toolName, input)

  if (profile.creating && !policy.allowCreation) {
    return {
      error: '当前描述未明确要求创建新对象或重建场景。为避免误生成，请先明确创建目标。',
      blocked: true,
      needClarify: true,
      hint: '示例：创建一个极简场景，只包含地面、主光和一个球体。',
    }
  }

  if (profile.mutating && !policy.allowMutations) {
    return {
      error: '当前描述更像在反馈问题或提问，未明确授权修改。为避免误操作，本次先不改场景。',
      blocked: true,
      needClarify: true,
      hint: '请补充：改哪个对象 + 改成什么效果。示例：把选中球体改为蓝色并开启阴影。',
    }
  }

  return null
}

function buildClarifyReply(live) {
  const selected = live?.selected
    ? `当前选中：#${live.selected.id} ${live.selected.name || '(未命名)'}`
    : '当前没有选中对象。'

  return [
    '我先暂停自动改场景，避免误操作。',
    selected,
    '你这条更像“反馈有问题”，但缺少可执行目标。',
    '请补充 2 项：',
    '1) 改哪个对象（id/名称/选中对象）',
    '2) 目标效果（位置/颜色/材质/灯光/动画）',
    '可直接这样说：只改选中球体，应用水波纹着色器，不新增任何对象。',
  ].join('\n')
}

function canUseSnapshot(editor) {
  return typeof editor?.saveSceneEdit === 'function' && typeof editor?.resetEditorStorage === 'function'
}

function takeSnapshot(editor) {
  if (!canUseSnapshot(editor)) return null
  try {
    return editor.saveSceneEdit()
  } catch {
    return null
  }
}

function rollbackSnapshot(editor, snapshot) {
  if (!snapshot || !canUseSnapshot(editor)) return false
  try {
    editor.resetEditorStorage(snapshot)
    return true
  } catch {
    return false
  }
}

async function withAtomic(editor, name, execute) {
  const snapshot = takeSnapshot(editor)
  try {
    const out = await execute()
    if (out?.error) {
      const reverted = rollbackSnapshot(editor, snapshot)
      return { ...out, reverted }
    }
    return out
  } catch (e) {
    const reverted = rollbackSnapshot(editor, snapshot)
    return {
      error: `操作失败（${name}）：${e?.message || String(e)}`,
      reverted,
    }
  }
}

function nearlyEq(a, b, tolerance = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= tolerance
}

function vecEq(a, b, tolerance = 0.02) {
  return Array.isArray(a)
    && Array.isArray(b)
    && a.length === 3
    && b.length === 3
    && nearlyEq(a[0], b[0], tolerance)
    && nearlyEq(a[1], b[1], tolerance)
    && nearlyEq(a[2], b[2], tolerance)
}

function buildEditVerification(input, afterObject) {
  const checks = []

  if (input.position) checks.push({ field: 'position', ok: vecEq(afterObject?.position, input.position) })
  if (input.rotation) checks.push({ field: 'rotation', ok: vecEq(afterObject?.rotation, input.rotation) })
  if (input.scale) checks.push({ field: 'scale', ok: vecEq(afterObject?.scale, input.scale) })
  if (input.name != null) checks.push({ field: 'name', ok: String(afterObject?.name || '') === String(input.name) })
  if (input.visible != null) checks.push({ field: 'visible', ok: !!afterObject?.visible === !!input.visible })

  if (input.color != null) {
    checks.push({
      field: 'color',
      ok: String(afterObject?.material?.color || '').toLowerCase() === String(input.color).toLowerCase(),
    })
  }

  if (input.opacity != null) {
    checks.push({ field: 'opacity', ok: nearlyEq(afterObject?.material?.opacity, input.opacity, 0.03) })
  }

  if (input.params && typeof input.params === 'object') {
    for (const k of Object.keys(input.params)) {
      checks.push({ field: `params.${k}`, ok: afterObject?.custom?.params?.[k] != null })
    }
  }

  if (input.uniforms && typeof input.uniforms === 'object') {
    for (const k of Object.keys(input.uniforms)) {
      checks.push({ field: `uniforms.${k}`, ok: afterObject?.custom?.uniforms?.[k] != null })
    }
  }

  const passed = checks.every((c) => c.ok)
  return {
    passed,
    total: checks.length,
    failed: checks.filter((c) => !c.ok).map((c) => c.field),
  }
}

function shouldAtomicAdvanced(toolName, input = {}) {
  if (!toolName) return false
  if (toolName === 'runEditorAction') {
    const action = input?.action
    return !!action && !READONLY_EDITOR_ACTIONS.has(action)
  }
  return !READONLY_ADVANCED_TOOLS.has(toolName)
}

function pickNativeToolsByText(text = '') {
  const dense = String(text || '').replace(/\s+/g, '')
  const out = new Set()

  if (/材质|pbr|金属|粗糙|线框|wireframe|透明|颜色/.test(dense)) out.add('setMaterial')
  if (/贴图|纹理|texture|normalmap|roughnessmap/i.test(dense)) out.add('applyTexture')
  if (/背景|雾|fog|environment|scene\.background/i.test(dense)) out.add('setSceneProps')
  if (/灯|光照|平行光|聚光|点光|shadow|阴影/i.test(dense)) {
    out.add('addNativeLight')
    out.add('setLightProps')
  }
  if (/克隆|复制|副本/.test(dense)) out.add('cloneObject')
  if (/朝向|看向|lookat/i.test(dense)) out.add('lookAt')
  if (/几何|mesh|geometry|原生|three/i.test(dense)) out.add('createMesh')

  if (/(three|threejs|three\.js|原生能力|原生工具)/i.test(dense)) {
    for (const name of TOOL_NATIVE_ORDER) out.add(name)
  }

  return out
}

function selectToolsForRequest(allTools, userMessage, intentPolicy) {
  const dense = String(userMessage || '').replace(/\s+/g, '')
  const wantsAdvanced = /(高级|runadvanced|runeditoraction|动作|action|导出|截图|json|glb|theatre|裁剪|像素比|render|renderer|shader|blend|instanced|lathe|tube|loadonline)/i.test(dense)
  const wantsPanel = isPanelCommand(dense)
  const wantsCreative = /(自由发挥|自行发挥|发挥一下|你来发挥|你来定|你决定|看着来|随便搭|整一个|整一套|来一套|搭个场景|搭一个场景|漂亮场景|好看场景)/.test(dense)
  const wantsHistory = /(撤销|重做|undo|redo)/i.test(dense)
  const wantsModel = /(模型|\.glb|\.gltf|\.fbx|model)/i.test(dense)
  const wantsCreate = /(加|添加|创建|生成|搭建|新建|加载|导入|引入|载入|接入|放上|摆上|来个|来一)/.test(dense)
  const wantsDelete = /(删|删除|移除|清掉)/.test(dense)
  const wantsGround = /(贴地|地面|落地|ground)/i.test(dense)
  const wantsShadow = /(阴影|投影|投射|shadow)/i.test(dense)
  const wantsEnv = /(天空|环境|背景|雾|fog|sky)/i.test(dense)
  const wantsMaterial = /(材质|贴图|纹理|颜色|pbr|metalness|roughness|wireframe|transparent)/i.test(dense)
  const wantsLight = /(灯|光照|光源|ambient|directional|spot|point)/i.test(dense)
  const wantsAnimation = /(动画|anim|播放|暂停)/i.test(dense)
  const wantsFocus = /(聚焦|对准|看向|看清|飞到|focus|frame)/i.test(dense)
  const wantsMesh = /(几何|mesh|立方体|球体|平面|圆柱|圆锥|圆环|二十面体|八面体|十二面体)/i.test(dense)
  const wantsResource = /(资源|组件|模型库|列表|查|搜索|有哪些|schema|目录|清单|list)/i.test(dense)

  if (wantsPanel) {
    const out = {}
    if (allTools.openPanel) out.openPanel = allTools.openPanel
    return out
  }

  const names = new Set(['inspectScene', 'getObject', 'editObject', 'focusCamera'])

  if (wantsResource || wantsCreate || wantsModel || wantsMesh) names.add('listResources')
  if (wantsCreative) {
    names.add('listResources')
    names.add('addModel')
    names.add('addMesh')
    names.add('addLight')
    names.add('addComponent')
    names.add('buildScene')
    names.add('setEnvironment')
    names.add('enableShadows')
    names.add('focusCamera')
  }
  if (wantsDelete) names.add('deleteObject')
  if (wantsGround) names.add('placeOnGround')
  if (wantsShadow) {
    names.add('enableShadows')
    names.add('addLight')
    names.add('addNativeLight')
    names.add('setLightProps')
  }
  if (wantsEnv) {
    names.add('setEnvironment')
    names.add('setSceneProps')
  }
  if (wantsMaterial) {
    names.add('setMaterial')
    names.add('applyTexture')
  }
  if (wantsMesh) {
    names.add('addMesh')
    names.add('createMesh')
  }
  if (wantsAnimation) names.add('playAnimation')
  if (wantsHistory) names.add('history')
  if (wantsFocus) names.add('focusCamera')

  if (intentPolicy?.allowCreation && wantsCreate) {
    if (wantsModel) names.add('addModel')
    if (wantsLight) names.add('addLight')
    if (wantsMesh || /几何|mesh/.test(dense)) names.add('addMesh')
    if (/组件|特效|图表|ui|css2d|css3d/.test(dense)) names.add('addComponent')
    if (/(示例|demo|场景|搭建|搭个|搭一个)/.test(dense)) names.add('buildScene')
  }

  if (!intentPolicy?.allowCreation) {
    for (const name of TOOL_CREATION_SET) names.delete(name)
    names.delete('buildScene')
  }
  if (intentPolicy?.preferPlanFirst && !intentPolicy?.allowQuickBuild) names.delete('buildScene')
  if (!wantsAnimation) names.delete('playAnimation')
  if (!wantsHistory) names.delete('history')

  const native = pickNativeToolsByText(dense)
  for (const name of native) names.add(name)

  const out = {}
  for (const name of names) {
    if (allTools[name]) out[name] = allTools[name]
  }
  if (!Object.keys(out).length && allTools.inspectScene) out.inspectScene = allTools.inspectScene
  if (wantsAdvanced && allTools.runAdvanced) out.runAdvanced = allTools.runAdvanced
  return out
}

export function createSceneTools(editor, { userMessage = '', intentPolicy } = {}) {
  const all = allSceneTools(editor)
  const withIntentGuard = (name, execute) => async (input = {}) => {
    const denied = guardInvocationByIntent(intentPolicy, { toolName: name, input })
    if (denied) return denied
    return execute(input)
  }

  const atomicForward = (name, toolObj, description) => mk(
    description || toolObj?.description || name,
    toolObj?.inputSchema || z.any(),
    withIntentGuard(name, (input) => withAtomic(editor, name, () => toolObj.execute(input))),
  )

  return {
    inspectScene: mk('大师先看场景：spatial/groundY/bounds/布局。改东西或不确定有什么时用', z.object({ id: z.number().optional(), name: z.string().optional() }), (input) => inspectScene(editor, { ...input, includeObjects: true })),
    listResources: mk('查资源/了解组件。label=查阅详情(解锁 addComponent)；query=搜索；无参=概览', z.object({
      label: z.string().optional().describe('精确组件名 — 查阅后可 addComponent'),
      query: z.string().optional().describe('模糊搜索，如 地面、粒子、图表'),
    }), (input) => listResources(editor, input || {})),
    openPanel: mk('打开编辑器配置面板：渲染配置/相机配置/轨道配置/变换配置/环境配置/后期处理；不传 panel 则打开控制板', z.object({
      panel: z.enum(PANEL_TOOL_OPTIONS).optional(),
    }), withIntentGuard('openPanel', ({ panel }) => {
      return all.openEditorPanel.execute(panel ? { panel, openMain: true } : {})
    })),
    getObject: mk('大师改前必读：bounds/custom/editHints/material——看清再动手', z.object({ id: z.number(), children: z.boolean().optional() }), ({ id, children }) => all.getDetail.execute({ id, children })),

    editObject: mk('精准修改：先 getObject；组件 params/uniforms，mesh color/material；改完应 focusCamera', z.object({
      id: z.number(),
      name: z.string().optional(),
      visible: z.boolean().optional(),
      position: vec3,
      rotation: vec3,
      scale: vec3,
      color: z.string().optional(),
      opacity: z.number().min(0).max(1).optional(),
      intensity: z.number().optional(),
      castShadow: z.boolean().optional(),
      receiveShadow: z.boolean().optional(),
      metalness: z.number().min(0).max(1).optional(),
      roughness: z.number().min(0).max(1).optional(),
      emissive: z.string().optional(),
      params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
      uniforms: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.array(z.number())])).optional(),
    }), withIntentGuard('editObject', async (input) => {
      return withAtomic(editor, 'editObject', async () => {
        const bad = validateEditInput(editor, input)
        if (bad) return bad

        const { id, params, uniforms, metalness, roughness, emissive, ...rest } = input
        let last

        if (params || uniforms) {
          last = await all.setObjectParams.execute({ id, params, uniforms })
          if (last?.error) return last
        }

        const mat = {
          metalness,
          roughness,
          emissive,
          color: rest.color,
          opacity: rest.opacity,
        }

        if (Object.values(mat).some((v) => v != null)) {
          last = await all.setMaterial.execute({ id, ...mat })
          if (last?.error) return last
          delete rest.color
          delete rest.opacity
        }

        if (Object.keys(rest).some((k) => k !== 'id' && rest[k] != null)) {
          last = await all.setProps.execute({ id, ...rest })
        }

        const out = last || { error: '没有可应用的修改' }
        if (out.error) return out

        const visual = params || uniforms || rest.position || rest.rotation || rest.scale
          || input.color != null || input.opacity != null || input.metalness != null
        if (visual) {
          const fc = await all.focusObject.execute({ id: input.id })
          if (fc?.focused != null) out.focused = true
        }

        const after = await all.getDetail.execute({ id: input.id })
        if (after?.object) out.verify = buildEditVerification(input, after.object)
        return out
      })
    })),

    addMesh: atomicForward('addMesh', all.addMesh, '添加基础几何体，支持颜色/名称/贴地/运镜'),
    addComponent: atomicForward('addComponent', all.addComponent, '添加组件（需先 listResources(label) 查阅）'),
    addModel: atomicForward('addModel', all.addModel, '加载编辑器本地模型（先 listResources 查 models），并可自动贴地/播放动画/运镜'),
    addLight: atomicForward('addLight', all.addLight, '添加灯光（可与 enableShadows 配合）'),
    createMesh: atomicForward('createMesh', all.createMesh, 'Three.js 原生建模：按几何类名创建 Mesh，支持 geometry/material 参数'),
    setMaterial: atomicForward('setMaterial', all.setMaterial, 'Three.js 原生材质：切换材质类型并修改 PBR 参数'),
    setSceneProps: atomicForward('setSceneProps', all.setSceneProps, 'Three.js 原生场景：修改 scene.background/fog'),
    addNativeLight: atomicForward('addNativeLight', all.addNativeLight, 'Three.js 原生灯光：按 API 类型创建灯光'),
    setLightProps: atomicForward('setLightProps', all.setLightProps, 'Three.js 原生灯光参数：target/angle/penumbra/shadowMap'),
    applyTexture: atomicForward('applyTexture', all.applyTexture, 'Three.js 原生贴图：远程纹理赋给 map/normalMap 等'),
    cloneObject: atomicForward('cloneObject', all.cloneObject, 'Three.js 原生克隆：深拷贝对象并保持可编辑'),
    lookAt: atomicForward('lookAt', all.lookAt, 'Three.js 原生朝向：让对象对准目标点/目标对象'),
    deleteObject: atomicForward('deleteObject', all.deleteObject, '删除对象并释放资源'),
    placeOnGround: atomicForward('placeOnGround', all.placeOnGround, '将对象底面对齐到地面高度'),

    setEnvironment: mk('仅 sky/env/background/fog。用户明确要求换天空/背景/雾才用；开阴影用 enableShadows', z.object({
      sky: z.string().optional(),
      env: z.string().optional(),
      background: z.string().nullable().optional(),
      fog: z.object({
        color: z.string().optional(),
        near: z.number().optional(),
        far: z.number().optional(),
      }).nullable().optional(),
    }), withIntentGuard('setEnvironment', ({ sky, env, background, fog }) => withAtomic(editor, 'setEnvironment', async () => {
      const out = {}
      if (sky) Object.assign(out, await all.setSky.execute({ name: sky }))
      if (env) Object.assign(out, await all.setEnv.execute({ name: env }))
      if (background !== undefined || fog !== undefined) {
        Object.assign(out, await all.setSceneProps.execute({ background, fog }))
      }
      return Object.keys(out).length ? out : { error: '请指定 sky/env/background/fog' }
    }))),

    enableShadows: mk('仅开阴影四要素，不改天空/背景/雾。用户要投影/阴影时用', z.object({
      castIds: z.array(z.number()).optional().describe('投射阴影的物体 id'),
      receiveIds: z.array(z.number()).optional().describe('接收阴影的地面 id'),
    }), withIntentGuard('enableShadows', (input) => withAtomic(editor, 'enableShadows', () => enableSceneShadows(editor, input || {})))),

    focusCamera: mk('对准物体或整个场景。objectId=单个物体；不传则框选全部物体', z.object({
      objectId: z.number().optional(),
      position: vec3req.optional(),
      target: vec3req.optional(),
    }), withIntentGuard('focusCamera', async ({ objectId, position, target }) => {
      if (objectId != null) return all.focusObject.execute({ id: objectId })
      if (position && target) return all.focusView.execute({ position, target })
      return focusScene(editor)
    })),

    playAnimation: atomicForward('playAnimation', all.playAnimation, '播放模型动画'),

    history: mk('undo 撤销 / redo 重做', z.object({ action: z.enum(['undo', 'redo']) }), withIntentGuard('history', ({ action }) => (
      action === 'undo' ? all.undoEditor.execute({}) : all.redoEditor.execute({})
    ))),

    buildScene: mk('用户要好看/示例场景时用。大师式精简构图+阴影+对准主体，不堆元素', z.object({
      palette: z.string().optional().describe('黄昏暖调|森林清晨|海洋暮色|极简中性|霓虹赛博'),
    }), withIntentGuard('buildScene', ({ palette }) => withAtomic(editor, 'buildScene', () => buildScene(editor, { palette })))),

    runAdvanced: mk('高级：runAdvanced({ tool, input })。tool 白名单见 listResources.advancedTools', z.object({
      tool: z.string().refine((name) => ADVANCED_TOOL_NAME_SET.has(name), {
        message: `tool 不在白名单：${ADVANCED_TOOL_WHITELIST.join(', ')}`,
      }),
      input: z.record(z.string(), z.unknown()).optional(),
    }), withIntentGuard('runAdvanced', ({ tool: name, input = {} }) => {
      if (CURATED.has(name)) return { error: `请直接用「${name}」工具` }
      if (name === 'openEditorPanel') return { error: '请直接用「openPanel」工具' }
      if (name === 'undoEditor' || name === 'redoEditor') return { error: '请直接用「history」工具' }

      const denied = guardAdvancedInvocation({ userMessage, toolName: name, input })
      if (denied) return denied

      const run = async () => {
        if (name === 'runEditorAction') {
          return runEditorAction(editor, { action: input.action, params: input.params || {} })
        }
        if (name === 'listEditorActions') return listEditorActions(editor)

        const t = all[name]
        if (!t?.execute) return { error: `未知工具「${name}」`, hint: ADVANCED_HINT }
        return t.execute(input)
      }

      if (!shouldAtomicAdvanced(name, input)) return run()
      return withAtomic(editor, `runAdvanced:${name}`, run)
    })),
  }
}

export async function runSceneAi({
  editor,
  userMessage,
  history,
  config,
  onText,
  onStatus,
  signal,
}) {
  const direct = await tryDirectIntentExecution(editor, userMessage, onStatus)
  if (direct) {
    onText?.(direct)
    return direct
  }

  const live = getLiveContext(editor)
  const intentPolicy = boostIntentPolicyByScene(deriveIntentPolicy(userMessage), live, userMessage)
  const businessContext = deriveBusinessContext(userMessage)

  if (intentPolicy.needsClarify) {
    const clarify = buildClarifyReply(live)
    onStatus?.('等待你确认修改目标...')
    onText?.(clarify)
    return clarify
  }

  const provider = createAnthropic({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  })

  const messages = normalizeHistory(history)
  const capabilityText = buildCapabilityPrompt(editor)
  const businessText = buildBusinessPrompt(businessContext)
  const system = buildSystemPrompt(live, capabilityText, businessText, intentPolicy)
  const allTools = createSceneTools(editor, { userMessage, intentPolicy })
  const tools = selectToolsForRequest(allTools, userMessage, intentPolicy)

  onStatus?.(`思考中...（本轮 ${Object.keys(tools).length} 个工具）`)

  const result = streamText({
    model: provider(config.model),
    system,
    messages: [...messages, { role: 'user', content: userMessage }],
    tools,
    stopWhen: stepCountIs(resolveStepBudget(userMessage)),
    abortSignal: signal,
  })

  let draft = ''
  const toolSteps = []

  try {
    for await (const part of result.fullStream) {
      if (signal?.aborted) break

      if (part.type === 'tool-call') {
        const label = TOOL_STATUS[part.toolName] || part.toolName
        toolSteps.push(label)
        onStatus?.(`${label}...`)
      }

      if (part.type === 'text-delta') {
        const chunk = part.text ?? part.delta ?? ''
        if (!chunk) continue
        draft = mergeStreamText(draft, chunk)
        onText?.(draft)
      }
    }

    if (signal?.aborted) return draft || '已停止。'

    let final = (await result.text)?.trim() || draft || (toolSteps.length ? '已执行操作。' : '好了。')
    if (toolSteps.length && !/（已执行|已执行：）/.test(final)) {
      final = `${final}\n\n（已执行：${toolSteps.join(' -> ')}）`
    }

    onText?.(final)
    return final
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') return draft || '已停止。'
    throw e
  }
}
