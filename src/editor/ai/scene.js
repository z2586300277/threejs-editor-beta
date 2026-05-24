import { tool } from 'ai'
import { z } from 'zod/v4'
import * as THREE from 'three'
import { ThreeEditor, getObjectViews, createGsapAnimation } from '../lib'

const SKIP = new Set(['PerspectiveCamera', 'AxesHelper', 'GridHelper', 'Box3Helper'])
const LIGHT_TYPES = ['环境光', '平行光', '点光源', '聚光灯', '半球光', '平面光']
const SKIES = [
  { name: '蓝天', url: 'https://z2586300277.github.io/three-editor/dist/files/scene/skyBox0/' },
  { name: '晴天', url: 'https://z2586300277.github.io/3d-file-server/files/sky/skyBox1/' },
  { name: '森林', url: 'https://z2586300277.github.io/three-editor/dist/files/scene/skyBox8/' },
  { name: '清除', url: '' },
]
const scenePath = (v) => (__isProduction__ ? '/threejs-editor-beta/' : '/') + v
const r = (n) => +n.toFixed(2)
const v3 = (v) => [r(v.x), r(v.y), r(v.z)]

function find(scene, id) {
  let o = null
  scene.traverse(x => { if (x.id === id) o = x })
  return o
}

function isObj(o) {
  return o && !o.isHelper && !o.isTransformControlsRoot && !SKIP.has(o.type)
}

function brief(o) {
  return { id: o.id, name: o.name || '(未命名)', type: o.designType || o.type, visible: o.visible, position: v3(o.position) }
}

function detail(o) {
  const d = { ...brief(o), rotation: v3({ x: o.rotation.x * 57.2958, y: o.rotation.y * 57.2958, z: o.rotation.z * 57.2958 }), scale: v3(o.scale) }
  o.traverse?.(c => {
    if (d.material || !c.isMesh?.material) return
    const m = Array.isArray(c.material) ? c.material[0] : c.material
    if (m?.color) d.material = { color: `#${m.color.getHexString()}`, opacity: r(m.opacity ?? 1) }
  })
  if (o.isLight) d.light = { intensity: r(o.intensity ?? 1), color: o.color ? `#${o.color.getHexString()}` : undefined }
  return d
}

function listModels() {
  return (window.models || []).map(url => ({ name: url.split('/').pop(), url }))
}

function listScenes() {
  return (window.editorJsons || []).map(v => ({ name: v.split('/').pop().replace('.json', ''), path: scenePath(v) }))
}

function resolveModelUrl(urlOrName) {
  if (urlOrName.startsWith('http')) return urlOrName
  const m = (window.models || []).find(u => u.includes(urlOrName) || u.split('/').pop() === urlOrName)
  return m || null
}

function setProps(editor, { id, name, visible, position, rotation, scale, color, opacity, intensity }) {
  const obj = find(editor.scene, id)
  if (!obj) return { error: `未找到 id=${id}` }
  if (name != null) obj.name = name
  if (visible != null) obj.visible = visible
  if (position) obj.position.set(...position)
  if (rotation) obj.rotation.set(...rotation.map(d => d * Math.PI / 180))
  if (scale) obj.scale.set(...scale)
  if (intensity != null && obj.isLight) obj.intensity = intensity
  const hex = color?.startsWith('#') ? color : color ? `#${color}` : null
  if (hex && obj.isLight?.color) obj.color.set(hex)
  if (hex || opacity != null) {
    obj.traverse?.(c => {
      if (!c.isMesh?.material) return
      ;[].concat(c.material).forEach(m => {
        if (hex && m.color) m.color.set(hex)
        if (opacity != null) { m.opacity = opacity; m.transparent = opacity < 1 }
        m.needsUpdate = true
      })
    })
  }
  editor.transformControls.attach(obj)
  return { object: detail(obj) }
}

function selectObject(editor, id) {
  const obj = find(editor.scene, id)
  if (!obj) return { error: `未找到 id=${id}` }
  editor.transformControls.attach(obj)
  return { id, name: obj.name || '(未命名)', selected: true }
}

function deleteObject(editor, id) {
  const obj = find(editor.scene, id)
  if (!obj) return { error: `未找到 id=${id}` }
  if (editor.transformControls.object?.id === id) editor.transformControls.detach()
  editor.scene.remove(obj)
  return { deleted: id, name: obj.name || '(未命名)' }
}

function addLight(editor, type, position = [0, 5, 0]) {
  const map = {
    '环境光': () => new THREE.AmbientLight(0xffffff, 1),
    '平行光': () => new THREE.DirectionalLight(0xffffff, 1),
    '点光源': () => new THREE.PointLight(0xffffff, 1, 0, 0),
    '聚光灯': () => new THREE.SpotLight(0xffffff, 1, 0, Math.PI / 6, 0, 0),
    '半球光': () => new THREE.HemisphereLight(0xffffff, 0x000000, 1),
    '平面光': () => new THREE.RectAreaLight(0xffffff, 1, 100, 100),
  }
  const fn = map[type]
  if (!fn) return { error: `未知灯光「${type}」`, types: LIGHT_TYPES }
  const light = fn()
  if (light.target) editor.scene.add(light.target)
  light.editorType = 'isLight'
  light.name = type
  light.position.set(...position)
  editor.scene.add(light)
  editor.transformControls.attach(light)
  return { object: detail(light) }
}

