import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { CORES_LIST, ThreeEditor, createGsapAnimation, createSpriteText, getObjectViews, setGsapMeshAction } from '../lib'
const OTHER_PANELS = ['编辑动画', '视角动画', '变换动画', '裁剪场景']
const animJsonPath = (v) => (__isProduction__ ? '/threejs-editor-beta/' : '/') + v
const LIGHT_ZH = {
  '环境光': 'AmbientLight', '平行光': 'DirectionalLight', '点光源': 'PointLight',
  '聚光灯': 'SpotLight', '半球光': 'HemisphereLight', '平面光': 'RectAreaLight',
}
const PROTECTED = new Set(['PerspectiveCamera', 'OrthographicCamera', 'AxesHelper', 'GridHelper', 'Box3Helper'])
const MAX_POS = 1e5
const MIN_SCALE = 0.001
const MAX_SCALE = 1e3
const MAX_DRAW_POINTS = 500
const HANDLER_MODES = new Set(['transform', 'select', 'none'])
const TRANSFORM_MODES = new Set(['translate', 'rotate', 'scale'])

function fin(n, fb = 0) {
  const x = Number(n)
  return Number.isFinite(x) ? x : fb
}

function clampN(n, lo, hi) {
  return Math.min(Math.max(fin(n, lo), lo), hi)
}

function safeVec3(arr, lo = -MAX_POS, hi = MAX_POS) {
  if (!Array.isArray(arr) || arr.length !== 3) return null
  return arr.map(v => clampN(v, lo, hi))
}