async function addComponent(editor, label, position, flyTo = false) {
  const design = ThreeEditor.__DESIGNS__.find(d => d.label === label || d.name === label)
  if (!design) return { error: `未找到组件「${label}」`, components: ThreeEditor.__DESIGNS__.map(d => d.label) }
  const mesh = await design.create(null, editor, editor)
  if (!mesh) return { error: '组件创建失败' }
  mesh.editorType = 'isDesignMesh'
  mesh.designType = design.name
  editor.scene.add(mesh)
  mesh.position.set(...position)
  editor.transformControls.attach(mesh)
  if (flyTo) await flyToObject(editor, mesh, 0.3)
  return { object: detail(mesh) }
}

function addModel(editor, urlOrName, position = [0, 0, 0], flyTo = true) {
  const url = resolveModelUrl(urlOrName)
  if (!url) return { error: `未找到模型「${urlOrName}」`, models: listModels().map(m => m.name) }
  return new Promise(resolve => {
    const { loaderService } = editor.modelCores.loadModel(url)
    loaderService.complete = async model => {
      model.position.set(...position)
      editor.transformControls.attach(model)
      if (flyTo) await flyToObject(editor, model, 0.3)
      resolve({ object: detail(model), url })
    }
  })
}

async function loadScene(editor, nameOrPath) {
  let path = nameOrPath
  if (!nameOrPath.includes('/')) {
    const item = (window.editorJsons || []).find(v => v.includes(nameOrPath))
    if (!item) return { error: `未找到场景「${nameOrPath}」`, scenes: listScenes().map(s => s.name) }
    path = scenePath(item)
  }
  const data = await fetch(path).then(res => res.json())
  editor.resetEditorStorage(data)
  return { loaded: path.split('/').pop(), objects: listObjects(editor) }
}

async function flyToObject(editor, obj, duration = 0.5) {
  const { maxView, target } = getObjectViews(obj)
  if (maxView?.x == null) return
  await Promise.all([
    createGsapAnimation(editor.camera.position, maxView, { duration }),
    createGsapAnimation(editor.controls.target, target, { duration }),
  ])
}

async function focusObject(editor, id, duration = 0.5) {
  const obj = find(editor.scene, id)
  if (!obj) return { error: `未找到 id=${id}` }
  editor.transformControls.attach(obj)
  await flyToObject(editor, obj, duration)
  return { id, name: obj.name || '(未命名)', focused: true }
}

async function focusView(editor, position, target, duration = 0.5) {
  await Promise.all([
    createGsapAnimation(editor.camera.position, { x: position[0], y: position[1], z: position[2] }, { duration }),
    createGsapAnimation(editor.controls.target, { x: target[0], y: target[1], z: target[2] }, { duration }),
  ])
  return { focused: true, position, target }
}

function setSky(editor, name) {
  const set = SKIES.find(s => s.name === name)
  if (!set) return { error: '未知天空盒', names: SKIES.map(s => s.name) }
  if (!set.url) { editor.scene.background = null; return { sky: name } }
  editor.scene.setSceneBackground(Array.from({ length: 6 }, (_, i) => `${set.url}${i + 1}.png`))
  return { sky: name }
}

function setEnv(editor, name) {
  const set = SKIES.find(s => s.name === name && s.url)
  if (!set) return { error: '未知环境贴图', names: SKIES.filter(s => s.url).map(s => s.name) }
  editor.scene.setEnvBackground(Array.from({ length: 6 }, (_, i) => `${set.url}${i + 1}.png`))
  editor.scene.environmentEnabled = true
  return { env: name }
}

function setHelpers(editor, grid, axes) {
  if (grid != null) editor.handler.helpers.grid.showGrid = grid
  if (axes != null) editor.handler.helpers.axes.showAxes = axes
  return { grid: editor.handler.helpers.grid.showGrid, axes: editor.handler.helpers.axes.showAxes }
}

export const SCENE_SYSTEM = `你是 Three.js 场景编辑助手。操作前先 listObjects / listModels / listComponents 等查可用项，用 id 或名称指定目标，不要猜。
读：listObjects, getDetail, getCamera, listModels, listComponents, listLights, listScenes, listSkies
改：setProps(含灯光 intensity), deleteObject
加：addModel, addComponent, addLight
视角：selectObject, focusObject, focusView
场景：loadScene(会替换当前场景), setSky, setEnv, setHelpers
坐标 [x,y,z]，rotation 为度，颜色 "#ff0000"。`

const vec3 = z.tuple([z.number(), z.number(), z.number()]).optional()
const vec3req = z.tuple([z.number(), z.number(), z.number()])