function safeHex(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return clampN(Math.floor(v), 0, 0xffffff)
  if (typeof v === 'string' && v.startsWith('#')) {
    const n = parseInt(v.slice(1), 16)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function isProtected(o) {
  return !o || o.isTransformControlsRoot || o.isHelper || PROTECTED.has(o.type) || o.isCamera
}

function find(scene, id) {
  if (!scene || id == null) return null
  return scene.getObjectById(id) ?? null
}

function findEditable(scene, id) {
  const obj = find(scene, id)
  if (!obj) return { error: `未找到 id=${id}` }
  if (isProtected(obj)) return { error: `id=${id} 为受保护对象，不可操作` }
  return { obj }
}

function resolveClass(name, fallback) {
  const Cls = THREE[name]
  return typeof Cls === 'function' ? Cls : fallback
}

function attachAdd(editor, obj) {
  const scene = editor?.scene
  if (!scene || !obj) return
  if (obj.parent === scene) {
    editor.transformControls?.attach?.(obj)
    return
  }
  if (scene.attach_add) scene.attach_add(obj)
  else {
    scene.add(obj)
    editor.transformControls?.attach?.(obj)
  }
}

function getTransformInfo(mesh) {
  return {
    position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
    scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
  }
}

function createCoreLight(type, { color = 0xffffff, intensity = 1 } = {}) {
  switch (type) {
    case 'AmbientLight': return new THREE.AmbientLight(color, intensity)
    case 'DirectionalLight': return new THREE.DirectionalLight(color, intensity)
    case 'PointLight': return new THREE.PointLight(color, intensity, 0, 0)
    case 'SpotLight': return new THREE.SpotLight(color, intensity, 0, Math.PI / 3, 0, 0)
    case 'HemisphereLight': return new THREE.HemisphereLight(color, 0x000000, intensity)
    case 'RectAreaLight': return new THREE.RectAreaLight(color, intensity, 100, 100)
    default: return null
  }
}

function resolveLightType(editor, type) {
  const lc = editor.lightCores
  if (!type && lc?.type) return lc.type
  if (lc?.list?.[type]) return lc.list[type]
  if (LIGHT_ZH[type]) return LIGHT_ZH[type]
  return type
}

function editorArgs(editor) {
  return {
    scene: editor.scene,
    camera: editor.camera,
    renderer: editor.renderer,
    controls: editor.controls,
    transformControls: editor.transformControls,
    effectComposer: editor.effectComposer,
    css3DRender: editor.css3DRender,
    css2DRender: editor.css2DRender,
    DOM: editor.DOM,
  }
}

function editorCores(editor) {
  const c = {}
  for (const k of ['shaderCores', 'handler', 'other', 'modelCores', 'innerCores', 'drawCores', 'textCores', 'particleCores', 'designCores', 'lightCores', 'geoCores']) {
    if (editor[k]) c[k] = editor[k]
  }
  return c
}

function loadSceneList() {
  try {
    return JSON.parse(localStorage.getItem('new_sceneList') || '[]')
  } catch {
    return []
  }
}

function saveSceneList(list) {
  localStorage.setItem('new_sceneList', JSON.stringify(list))
}

export const EDITOR_ACTIONS = {
  openCorePanel: {
    desc: '打开控制板「核心」子面板 GUI（文字物体/绘制物体/粒子物体/模型等）',
    params: { panel: 'CORES_LIST.label 或 name，如 textCores / 文字物体' },
  },
  openOtherPanel: {
    desc: '打开控制板「其他」子面板：编辑动画/视角动画/变换动画/裁剪场景',
    params: { panel: '编辑动画|视角动画|变换动画|裁剪场景' },
  },
  addText3D: {
    desc: '添加 3D 文字（等同核心→文字物体→添加）',
    params: { text: 'string', fontLink: 'optional url', materialType: 'optional', position: '[x,y,z]' },
  },
  addParticleSystem: {
    desc: '添加粒子系统（等同核心→粒子物体）',
    params: { particlesSum: 'number', inner: 'number', outer: 'number', mapUrl: 'optional url', size: 'optional' },
  },
  addDrawLine: {
    desc: '用绘制核心「直线」模式从点列创建 Line2',
    params: { points: '[[x,y,z],...]', lineWidth: 'optional' },
  },
  deselectAll: { desc: '取消选中并清除轮廓高亮', params: {} },
  setOutlineSelection: { desc: '设置 outlinePass 高亮对象', params: { ids: 'number[]' } },
  nudgeTransform: { desc: '微调位移(Q/W/E/A/S/D 等价)', params: { id: 'number', dx: 'number', dy: 'number', dz: 'number' } },
  rotateObject90: { desc: '绕轴旋转 90°(Shift+X/Y/Z 等价)', params: { id: 'number', axis: 'x|y|z', sign: '1|-1 optional' } },
  addCss2dLabel: { desc: '在场景中添加 CSS2D 标签', params: { html: 'string', position: '[x,y,z]' } },
  addCss3dElement: { desc: '在场景中添加 CSS3D DOM', params: { html: 'string', position: '[x,y,z]' } },
  saveViewAngle: { desc: '记录当前相机视角到 viewAngleList', params: { name: 'string' } },
  flyToViewAngle: { desc: '飞到已记录视角', params: { index: 'number' } },
  listViewAngles: { desc: '列出已记录视角', params: {} },
  listClippingPlanes: { desc: '列出 renderer 裁剪面', params: {} },
  addClippingPlane: { desc: '添加裁剪面', params: { normal: '[x,y,z]', constant: 'number' } },
  clearClippingPlanes: { desc: '清除所有裁剪面', params: {} },
  getSceneStats: { desc: '物体/顶点/三角面统计', params: {} },
  switchScene: { desc: '切换 localStorage 场景槽并 resetEditorStorage', params: { name: 'string' } },
  createSceneSlot: { desc: '新建场景槽', params: { name: 'string' } },
  deleteSceneSlot: { desc: '删除场景槽', params: { name: 'string' } },
  setPixelRatio: { desc: '设置像素比并刷新页面', params: { ratio: '0.5-3' } },
  setLogDepthBuffer: { desc: '对数深度缓冲并刷新', params: { enabled: 'boolean' } },
  getShareLink: { desc: '获取分享链接', params: { sceneName: 'optional' } },
  loadOnlineModel: { desc: 'modelCores.loadModel + attach_add（等同核心→模型管理）', params: { url: 'string', position: '[x,y,z] optional', flyTo: 'boolean optional' } },
  addInnerMesh: { desc: '内置物体（等同 innerCores→添加，默认 scale×10）', params: { geometryType: 'BoxGeometry 等', materialType: 'optional', position: '[x,y,z]', scale: 'number optional' } },
  addCoreLight: { desc: '添加光源并 attach_add（等同 lightCores）', params: { type: 'AmbientLight|平行光|...', position: '[x,y,z]', color: 'hex optional', intensity: 'number optional' } },
  applyBlendShader: { desc: '混合着色器（等同对象→着色配置）', params: { id: 'number', shaderName: '如 水波纹', uvType: 'material|world optional' } },
  listBlendShaders: { desc: '列出可用混合着色器名', params: {} },
  setSceneSkybox: { desc: '六面 skybox（baseUrl/1.png..6.png）或 clear', params: { baseUrl: 'string optional', clear: 'boolean optional' } },
  setSceneEnvironment: { desc: '环境贴图 IBL', params: { baseUrl: 'string', enabled: 'boolean optional' } },
  animateMeshTransform: { desc: 'GSAP 变换动画（等同其他→变换动画）', params: { id: 'number', position: '[x,y,z]', rotation: '[x,y,z]', scale: '[x,y,z]', duration: 'optional', mode: 'to|from optional' } },
  addSpriteLabel: { desc: 'Sprite 文字标签（createSpriteText）', params: { text: 'string', position: '[x,y,z]', color: 'optional', fontSize: 'optional' } },
  playCoreModelAnimation: { desc: 'modelCores.modelAnimationPlay', params: { id: 'number', initPlay: 'boolean', speed: 'number', loop: 'boolean' } },
  setHandlerOptions: { desc: 'handler.mode / transformControls.mode', params: { mode: 'transform|select|none', transformMode: 'translate|rotate|scale', openKeyEnable: 'boolean optional' } },
  setPreview: { desc: '预览模式(handler.mode=none)，不控制侧栏折叠', params: { enabled: 'boolean' } },
  applyTheatreAnimation: { desc: '应用 Theatre 时间线 JSON（会 reload）', params: { urlOrName: 'string' } },
  clearTheatreAnimation: { desc: '清除 Theatre 动画（会 reload）', params: {} },
  controlTheatreSheet: { desc: '控制 Theatre sheet 播放', params: { index: 'number', action: 'play|pause|reset' } },
  clearEditorCache: { desc: '清理 localStorage/IndexDB 并刷新（危险，需 confirm:true）', params: { confirm: 'boolean 必须为 true' } },
}

export function listEditorActions() {
  const cores = CORES_LIST.map(c => ({ name: c.name, label: c.label }))
  return {
    total: Object.keys(EDITOR_ACTIONS).length,
    actions: Object.entries(EDITOR_ACTIONS).map(([name, meta]) => ({ name, desc: meta.desc, params: meta.params })),
    cores,
    otherPanels: OTHER_PANELS,
    hint: '专用工具优先；其余 runEditorAction。模型/内置/灯光/着色器优先 addInnerMesh/addCoreLight/applyBlendShader/loadOnlineModel（走 attach_add）',
  }
}

function openCorePanel(editor, { panel }) {
  if (!editor.GUI) return { error: 'GUI 未就绪' }
  if (editor.GUI.children.length <= 1) editor.openControlPanel?.()
  const core = CORES_LIST.find(c => c.name === panel || c.label === panel)
  if (!core?.createPanel) return { error: `未知 core「${panel}」`, cores: CORES_LIST.map(c => c.label) }
  try {
    core.createPanel(editor.GUI.addDragFolder(core.label), editorArgs(editor), editorCores(editor))
    return { opened: core.label, core: core.name }
  } catch (e) {
    return { error: `打开 core 面板失败: ${e?.message || String(e)}` }
  }
}

function openOtherPanel(editor, { panel }) {
  if (!editor.GUI) return { error: 'GUI 未就绪' }
  if (editor.GUI.children.length <= 1) editor.openControlPanel?.()
  const api = editor.panelApi?.otherPanelApi
  if (!api) return { error: 'otherPanelApi 不可用' }
  const map = {
    '编辑动画': api.setAnimateEditorPanel,
    '视角动画': api.setControlsAnimationPanel,
    '变换动画': api.setMeshAnimationPanel,
    '裁剪场景': api.setClippingPanel,
  }
  const fn = map[panel]
  if (!fn) return { error: `未知 panel「${panel}」`, panels: OTHER_PANELS }
  try {
    fn(editorArgs(editor), editorCores(editor), editor.GUI.addDragFolder(panel))
    return { opened: panel }
  } catch (e) {
    return { error: `打开面板失败: ${e?.message || String(e)}` }
  }
}

async function addText3D(editor, { text, fontLink, materialType, position }) {
  const tc = editor.textCores
  if (!tc) return { error: 'textCores 不可用' }
  const t = String(text || tc.text || 'Text').slice(0, 128)
  const fontUrl = fontLink || tc.fontLink
  if (!fontUrl) return { error: '缺少 fontLink' }
  const matType = materialType || tc.materialType || 'MeshBasicMaterial'
  const MatCls = resolveClass(matType, THREE.MeshBasicMaterial)
  let font
  try {
    font = await new FontLoader().loadAsync(fontUrl)
  } catch (e) {
    return { error: `字体加载失败: ${e?.message || fontUrl}` }
  }
  const geo = new TextGeometry(t, { font, size: 0.5, height: 0.08, curveSegments: 8 })
  geo.computeBoundingBox()
  geo.center()
  const mesh = new THREE.Mesh(geo, new MatCls())
  mesh.fontLink = fontUrl
  mesh.text = t
  mesh.editorType = 'isTextMesh'
  mesh.name = t.slice(0, 16)
  const pos = safeVec3(position)
  if (pos) mesh.position.set(...pos)
  attachAdd(editor, mesh)
  return { object: { id: mesh.id, name: mesh.name, type: 'TextMesh', text: t } }
}

function addParticleSystem(editor, params = {}) {
  const pc = editor.particleCores
  if (!pc) return { error: 'particleCores 不可用' }
  const cfg = {
    particlesSum: params.particlesSum ?? pc.particlesSum ?? 5000,
    inner: params.inner ?? pc.inner ?? 0,
    outer: params.outer ?? pc.outer ?? 2000,
    mapUrl: params.mapUrl ?? pc.mapUrl,
  }
  const inner = Math.max(0, fin(cfg.inner, 0))
  const outer = Math.max(inner + 0.001, fin(cfg.outer, inner + 2000))
  const count = clampN(cfg.particlesSum, 100, 20000)
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const rad = inner + Math.random() * (outer - inner)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = rad * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = rad * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = rad * Math.cos(phi)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({ size: params.size ?? 0.15, transparent: true, opacity: 0.85 })
  if (cfg.mapUrl) {
    new THREE.TextureLoader().load(cfg.mapUrl, tex => { mat.map = tex; mat.needsUpdate = true })
  }
  const pts = new THREE.Points(geo, mat)
  pts.editorType = 'isParticleMesh'
  pts.name = '粒子'
  pts.parameters = { ...pc, ...params }
  attachAdd(editor, pts)
  return {
    object: { id: pts.id, type: 'Points', editorType: pts.editorType },
    hint: '基础粒子；完整着色器请 openCorePanel({ panel: "粒子物体" })',
  }
}

function addDrawLine(editor, { points, lineWidth, color }) {
  if (!Array.isArray(points) || points.length < 2) return { error: 'points 至少 2 个点' }
  if (points.length > MAX_DRAW_POINTS) return { error: `points 最多 ${MAX_DRAW_POINTS} 个` }
  const flat = []
  for (const p of points) {
    const v = safeVec3(p)
    if (!v) return { error: 'points 格式无效' }
    flat.push(v[0], v[1] + 0.001, v[2])
  }
  const geo = new LineGeometry().setPositions(flat)
  const hex = color?.startsWith('#') ? color : '#ffffff'
  const mat = new LineMaterial({ color: hex, linewidth: lineWidth ?? 1, worldUnits: false })
  mat.resolution.set(editor.renderer?.domElement?.clientWidth || 1920, editor.renderer?.domElement?.clientHeight || 1080)
  const line = new Line2(geo, mat)
  line.computeLineDistances()
  line.editorType = 'isDrawMesh'
  line.drawParams = { mode: 'straight', points: points.map(p => new THREE.Vector3(...p)), lineWidth: lineWidth ?? 1 }
  line.name = 'DrawLine'
  attachAdd(editor, line)
  return { object: { id: line.id, type: line.type, editorType: line.editorType, pointCount: points.length } }
}
function deselectAll(editor) {
  editor.transformControls?.detach?.()
  const op = editor.effectComposer?.effectPass?.outlinePass
  if (op) op.selectedObjects = []
  return { deselected: true }
}

function setOutlineSelection(editor, { ids }) {
  if (!Array.isArray(ids)) return { error: 'ids 需为数组' }
  const objs = ids.map(id => find(editor.scene, id)).filter(o => o && !isProtected(o))
  if (!objs.length) return { error: '未找到有效对象' }
  editor.setOutlinePass?.(objs)
  editor.transformControls?.attach?.(objs[0])
  return { count: objs.length, ids: objs.map(o => o.id) }
}

function nudgeTransform(editor, { id, dx = 0, dy = 0, dz = 0 }) {
  const { obj: o, error } = findEditable(editor.scene, id)
  if (error) return { error }
  o.position.x += clampN(dx, -MAX_POS, MAX_POS)
  o.position.y += clampN(dy, -MAX_POS, MAX_POS)
  o.position.z += clampN(dz, -MAX_POS, MAX_POS)
  editor.transformControls?.attach?.(o)
  return { id, position: [o.position.x, o.position.y, o.position.z] }
}

function rotateObject90(editor, { id, axis = 'y', sign = 1 }) {
  const { obj: o, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const s = sign >= 0 ? 1 : -1
  const a = String(axis).toLowerCase()
  if (a === 'x') o.rotation.x += s * Math.PI / 2
  else if (a === 'z') o.rotation.z += s * Math.PI / 2
  else o.rotation.y += s * Math.PI / 2
  editor.transformControls?.attach?.(o)
  return { id, rotation: [o.rotation.x, o.rotation.y, o.rotation.z] }
}

function addCss2dLabel(editor, { html, position }) {
  if (!html) return { error: 'html 必填' }
  if (!Array.isArray(position) || position.length !== 3) return { error: 'position 无效' }
  const el = document.createElement('div')
  el.innerHTML = html
  el.style.cssText = 'color:#fff;font-size:14px;pointer-events:none;white-space:nowrap;'
  editor.setCss2dDOM?.(el, { x: position[0], y: position[1], z: position[2] })
  return { added: true, type: 'css2d' }
}

function addCss3dElement(editor, { html, position }) {
  if (!html) return { error: 'html 必填' }
  if (!Array.isArray(position) || position.length !== 3) return { error: 'position 无效' }
  const el = document.createElement('div')
  el.innerHTML = html
  editor.setCss3dDOM?.(el, { x: position[0], y: position[1], z: position[2] })
  return { added: true, type: 'css3d' }
}

function saveViewAngle(editor, { name }) {
  const list = editor.other?.viewAngleList
  if (!list || !editor.camera || !editor.controls?.target) return { error: 'viewAngleList 或相机未就绪' }
  const n = String(name || `视角${list.length + 1}`).slice(0, 64)
  list.push({
    name: n,
    position: editor.camera.position.clone(),
    target: editor.controls.target.clone(),
  })
  return { saved: n, index: list.length - 1, total: list.length }
}

async function flyToViewAngle(editor, { index }) {
  const list = editor.other?.viewAngleList
  const item = list?.[index]
  if (!item || !editor.camera || !editor.controls) return { error: `无 index=${index} 的视角`, total: list?.length ?? 0 }
  await Promise.all([
    createGsapAnimation(editor.camera.position, item.position, { duration: 0.5 }),
    createGsapAnimation(editor.controls.target, item.target, { duration: 0.5 }),
  ])
  return { flewTo: item.name, index }
}

function listViewAngles(editor) {
  const list = editor.other?.viewAngleList || []
  return { angles: list.map((a, i) => ({ index: i, name: a.name })) }
}

function listClippingPlanes(editor) {
  const planes = editor.renderer?.clippingPlanes || []
  return {
    enabled: !!editor.renderer?.localClippingEnabled,
    count: planes.length,
    planes: planes.map((p, i) => ({ index: i, normal: [p.normal.x, p.normal.y, p.normal.z], constant: p.constant })),
  }
}

function addClippingPlane(editor, { normal, constant = 0 }) {
  if (!Array.isArray(normal) || normal.length !== 3) return { error: 'normal 需 [x,y,z]' }
  const r = editor.renderer
  if (!r) return { error: 'renderer 不可用' }
  if (!r.clippingPlanes) r.clippingPlanes = []
  r.clippingPlanes.push(new THREE.Plane(new THREE.Vector3(...normal).normalize(), constant))
  r.localClippingEnabled = true
  return listClippingPlanes(editor)
}

function clearClippingPlanes(editor) {
  const r = editor.renderer
  if (r?.clippingPlanes) r.clippingPlanes.length = 0
  return { cleared: true }
}

function getSceneStats(editor) {
  let vertices = 0, triangles = 0, objects = 0
  editor.scene.traverse(obj => {
    if (obj.isTransformControls || obj.isHelper || obj.type?.includes('Helper')) return
    const geo = obj.geometry
    if (!geo) return
    objects++
    const pos = geo.attributes?.position
    if (pos) vertices += pos.count
    if (geo.index) triangles += geo.index.count / 3
    else if (pos) triangles += pos.count / 3
  })
  return { objects, vertices: Math.floor(vertices), triangles: Math.floor(triangles) }
}

function switchScene(editor, { name }) {
  if (!name) return { error: '缺少 name' }
  const list = loadSceneList()
  if (!list.some(o => o.name === name)) return { error: `场景「${name}」不存在`, scenes: list.map(o => o.name) }
  localStorage.setItem('new_sceneName', name)
  const raw = localStorage.getItem(`${name}-newEditor`)
  let data = null
  if (raw) {
    try { data = JSON.parse(raw) } catch { return { error: `场景「${name}」数据损坏` } }
  }
  editor.resetEditorStorage?.(data)
  return { switched: name }
}

function createSceneSlot(_editor, { name }) {
  if (!name) return { error: '缺少 name' }
  const list = loadSceneList()
  if (list.some(o => o.name === name)) return { error: '场景名已存在' }
  list.push({ name })
  saveSceneList(list)
  localStorage.setItem('new_sceneName', name)
  return { created: name }
}

function deleteSceneSlot(_editor, { name }) {
  if (!name) return { error: '缺少 name' }
  const list = loadSceneList()
  const idx = list.findIndex(o => o.name === name)
  if (idx === -1) return { error: `场景「${name}」不存在` }
  list.splice(idx, 1)
  saveSceneList(list)
  localStorage.removeItem(`${name}-newEditor`)
  const current = localStorage.getItem('new_sceneName')
  if (current === name) localStorage.setItem('new_sceneName', list[0]?.name || '三维测试')
  return { deleted: name }
}

function setPixelRatio(_editor, { ratio }) {
  if (ratio == null) return { error: '缺少 ratio' }
  const r = clampN(ratio, 0.5, 3)
  localStorage.setItem('new_threeEditor_pixelRatio', String(r))
  setTimeout(() => window.location.reload(), 500)
  return { ratio: r, reload: true }
}

function setLogDepthBuffer(_editor, { enabled }) {
  localStorage.setItem('new_threeEditor_logBuffer', String(!!enabled))
  setTimeout(() => window.location.reload(), 500)
  return { enabled: !!enabled, reload: true }
}

function getShareLink(_editor, { sceneName } = {}) {
  const name = sceneName || window.currentOnlineSceneName || localStorage.getItem('new_sceneName') || ''
  const base = `${window.location.origin}${window.location.pathname}`
  const q = name ? `?sceneName=${encodeURIComponent(name.replace(/\.json$/, ''))}` : ''
  return { url: `${base}${q}`, sceneName: name || null }
}

function loadOnlineModel(editor, { url, position, flyTo }) {
  if (!url) return { error: '缺少 url' }
  const mc = editor.modelCores
  if (!mc?.loadModel) return { error: 'modelCores 不可用' }
  return new Promise(resolve => {
    try {
      const loaded = mc.loadModel(url)
      if (!loaded?.loaderService) {
        resolve({ error: '无效模型 URL，支持 glb/gltf/fbx/obj' })
        return
      }
      const { loaderService } = loaded
      loaderService.complete = async (model) => {
        try {
          if (!model) { resolve({ error: '模型加载结果为空' }); return }
          const pos = safeVec3(position)
          if (pos) model.position.set(...pos)
          attachAdd(editor, model)
          if (flyTo && editor.camera && editor.controls) {
            const views = getObjectViews(model, editor.camera)
            if (views?.maxView && views?.target) {
              await Promise.all([
                createGsapAnimation(editor.camera.position, views.maxView, { duration: 0.5 }),
                createGsapAnimation(editor.controls.target, views.target, { duration: 0.5 }),
              ])
            }
          }
          resolve({ object: { id: model.id, name: model.name || '(模型)' }, url, attached: true })
        } catch (e) {
          resolve({ error: `模型加载后处理失败: ${e?.message || String(e)}` })
        }
      }
      loaderService.error = (e) => resolve({ error: `模型加载失败: ${e?.message || url}` })
    } catch (e) {
      resolve({ error: e?.message || String(e) })
    }
  })
}

function addInnerMesh(editor, { geometryType, materialType, position, scale }) {
  const ic = editor.innerCores
  const geoType = geometryType || ic?.geometryType || 'BoxGeometry'
  const matType = materialType || ic?.materialType || 'MeshStandardMaterial'
  const GeoCls = resolveClass(geoType, null)
  const MatCls = resolveClass(matType, THREE.MeshStandardMaterial)
  if (!GeoCls) return { error: `未知 geometryType「${geoType}」` }
  const mesh = new THREE.Mesh(new GeoCls(), new MatCls({ side: THREE.DoubleSide }))
  mesh.name = geoType
  mesh.scale.multiplyScalar(clampN(scale ?? 10, MIN_SCALE, MAX_SCALE))
  mesh.editorType = 'isInnerMesh'
  const pos = safeVec3(position)
  if (pos) mesh.position.set(...pos)
  attachAdd(editor, mesh)
  return { object: { id: mesh.id, name: mesh.name, geometryType: geoType, materialType: matType } }
}

function addCoreLight(editor, { type, position, color, intensity }) {
  const resolved = resolveLightType(editor, type || 'DirectionalLight')
  const hex = safeHex(color) ?? 0xffffff
  const light = createCoreLight(resolved, { color: hex, intensity: clampN(intensity ?? 1, 0, 100) })
  if (!light) return { error: `未知灯光「${type}」`, types: Object.keys(LIGHT_ZH).concat(['AmbientLight', 'DirectionalLight', 'PointLight', 'SpotLight', 'HemisphereLight', 'RectAreaLight']) }
  if (light.target) editor.scene.add(light.target)
  light.editorType = 'isLight'
  light.name = type || resolved
  const pos = safeVec3(position) || [0, 5, 0]
  light.position.set(...pos)
  attachAdd(editor, light)
  return { object: { id: light.id, name: light.name, type: light.type } }
}

function listBlendShaders(editor) {
  const fromStatic = Array.isArray(ThreeEditor.__GLSLLIB__)
    ? ThreeEditor.__GLSLLIB__.map(i => i?.name).filter(Boolean)
    : []
  const lib = editor?.shaderCores?.shaderLibrary || editor?.scene?.shaderLibrary
  const fromRuntime = lib ? Object.keys(lib).filter(k => typeof lib[k] === 'object') : []
  const shaders = [...new Set([...fromStatic, ...fromRuntime])]
  return { shaders: shaders.length ? shaders : ['水波纹'], hint: 'applyBlendShader({ id, shaderName })' }
}

function applyBlendShader(editor, { id, shaderName, uvType }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const fn = editor.shaderCores?.setObjectBlendShader
  if (!fn) return { error: 'shaderCores.setObjectBlendShader 不可用', hint: 'openCorePanel({ panel: "shaderCores" })' }
  const name = String(shaderName || '水波纹').slice(0, 64)
  const uv = uvType === 'world' ? 'world' : 'material'
  try {
    fn(obj, name, uv)
  } catch (e) {
    return { error: `着色器应用失败: ${e?.message || String(e)}` }
  }
  editor.transformControls?.attach?.(obj)
  return { id: obj.id, shader: name, uvType: uv }
}

function setSceneSkybox(editor, { baseUrl, clear }) {
  if (clear || baseUrl === '') {
    editor.scene.background = null
    editor.scene.resetEnv?.()
    return { cleared: true }
  }
  if (!baseUrl) return { error: '需要 baseUrl 或 clear:true' }
  const root = baseUrl.replace(/\/$/, '')
  editor.scene.setSceneBackground?.(Array.from({ length: 6 }, (_, i) => `${root}/${i + 1}.png`))
  return { skybox: root }
}

function setSceneEnvironment(editor, { baseUrl, enabled = true }) {
  if (!baseUrl) return { error: '缺少 baseUrl' }
  const root = baseUrl.replace(/\/$/, '')
  editor.scene.setEnvBackground?.(Array.from({ length: 6 }, (_, i) => `${root}/${i + 1}.png`))
  editor.scene.environmentEnabled = !!enabled
  return { environment: root, enabled: !!enabled }
}

async function animateMeshTransform(editor, { id, position, rotation, scale, duration = 2, mode = 'to' }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const from = getTransformInfo(obj)
  const p = safeVec3(position)
  const rot = rotation ? safeVec3(rotation) : null
  const sc = scale ? safeVec3(scale, MIN_SCALE, MAX_SCALE) : null
  const to = {
    position: p ? { x: p[0], y: p[1], z: p[2] } : from.position,
    rotation: rot ? { x: rot[0], y: rot[1], z: rot[2] } : from.rotation,
    scale: sc ? { x: sc[0], y: sc[1], z: sc[2] } : from.scale,
  }
  const m = mode === 'from' || mode === 'fromTo' ? mode : 'to'
  await setGsapMeshAction(obj, from, to, { mode: m, query: { duration: clampN(duration, 0.1, 30), ease: 'none', repeat: 0, yoyo: false } })
  editor.transformControls?.attach?.(obj)
  return { id, animated: true, position: [obj.position.x, obj.position.y, obj.position.z] }
}

function addSpriteLabel(editor, { text, position, color, fontSize }) {
  if (!text) return { error: 'text 必填' }
  const sprite = createSpriteText({ text: String(text).slice(0, 256), color, fontSize })
  if (Array.isArray(position) && position.length === 3) sprite.position.set(...position)
  attachAdd(editor, sprite)
  return { object: { id: sprite.id, type: 'Sprite', text: String(text).slice(0, 64) } }
}

function playCoreModelAnimation(editor, params = {}) {
  const { id, ...animParams } = params
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const fn = editor.modelCores?.modelAnimationPlay
  if (!fn) return { error: 'modelAnimationPlay 不可用' }
  try {
    fn(obj, animParams)
  } catch (e) {
    return { error: `动画播放失败: ${e?.message || String(e)}` }
  }
  return { playing: true, id, params: animParams }
}

function setHandlerOptions(editor, { mode, transformMode, openKeyEnable }) {
  const h = editor.handler
  if (!h) return { error: 'handler 不可用' }
  if (mode && !HANDLER_MODES.has(mode)) return { error: `mode 需 ${[...HANDLER_MODES].join('|')}` }
  if (transformMode && !TRANSFORM_MODES.has(transformMode)) return { error: `transformMode 需 ${[...TRANSFORM_MODES].join('|')}` }
  if (mode) h.mode = mode
  if (openKeyEnable != null) h.openKeyEnable = !!openKeyEnable
  const tc = editor.transformControls
  if (transformMode && tc) {
    if (typeof tc.setMode === 'function') tc.setMode(transformMode)
    else tc.mode = transformMode
  }
  return { handlerMode: h.mode, transformMode: tc?.mode, openKeyEnable: h.openKeyEnable }
}

function setPreview(editor, { enabled }) {
  if (!editor.handler) return { error: 'handler 未就绪' }
  editor.handler.mode = enabled ? 'none' : 'transform'
  return { preview: !!enabled, handlerMode: editor.handler.mode }
}

function resolveAnimUrl(urlOrName) {
  if (urlOrName?.startsWith('http')) return urlOrName
  const list = (window.animateJsons || []).map(animJsonPath)
  return list.find(u => u.includes(urlOrName)) || null
}

async function applyTheatreAnimation(_editor, { urlOrName }) {
  const url = resolveAnimUrl(urlOrName)
  if (!url) return { error: `未找到动画「${urlOrName}」` }
  let res
  try { res = await fetch(url) } catch (e) { return { error: `网络请求失败: ${e?.message || url}` } }
  if (!res.ok) return { error: `动画加载失败: HTTP ${res.status}` }
  let data
  try { data = await res.json() } catch { return { error: '动画 JSON 解析失败' } }
  if (!data || typeof data !== 'object') return { error: '动画 JSON 无效' }
  localStorage.removeItem('theatre-0.4.persistent')
  localStorage.setItem('THREE_EDITOR_ANIMATIONS', JSON.stringify(data))
  setTimeout(() => window.location.reload(), 800)
  return { applied: url.split('/').pop(), reload: true }
}

function clearTheatreAnimation() {
  localStorage.removeItem('theatre-0.4.persistent')
  localStorage.removeItem('THREE_EDITOR_ANIMATIONS')
  setTimeout(() => window.location.reload(), 800)
  return { cleared: true, reload: true }
}

function getTheatreSheets(editor) {
  const sheets = editor.other?.animateEditor?.studio?.studioProject?.sheets
  if (!sheets) return []
  return Object.keys(sheets).map(k => ({ name: sheets[k].name || k, sequence: sheets[k].sequence }))
}

function controlTheatreSheet(editor, { index = 0, action = 'play' }) {
  const list = getTheatreSheets(editor)
  const sheet = list[index]
  if (!sheet?.sequence) return { error: `无 index=${index} 的 sheet`, total: list.length }
  if (action === 'play') sheet.sequence.play({ iterationCount: Infinity })
  else if (action === 'pause') sheet.sequence.pause()
  else if (action === 'reset') { sheet.sequence.pause(); sheet.sequence.position = 0 }
  else return { error: 'action 需 play|pause|reset' }
  return { index, action, name: sheet.name }
}

function clearEditorCache(_editor, { confirm } = {}) {
  if (!confirm) return { error: '危险操作：需 params.confirm=true 才会执行' }
  localStorage.clear()
  sessionStorage.clear()
  window.indexedDB.deleteDatabase('new_threeEditor_db')
  setTimeout(() => window.location.reload(), 800)
  return { cleared: true, reload: true }
}

const HANDLERS = {
  openCorePanel,
  openOtherPanel,
  addText3D,
  addParticleSystem,
  addDrawLine,
  deselectAll,
  setOutlineSelection,
  nudgeTransform,
  rotateObject90,
  addCss2dLabel,
  addCss3dElement,
  saveViewAngle,
  flyToViewAngle,
  listViewAngles,
  listClippingPlanes,
  addClippingPlane,
  clearClippingPlanes,
  getSceneStats,
  switchScene,
  createSceneSlot,
  deleteSceneSlot,
  setPixelRatio,
  setLogDepthBuffer,
  getShareLink,
  loadOnlineModel,
  addInnerMesh,
  addCoreLight,
  listBlendShaders,
  applyBlendShader,
  setSceneSkybox,
  setSceneEnvironment,
  animateMeshTransform,
  addSpriteLabel,
  playCoreModelAnimation,
  setHandlerOptions,
  setPreview,
  applyTheatreAnimation,
  clearTheatreAnimation,
  controlTheatreSheet,
  clearEditorCache,
}

export async function runEditorAction(editor, { action, params = {} }) {
  if (!editor?.scene) return { error: '编辑器未就绪' }
  if (!action) return { error: '缺少 action', hint: 'listEditorActions 查可用 action' }
  if (!EDITOR_ACTIONS[action]) return { error: `未知 action「${action}」`, hint: '先 listEditorActions' }
  const fn = HANDLERS[action]
  if (!fn) return { error: `action「${action}」尚未实现` }
  try {
    return await fn(editor, params ?? {})
  } catch (err) {
    return { error: `操作失败: ${err?.message || String(err)}` }
  }
}