export function listObjects(editor) {
  return editor.scene.children.filter(isObj).map(brief)
}

export function createSceneTools(editor) {
  return {
    listObjects: tool({
      description: '列出场景顶层对象',
      inputSchema: z.object({}),
      execute: () => ({ selectedId: editor.transformControls.object?.id ?? null, objects: listObjects(editor) }),
    }),
    getDetail: tool({
      description: '获取对象完整属性',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => {
        const o = find(editor.scene, id)
        return o ? { object: detail(o) } : { error: `未找到 id=${id}` }
      },
    }),
    getCamera: tool({
      description: '获取当前相机位置和观察目标',
      inputSchema: z.object({}),
      execute: () => ({ position: v3(editor.camera.position), target: v3(editor.controls.target) }),
    }),
    setProps: tool({
      description: '修改对象属性（含灯光 intensity）',
      inputSchema: z.object({
        id: z.number(), name: z.string().optional(), visible: z.boolean().optional(),
        position: vec3, rotation: vec3, scale: vec3,
        color: z.string().optional(), opacity: z.number().min(0).max(1).optional(),
        intensity: z.number().optional().describe('灯光强度'),
      }),
      execute: (input) => setProps(editor, input),
    }),
    selectObject: tool({
      description: '选中对象，不移动相机',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => selectObject(editor, id),
    }),
    deleteObject: tool({
      description: '从场景删除对象',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => deleteObject(editor, id),
    }),
    listModels: tool({
      description: '列出可加载的 GLB/FBX 模型',
      inputSchema: z.object({}),
      execute: () => ({ models: listModels() }),
    }),
    addModel: tool({
      description: '加载模型到场景，url 或文件名均可',
      inputSchema: z.object({
        urlOrName: z.string().describe('模型 URL 或文件名，来自 listModels'),
        position: vec3.describe('位置，默认 [0,0,0]'),
        flyTo: z.boolean().optional().describe('加载后飞过去，默认 true'),
      }),
      execute: ({ urlOrName, position, flyTo }) => addModel(editor, urlOrName, position ?? [0, 0, 0], flyTo !== false),
    }),
    listComponents: tool({
      description: '列出可添加的组件',
      inputSchema: z.object({}),
      execute: () => ({ components: ThreeEditor.__DESIGNS__.map(d => d.label) }),
    }),
    addComponent: tool({
      description: '在坐标处添加组件',
      inputSchema: z.object({
        label: z.string(), position: vec3req, flyTo: z.boolean().optional(),
      }),
      execute: ({ label, position, flyTo }) => addComponent(editor, label, position, !!flyTo),
    }),
    listLights: tool({
      description: '列出可添加的灯光类型',
      inputSchema: z.object({}),
      execute: () => ({ types: LIGHT_TYPES }),
    }),
    addLight: tool({
      description: '添加灯光',
      inputSchema: z.object({
        type: z.enum(LIGHT_TYPES), position: vec3.describe('默认 [0,5,0]'),
      }),
      execute: ({ type, position }) => addLight(editor, type, position ?? [0, 5, 0]),
    }),
    listScenes: tool({
      description: '列出可加载的配置案例场景',
      inputSchema: z.object({}),
      execute: () => ({ scenes: listScenes() }),
    }),
    loadScene: tool({
      description: '加载配置案例（会替换当前场景内容）',
      inputSchema: z.object({ name: z.string().describe('场景名，来自 listScenes') }),
      execute: ({ name }) => loadScene(editor, name),
    }),
    listSkies: tool({
      description: '列出天空盒/环境贴图选项',
      inputSchema: z.object({}),
      execute: () => ({ skies: SKIES.map(s => s.name) }),
    }),
    setSky: tool({
      description: '设置天空盒背景',
      inputSchema: z.object({ name: z.string().describe('来自 listSkies') }),
      execute: ({ name }) => setSky(editor, name),
    }),
    setEnv: tool({
      description: '设置环境反射贴图',
      inputSchema: z.object({ name: z.string().describe('蓝天/晴天/森林') }),
      execute: ({ name }) => setEnv(editor, name),
    }),
    setHelpers: tool({
      description: '显示/隐藏网格和坐标轴',
      inputSchema: z.object({ grid: z.boolean().optional(), axes: z.boolean().optional() }),
      execute: ({ grid, axes }) => setHelpers(editor, grid, axes),
    }),
    focusObject: tool({
      description: '选中并飞过去',
      inputSchema: z.object({ id: z.number(), duration: z.number().min(0.1).max(5).optional() }),
      execute: ({ id, duration }) => focusObject(editor, id, duration ?? 0.5),
    }),
    focusView: tool({
      description: '相机飞到指定位置和目标',
      inputSchema: z.object({
        position: vec3req, target: vec3req, duration: z.number().min(0.1).max(5).optional(),
      }),
      execute: ({ position, target, duration }) => focusView(editor, position, target, duration ?? 0.5),
    }),
  }
}
