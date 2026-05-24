import { tool } from 'ai'
import { z } from 'zod/v4'
import * as THREE from 'three'
import { ThreeEditor, getObjectViews, createGsapAnimation } from '../lib'

const SKIP = new Set(['PerspectiveCamera', 'AxesHelper', 'GridHelper', 'Box3Helper'])
const LIGHT_TYPES = ['环境光', '平行光', '点光源', '聚光灯', '半球光', '平面光']
const MESH_TYPES = {
  '立方体': () => new THREE.BoxGeometry(1, 1, 1),
  '球体': () => new THREE.SphereGeometry(0.5, 32, 16),
  '圆柱': () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  '圆锥': () => new THREE.ConeGeometry(0.5, 1, 32),
  '圆环': () => new THREE.TorusGeometry(0.5, 0.2, 16, 32),
  '平面': () => new THREE.PlaneGeometry(1, 1),
  '二十面体': () => new THREE.IcosahedronGeometry(0.5),
  '八面体': () => new THREE.OctahedronGeometry(0.5),
  '十二面体': () => new THREE.DodecahedronGeometry(0.5),
  '圆扭结': () => new THREE.TorusKnotGeometry(0.4, 0.1, 64, 8),
}
const SKIES = [
  { name: '蓝天', url: 'https://z2586300277.github.io/three-editor/dist/files/scene/skyBox0/' },
  { name: '晴天', url: 'https://z2586300277.github.io/3d-file-server/files/sky/skyBox1/' },
  { name: '森林', url: 'https://z2586300277.github.io/three-editor/dist/files/scene/skyBox8/' },
  { name: '清除', url: '' },
]
const scenePath = (v) => (__isProduction__ ? '/threejs-editor-beta/' : '/') + v
const r = (n) => +n.toFixed(2)
const v3 = (v) => [r(v.x), r(v.y), r(v.z)]
const _v = new THREE.Vector3()
const _e = new THREE.Euler()
const _box = new THREE.Box3()

// ── 安全策略 ──
const PROTECTED = new Set(['PerspectiveCamera', 'OrthographicCamera', 'AxesHelper', 'GridHelper', 'Box3Helper'])
const MAX_POS = 1e5
const MIN_SCALE = 0.001
const MAX_SCALE = 1e3
const MAX_INTENSITY = 100
const MAX_COUNT = 5000
const EXTRA_KEYS = new Set(['needsUpdate'])
const PARAM_LIMITS = {
  count: [1, MAX_COUNT], elementSize: [0.01, 50], range: [1, 500], size: [0.1, 500],
  radius: [0.01, 50], height: [0.01, 100], segments: [3, 128], speed: [0, 10],
  speedVariation: [0, 5], opacity: [0, 1], randomInterval: [50, 10000],
  gridThickness: [0, 0.1], crossThickness: [0, 0.1], cross: [0, 1], gridScale: [1, 200],
}

function isProtected(o) {
  return !o || o.isTransformControlsRoot || o.isHelper || PROTECTED.has(o.type) || o.isCamera
}

function isEditable(o) {
  return o && !isProtected(o)
}

function fin(n, fb = 0) {
  const x = Number(n)
  return Number.isFinite(x) ? x : fb
}

function clampN(n, lo, hi) {
  return Math.min(Math.max(fin(n, lo), lo), hi)
}

function safeVec3(arr, lo = -MAX_POS, hi = MAX_POS) {
  if (!Array.isArray(arr) || arr.length !== 3) return null
  const out = arr.map(v => clampN(v, lo, hi))
  return out.every(Number.isFinite) ? out : null
}

function safeScaleVec(arr) {
  const v = safeVec3(arr, MIN_SCALE, MAX_SCALE)
  return v?.every(x => x !== 0) ? v : null
}

function safeColor(hex) {
  if (typeof hex !== 'string') return null
  const h = hex.startsWith('#') ? hex.slice(1) : hex
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toLowerCase()}` : null
}

function clampParam(key, val) {
  if (typeof val !== 'number') return val
  const lim = PARAM_LIMITS[key]
  return lim ? clampN(val, lim[0], lim[1]) : val
}

function findEditable(scene, id) {
  const obj = find(scene, id)
  if (!obj) return { error: `未找到 id=${id}` }
  if (!isEditable(obj)) return { error: `id=${id} 为受保护对象（相机/辅助线等），不可修改或删除` }
  return { obj }
}

function guardTool(def) {
  const tag = def.description?.slice(0, 24) || 'tool'
  const run = def.execute
  return tool({
    ...def,
    execute: async (input) => {
      try {
        return await run(input)
      } catch (err) {
        console.warn('[AI scene]', tag, err)
        return { error: `操作失败（场景保持原状）: ${err?.message || String(err)}` }
      }
    },
  })
}

function safeCall(fn, label) {
  try { fn?.() } catch (err) { console.warn(`[AI scene] ${label}:`, err) }
}

function worldPos(o) {
  try {
    o.updateWorldMatrix(true, false)
    o.getWorldPosition(_v)
    return v3(_v)
  } catch { return [0, 0, 0] }
}

function worldRotDeg(o) {
  try {
    o.updateWorldMatrix(true, false)
    _e.setFromRotationMatrix(o.matrixWorld)
    return v3({ x: _e.x * 57.2958, y: _e.y * 57.2958, z: _e.z * 57.2958 })
  } catch { return [0, 0, 0] }
}

function worldScale(o) {
  try {
    o.updateWorldMatrix(true, false)
    o.getWorldScale(_v)
    return v3(_v)
  } catch { return [1, 1, 1] }
}

function getBounds(o) {
  try {
    _box.setFromObject(o)
    if (_box.isEmpty()) return null
    const c = _box.getCenter(new THREE.Vector3())
    const s = _box.getSize(new THREE.Vector3())
    return { min: v3(_box.min), max: v3(_box.max), center: v3(c), size: v3(s) }
  } catch { return null }
}

function geomInfo(o) {
  if (!o.isMesh?.geometry) return null
  const g = o.geometry
  const p = g.parameters
  if (!p) return { type: g.type, vertices: g.attributes?.position?.count }
  const info = { type: g.type }
  for (const k of ['width', 'height', 'depth', 'radius', 'radiusTop', 'radiusBottom']) {
    if (p[k] != null) info[k] = r(p[k])
  }
  return info
}

function parseGridHelper(gh) {
  const pos = gh.geometry?.attributes?.position
  if (!pos) return null
  const xs = new Set(), zs = new Set()
  for (let i = 0; i < pos.count; i++) {
    xs.add(r(pos.getX(i)))
    zs.add(r(pos.getZ(i)))
  }
  const ax = [...xs].sort((a, b) => a - b)
  const az = [...zs].sort((a, b) => a - b)
  if (!ax.length || !az.length) return null
  const size = Math.max(ax.at(-1) - ax[0], az.at(-1) - az[0])
  const divisions = Math.max(ax.length, az.length) - 1
  if (!divisions) return null
  return { size: r(size), divisions, cellSize: r(size / divisions), plane: 'xz' }
}

function gridIntersections(gh, size, divisions, y = 0, max = 500) {
  if (!divisions || divisions > 200 || !Number.isFinite(size) || size <= 0) {
    return { cellSize: 0, half: 0, total: 0, points: [], truncated: false }
  }
  const step = size / divisions
  const half = size / 2
  const points = []
  for (let i = 0; i <= divisions && points.length < max; i++) {
    for (let j = 0; j <= divisions && points.length < max; j++) {
      _v.set(-half + i * step, y, -half + j * step)
      if (gh) { gh.updateWorldMatrix(true, false); _v.applyMatrix4(gh.matrixWorld) }
      points.push(v3(_v))
    }
  }
  const total = (divisions + 1) ** 2
  return { cellSize: r(step), half: r(half), total, points, truncated: total > max }
}

function find(scene, id) {
  let o = null
  scene.traverse(x => { if (x.id === id) o = x })
  return o
}

function isObj(o) {
  return o && !o.isHelper && !o.isTransformControlsRoot && !SKIP.has(o.type)
}

function brief(o) {
  const b = {
    id: o.id, name: o.name || '(未命名)', type: o.designType || o.type,
    visible: o.visible, position: v3(o.position), worldPosition: worldPos(o),
  }
  const bounds = getBounds(o)
  if (bounds) b.bounds = { center: bounds.center, size: bounds.size }
  return b
}

function detail(o, opts = {}) {
  const d = {
    ...brief(o),
    rotation: v3({ x: o.rotation.x * 57.2958, y: o.rotation.y * 57.2958, z: o.rotation.z * 57.2958 }),
    scale: v3(o.scale),
    worldRotation: worldRotDeg(o),
    worldScale: worldScale(o),
    bounds: getBounds(o),
  }
  if (o.parent?.type !== 'Scene') {
    d.parent = { id: o.parent.id, name: o.parent.name || '(未命名)', worldPosition: worldPos(o.parent) }
  }
  const geo = geomInfo(o)
  if (geo) d.geometry = geo
  if (o.type === 'GridHelper') {
    const grid = parseGridHelper(o)
    if (grid) d.grid = { ...grid, worldPosition: worldPos(o) }
  }
  const custom = readCustomProps(o)
  if (custom.params || custom.uniforms || custom.materials || custom.schema) d.custom = custom
  o.traverse?.(c => {
    if (d.material || !c.isMesh?.material) return
    const m = Array.isArray(c.material) ? c.material[0] : c.material
    if (m?.color) d.material = { color: `#${m.color.getHexString()}`, opacity: r(m.opacity ?? 1) }
  })
  if (o.isLight) d.light = { intensity: r(o.intensity ?? 1), color: o.color ? `#${o.color.getHexString()}` : undefined }
  if (o.animations?.length) d.animations = listAnimInfo(o)
  const animPlay = readAnimationPlayParams(o)
  if (animPlay) d.animationPlay = animPlay
  if (opts.children && o.children?.length) {
    d.children = o.children.map(c => ({ id: c.id, name: c.name || '(未命名)', type: c.designType || c.type }))
  }
  return d
}

function getGridInfo(editor, includePoints = true) {
  const grids = []
  const cfg = editor.handler?.helpers?.grid
  if (cfg) {
    const item = {
      source: 'editor', show: cfg.showGrid, size: cfg.size, divisions: cfg.divisions,
      cellSize: r(cfg.size / cfg.divisions), plane: 'xz', gridHelperId: cfg.gridHelper?.id ?? null,
    }
    if (includePoints) Object.assign(item, gridIntersections(cfg.gridHelper, cfg.size, cfg.divisions))
    grids.push(item)
  }
  editor.scene.traverse(o => {
    if (o.type !== 'GridHelper' || (cfg?.gridHelper && o.id === cfg.gridHelper.id)) return
    const parsed = parseGridHelper(o)
    if (!parsed) return
    const item = {
      source: 'scene', id: o.id, name: o.name || 'GridHelper', show: o.visible,
      worldPosition: worldPos(o), ...parsed,
    }
    if (includePoints) Object.assign(item, gridIntersections(o, parsed.size, parsed.divisions))
    grids.push(item)
  })
  return { grids, hint: '交点坐标可直接用于 addMesh/addModel；1×1 立方体底面贴网格时 y = cellSize/2' }
}

function findDesign(obj) {
  if (!obj?.designType) return null
  return ThreeEditor.__DESIGNS__.find(d => d.name === obj.designType)
}

function hexToNum(val) {
  if (typeof val === 'number') return val
  if (typeof val === 'string' && val.startsWith('#')) return parseInt(val.slice(1), 16)
  return val
}

function serialVal(v) {
  if (v == null || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') return r(v)
  if (v.isColor) return `#${v.getHexString()}`
  if (v.isVector2) return [r(v.x), r(v.y)]
  if (v.isVector3) return v3(v)
  if (v.isVector4) return [r(v.x), r(v.y), r(v.z), r(v.w)]
  if (v.isTexture) return { type: 'texture' }
  return undefined
}

const UNIFORM_TO_PARAM = {
  uGridColor: 'gridColor', uFloorColor: 'floorColor', uCrossColor: 'crossColor',
  uColor: 'color', uGridThickness: 'gridThickness', uCrossThickness: 'crossThickness', uCross: 'cross',
}

function collectUniformsFromObject(obj) {
  const out = {}
  const add = (uniforms, prefix) => {
    if (!uniforms) return
    for (const [k, e] of Object.entries(uniforms)) {
      const val = serialVal(e?.value ?? e)
      if (val !== undefined) out[prefix ? `${prefix}.${k}` : k] = val
    }
  }
  add(obj.uniforms, '')
  if (obj.material?.uniforms) add(obj.material.uniforms, '')
  obj.traverse?.(c => {
    if (c === obj || !c.isMesh?.material) return
    add(c.material.uniforms, c.name || `mesh_${c.id}`)
  })
  return out
}

function readStandardMaterials(obj) {
  const mats = {}
  const add = (m, key) => {
    if (!m) return
    const info = {}
    if (m.color) info.color = `#${m.color.getHexString()}`
    if (m.opacity != null) info.opacity = r(m.opacity)
    if (m.metalness != null) info.metalness = r(m.metalness)
    if (m.roughness != null) info.roughness = r(m.roughness)
    if (m.emissive) info.emissive = `#${m.emissive.getHexString()}`
    if (m.transparent != null) info.transparent = m.transparent
    if (Object.keys(info).length) mats[key] = info
  }
  if (obj.isMesh && obj.material) add([].concat(obj.material)[0], 'self')
  obj.traverse?.(c => {
    if (c === obj || !c.isMesh?.material) return
    add([].concat(c.material)[0], c.name || c.type)
  })
  return Object.keys(mats).length ? mats : null
}

function readCustomProps(obj) {
  const design = findDesign(obj)
  const custom = { designType: obj.designType || null, componentLabel: design?.label || null }
  if (design?.initParameters) custom.schema = { ...design.initParameters }
  if (obj.params && typeof obj.params === 'object') {
    custom.params = {}
    for (const [k, v] of Object.entries(obj.params)) {
      if (typeof v === 'number') custom.params[k] = r(v)
      else if (typeof v === 'string' || typeof v === 'boolean') custom.params[k] = v
    }
  }
  const uniforms = collectUniformsFromObject(obj)
  if (Object.keys(uniforms).length) custom.uniforms = uniforms
  const materials = readStandardMaterials(obj)
  if (materials) custom.materials = materials
  const extras = {}
  if (typeof obj.needsUpdate === 'boolean') extras.needsUpdate = obj.needsUpdate
  if (Object.keys(extras).length) custom.extras = extras
  let node = obj
  while (node) {
    const ap = readAnimationPlayParams(node)
    if (ap) { custom.animationPlay = ap; break }
    node = node.parent
  }
  return custom
}

function applyUniformEntry(entry, val) {
  if (entry == null || val == null) return false
  try {
    const hasWrap = entry.value !== undefined
    const v = hasWrap ? entry.value : entry
    if (v?.isColor) {
      const c = safeColor(typeof val === 'number' ? `#${val.toString(16).padStart(6, '0')}` : val)
      if (!c) return false
      v.set(c)
      return true
    }
    if (v?.isVector2 && Array.isArray(val) && val.length >= 2) {
      v.set(fin(val[0]), fin(val[1])); return true
    }
    if (v?.isVector3 && Array.isArray(val) && val.length >= 3) {
      v.set(fin(val[0]), fin(val[1]), fin(val[2])); return true
    }
    if (typeof v === 'number' && typeof val === 'number' && Number.isFinite(val)) {
      if (hasWrap) entry.value = val
      return true
    }
    if (typeof v === 'boolean' && typeof val === 'boolean') {
      if (hasWrap) entry.value = val
      return true
    }
  } catch { return false }
  return false
}

function applyUniformsOnObject(obj, uniforms) {
  if (!uniforms) return { applied: [], skipped: [] }
  const applied = [], skipped = []
  for (const [key, val] of Object.entries(uniforms)) {
    const bare = key.includes('.') ? key.split('.').pop() : key
    let hit = false
    if (obj.uniforms?.[bare]) hit = applyUniformEntry(obj.uniforms[bare], val)
    if (!hit && obj.material?.uniforms?.[bare]) hit = applyUniformEntry(obj.material.uniforms[bare], val)
    if (!hit) {
      obj.traverse?.(c => {
        if (!hit && c.material?.uniforms?.[bare]) hit = applyUniformEntry(c.material.uniforms[bare], val)
      })
    }
    if (hit) {
      applied.push(bare)
      const paramKey = UNIFORM_TO_PARAM[bare]
      if (paramKey && obj.params && paramKey in obj.params) {
        obj.params[paramKey] = typeof val === 'string' && val.startsWith('#') ? hexToNum(val) : val
      }
    } else skipped.push(key)
  }
  safeCall(() => obj.updateUniforms?.(), 'updateUniforms')
  return { applied, skipped }
}

function applyStandardMaterials(obj, materials) {
  if (!materials) return
  const apply = (m, patch) => {
    if (!m || !patch) return
    try {
      if (patch.color) { const c = safeColor(patch.color); if (c) m.color?.set(c) }
      if (patch.opacity != null) {
        m.opacity = clampN(patch.opacity, 0, 1)
        m.transparent = m.opacity < 1
      }
      if (patch.metalness != null) m.metalness = clampN(patch.metalness, 0, 1)
      if (patch.roughness != null) m.roughness = clampN(patch.roughness, 0, 1)
      if (patch.emissive) { const c = safeColor(patch.emissive); if (c) m.emissive?.set(c) }
      m.needsUpdate = true
    } catch { /* 跳过无效材质 */ }
  }
  if (materials.self && obj.material) apply([].concat(obj.material)[0], materials.self)
  obj.traverse?.(c => {
    if (!c.isMesh?.material) return
    const patch = materials[c.name] || materials[c.type]
    if (patch) apply([].concat(c.material)[0], patch)
  })
}

const REBUILD_PARAMS = new Set(['count', 'elementSize', 'range', 'size', 'radius', 'height', 'segments'])

function setObjectParams(editor, { id, params, uniforms, extras, materials }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }

  if (params) {
    if (!obj.params) return { error: '该对象没有 params，请用 setProps 或 uniforms/materials' }
    const allowed = Object.keys(obj.params)
    const unknown = Object.keys(params).filter(k => !allowed.includes(k))
    if (unknown.length) return { error: `不允许修改未知 params: ${unknown.join(', ')}`, allowed }
    for (const [k, v] of Object.entries(params)) {
      let val = typeof v === 'string' && v.startsWith('#') && /color/i.test(k) ? hexToNum(v) : v
      if (typeof val === 'number') val = clampParam(k, val)
      obj.params[k] = val
    }
    if (params.opacity != null && obj.material) obj.material.opacity = clampN(params.opacity, 0, 1)
  }

  const uniformResult = applyUniformsOnObject(obj, uniforms)
  applyStandardMaterials(obj, materials)

  if (materials?.self?.opacity != null) {
    const op = clampN(materials.self.opacity, 0, 1)
    if (obj.material) obj.material.opacity = op
    if (obj.params && 'opacity' in obj.params) obj.params.opacity = op
  }

  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (!EXTRA_KEYS.has(k)) continue
      if (k === 'needsUpdate' && typeof obj.needsUpdate === 'boolean') obj.needsUpdate = !!v
    }
  }

  // 结构性 params 变更：仅在安全范围内尝试刷新，失败则静默跳过
  const needsRebuild = params && Object.keys(params).some(k => REBUILD_PARAMS.has(k))
  if (needsRebuild && (!params.count || params.count <= MAX_COUNT)) {
    safeCall(() => obj.createElements?.(), 'createElements')
    safeCall(() => obj.updateGeometry?.(), 'updateGeometry')
  }
  if (params?.randomInterval != null) {
    safeCall(() => { obj.stopRandomize?.(); obj.startRandomize?.() }, 'randomize')
  }

  editor.transformControls.attach(obj)
  const result = { object: detail(obj), custom: readCustomProps(obj) }
  if (uniformResult.skipped.length) result.uniformSkipped = uniformResult.skipped
  return result
}

function listComponentSchema(label) {
  const design = ThreeEditor.__DESIGNS__.find(d => d.label === label || d.name === label)
  if (!design) return { error: `未找到组件「${label}」`, components: ThreeEditor.__DESIGNS__.map(d => d.label) }
  return { label: design.label, name: design.name, defaults: design.initParameters || {} }
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
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  if (name != null) obj.name = String(name).slice(0, 128)
  if (visible != null) obj.visible = !!visible
  if (position) {
    const p = safeVec3(position)
    if (!p) return { error: 'position 无效，需 3 个有限数值' }
    obj.position.set(...p)
  }
  if (rotation) {
    const rot = safeVec3(rotation, -3600, 3600)
    if (!rot) return { error: 'rotation 无效' }
    obj.rotation.set(...rot.map(d => d * Math.PI / 180))
  }
  if (scale) {
    const s = safeScaleVec(scale)
    if (!s) return { error: 'scale 无效，不能为 0 且需在合理范围内' }
    obj.scale.set(...s)
  }
  if (intensity != null && obj.isLight) obj.intensity = clampN(intensity, 0, MAX_INTENSITY)
  const hex = color ? safeColor(color.startsWith('#') ? color : `#${color}`) : null
  if (color && !hex) return { error: 'color 无效，需 #rrggbb 格式' }
  if (hex && obj.isLight?.color) obj.color.set(hex)
  if (hex || opacity != null) {
    obj.traverse?.(c => {
      if (!c.isMesh?.material) return
      ;[].concat(c.material).forEach(m => {
        try {
          if (hex && m.color) m.color.set(hex)
          if (opacity != null) { m.opacity = clampN(opacity, 0, 1); m.transparent = m.opacity < 1 }
          m.needsUpdate = true
        } catch { /* skip */ }
      })
    })
  }
  editor.transformControls.attach(obj)
  return { object: detail(obj) }
}

function selectObject(editor, id) {
  const obj = find(editor.scene, id)
  if (!obj) return { error: `未找到 id=${id}` }
  if (isProtected(obj)) return { error: `id=${id} 为受保护对象，不可选中操作` }
  editor.transformControls.attach(obj)
  return { id, name: obj.name || '(未命名)', selected: true }
}

function deleteObject(editor, id) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
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
  const pos = safeVec3(position) || [0, 5, 0]
  const light = fn()
  if (light.target) editor.scene.add(light.target)
  light.editorType = 'isLight'
  light.name = type
  light.position.set(...pos)
  editor.scene.add(light)
  editor.transformControls.attach(light)
  return { object: detail(light) }
}

async function addMesh(editor, type, position = [0, 0, 0], color = '#ffffff', name, flyTo = false) {
  const geoFn = MESH_TYPES[type]
  if (!geoFn) return { error: `未知几何体「${type}」`, types: Object.keys(MESH_TYPES) }
  const hex = safeColor(color.startsWith('#') ? color : `#${color}`) || '#ffffff'
  const pos = safeVec3(position) || [0, 0, 0]
  const mesh = new THREE.Mesh(geoFn(), new THREE.MeshStandardMaterial({ color: hex }))
  mesh.editorType = 'isInnerMesh'
  mesh.name = String(name || type).slice(0, 128)
  mesh.position.set(...pos)
  editor.scene.add(mesh)
  editor.transformControls.attach(mesh)
  if (flyTo) await flyToObject(editor, mesh, 0.3)
  return { object: detail(mesh) }
}

async function addMeshes(editor, items) {
  const objects = []
  for (const { type, position, color, name } of items) {
    const res = await addMesh(editor, type, position, color ?? '#ffffff', name, false)
    if (res.object) objects.push(res.object)
    else return res
  }
  return { count: objects.length, objects }
}

async function addComponent(editor, label, position, flyTo = false) {
  const design = ThreeEditor.__DESIGNS__.find(d => d.label === label || d.name === label)
  if (!design) return { error: `未找到组件「${label}」`, components: ThreeEditor.__DESIGNS__.map(d => d.label) }
  const pos = safeVec3(position)
  if (!pos) return { error: 'position 无效' }
  let mesh
  try {
    mesh = await design.create(null, editor, editor)
  } catch (e) {
    return { error: `组件创建失败: ${e?.message || String(e)}` }
  }
  if (!mesh) return { error: '组件创建失败' }
  mesh.editorType = 'isDesignMesh'
  mesh.designType = design.name
  editor.scene.add(mesh)
  mesh.position.set(...pos)
  editor.transformControls.attach(mesh)
  if (flyTo) await flyToObject(editor, mesh, 0.3)
  return { object: detail(mesh) }
}

function addModel(editor, urlOrName, position = [0, 0, 0], flyTo = true, anim = {}) {
  const url = resolveModelUrl(urlOrName)
  if (!url) return { error: `未找到模型「${urlOrName}」`, models: listModels().map(m => m.name) }
  const pos = safeVec3(position) || [0, 0, 0]
  return new Promise(resolve => {
    try {
      const { loaderService } = editor.modelCores.loadModel(url)
      loaderService.complete = async model => {
        try {
          model.position.set(...pos)
          ensureAnimationPlayParams(model)
          editor.transformControls.attach(model)
          if (flyTo) await flyToObject(editor, model, 0.3)
          const result = { object: detail(model), url, animationPlay: readAnimationPlayParams(model) }
          if (model.animations?.length) {
            const resolved = resolveAnimIndices(model, anim)
            const hasAnimOpts = anim.initPlay != null || anim.loop != null || anim.speed != null
              || anim.startTime != null || resolved.length
            if (hasAnimOpts) {
              syncAnimParams(model, resolved, anim.speed, anim.loop, anim.startTime, anim.initPlay)
              result.animationPlay = readAnimationPlayParams(model)
            }
            if (anim.initPlay && !resolved.length) {
              result.playHint = 'initPlay 需配合 index/indices/name/names'
            } else if (resolved.length && (anim.initPlay || anim.index != null || anim.indices?.length || anim.name || anim.names?.length)) {
              const playRes = playModelAnimation(editor, { id: model.id, ...anim, loop: anim.loop ?? true })
              if (playRes.error) result.playError = playRes.error
              else result.playing = playRes.playing
              result.animationPlay = readAnimationPlayParams(model)
            }
          }
          resolve(result)
        } catch (e) {
          resolve({ error: `模型加载后处理失败: ${e?.message || String(e)}` })
        }
      }
      loaderService.error = (e) => resolve({ error: `模型加载失败: ${e?.message || url}` })
    } catch (e) {
      resolve({ error: `模型加载失败: ${e?.message || String(e)}` })
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
  try {
    const res = await fetch(path)
    if (!res.ok) return { error: `场景加载失败: HTTP ${res.status}` }
    const data = await res.json()
    editor.resetEditorStorage(data)
    return { loaded: path.split('/').pop(), objects: listObjects(editor) }
  } catch (e) {
    return { error: `场景加载失败: ${e?.message || String(e)}` }
  }
}

async function flyToObject(editor, obj, duration = 0.5) {
  try {
    const { maxView, target } = getObjectViews(obj)
    if (maxView?.x == null) return
    await Promise.all([
      createGsapAnimation(editor.camera.position, maxView, { duration: clampN(duration, 0.1, 5) }),
      createGsapAnimation(editor.controls.target, target, { duration: clampN(duration, 0.1, 5) }),
    ])
  } catch { /* 飞行动画失败不影响场景 */ }
}

async function focusObject(editor, id, duration = 0.5) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  editor.transformControls.attach(obj)
  await flyToObject(editor, obj, duration)
  return { id, name: obj.name || '(未命名)', focused: true }
}

async function focusView(editor, position, target, duration = 0.5) {
  const p = safeVec3(position)
  const t = safeVec3(target)
  if (!p || !t) return { error: 'position/target 无效' }
  const d = clampN(duration, 0.1, 5)
  try {
    await Promise.all([
      createGsapAnimation(editor.camera.position, { x: p[0], y: p[1], z: p[2] }, { duration: d }),
      createGsapAnimation(editor.controls.target, { x: t[0], y: t[1], z: t[2] }, { duration: d }),
    ])
  } catch { return { error: '视角切换失败' } }
  return { focused: true, position: p, target: t }
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

const AI_ANIM = Symbol('aiAnim')

function listAnimInfo(model) {
  return model.animations.map((clip, index) => ({
    index,
    name: clip.name || `animation_${index}`,
    duration: r(clip.duration),
  }))
}

function ensureAnimationPlayParams(model) {
  if (!model.animations?.length) return null
  if (!model.animationPlayParams) {
    model.animationPlayParams = {
      initPlay: false, speed: 1, loop: false, startTime: 0,
      actionIndexs: new Array(model.animations.length).fill(false),
      frameCallback: () => {},
    }
  } else if (model.animationPlayParams.actionIndexs?.length !== model.animations.length) {
    model.animationPlayParams.actionIndexs = new Array(model.animations.length).fill(false)
  }
  return model.animationPlayParams
}

function readAnimationPlayParams(model) {
  if (!model?.animations?.length) return null
  const p = ensureAnimationPlayParams(model)
  return {
    initPlay: !!p.initPlay,
    speed: r(p.speed ?? 1),
    loop: !!p.loop,
    startTime: r(p.startTime ?? 0),
    clips: model.animations.map((clip, i) => ({
      index: i,
      name: clip.name || `animation_${i}`,
      duration: r(clip.duration),
      play: !!p.actionIndexs?.[i],
    })),
  }
}

function findAnimRoot(scene, id) {
  let node = id != null ? find(scene, id) : null
  while (node) {
    if (node.animations?.length) return node
    node = node.parent
  }
  return null
}

function resolveAnimIndices(model, { index, indices, name, names } = {}) {
  const n = model.animations.length
  const out = new Set()
  if (index != null && index >= 0 && index < n) out.add(index)
  indices?.forEach(i => { if (i >= 0 && i < n) out.add(i) })
  if (name != null) {
    const i = model.animations.findIndex(c => c.name === name)
    if (i >= 0) out.add(i)
  }
  names?.forEach(nm => {
    const i = model.animations.findIndex(c => c.name === nm)
    if (i >= 0) out.add(i)
  })
  return [...out]
}

function ensureAnimRuntime(editor, model) {
  let anim = model[AI_ANIM]
  if (anim) return anim
  const clock = new THREE.Clock()
  const mixer = new THREE.AnimationMixer(model)
  const tick = () => {
    const a = model[AI_ANIM]
    if (!a?.actions.length) return
    try { a.mixer.update(a.clock.getDelta()) } catch { /* skip */ }
  }
  editor.scene.addUpdateListener?.(tick)
  anim = { mixer, clock, actions: [], tick }
  model[AI_ANIM] = anim
  return anim
}

function syncAnimParams(model, indices, speed, loop, startTime, initPlay) {
  const p = ensureAnimationPlayParams(model)
  if (!p) return
  p.actionIndexs = model.animations.map((_, i) => indices.includes(i))
  if (speed != null) p.speed = clampN(speed, -10, 10)
  if (loop != null) p.loop = !!loop
  if (startTime != null) p.startTime = clampN(startTime, 0, 1e4)
  if (initPlay != null) p.initPlay = !!initPlay
}

function setAnimationPlayParams(editor, input) {
  const { id, initPlay, speed, loop, startTime, play, index, indices, name, names } = input
  const err = findEditable(editor.scene, id).error
  if (err) return { error: err }
  const model = findAnimRoot(editor.scene, id)
  if (!model) return { error: '该对象没有 GLB/FBX 自带动画' }
  const p = ensureAnimationPlayParams(model)
  if (speed != null) p.speed = clampN(speed, -10, 10)
  if (loop != null) p.loop = !!loop
  if (startTime != null) p.startTime = clampN(startTime, 0, 1e4)
  if (initPlay != null) p.initPlay = !!initPlay
  const hasPick = index != null || indices?.length || name || names?.length
  if (hasPick) {
    const resolved = resolveAnimIndices(model, { index, indices, name, names })
    p.actionIndexs = model.animations.map((_, i) => resolved.includes(i))
  }
  const shouldPlay = play === true || (p.initPlay && p.actionIndexs.some(Boolean))
  if (shouldPlay && p.actionIndexs.some(Boolean)) {
    const playRes = playModelAnimation(editor, {
      id: model.id,
      indices: p.actionIndexs.map((on, i) => on ? i : -1).filter(i => i >= 0),
      speed: p.speed, loop: p.loop, startTime: p.startTime,
    })
    if (playRes.error) return playRes
    return { id: model.id, animationPlay: readAnimationPlayParams(model), playing: playRes.playing }
  }
  return { id: model.id, animationPlay: readAnimationPlayParams(model) }
}

function listAnimations(editor, id) {
  if (id != null) {
    const model = findAnimRoot(editor.scene, id)
    if (!model) return { error: `id=${id} 没有自带动画`, hint: '不传 id 可扫描整个场景' }
    return { id: model.id, name: model.name || '(未命名)', animations: listAnimInfo(model), animationPlay: readAnimationPlayParams(model) }
  }
  const models = []
  editor.scene.traverse(o => {
    if (!o.animations?.length || models.some(m => m.id === o.id)) return
    models.push({ id: o.id, name: o.name || '(未命名)', animations: listAnimInfo(o), animationPlay: readAnimationPlayParams(o) })
  })
  return { models }
}

function playModelAnimation(editor, { id, index, indices, name, names, loop = true, speed = 1, startTime = 0 }) {
  const err = findEditable(editor.scene, id).error
  if (err) return { error: err }
  const model = findAnimRoot(editor.scene, id)
  if (!model) return { error: '该对象没有 GLB/FBX 自带动画', hint: '先用 listAnimations 查看' }
  const resolved = resolveAnimIndices(model, { index, indices, name, names })
  if (!resolved.length) {
    return { error: '未指定有效动画', animations: listAnimInfo(model), hint: '用 index/indices 或 name/names' }
  }
  const spd = clampN(speed, -10, 10)
  const st = clampN(startTime, 0, 1e4)
  const anim = ensureAnimRuntime(editor, model)
  anim.actions.forEach(a => { try { a.stop() } catch {} })
  anim.actions = []
  const playing = []
  const infos = listAnimInfo(model)
  for (const i of resolved) {
    const clip = model.animations[i]
    if (!clip) continue
    try {
      const action = anim.mixer.clipAction(clip)
      action.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce
      action.clampWhenFinished = !loop
      action.timeScale = spd
      action.time = st
      action.play()
      anim.actions.push(action)
      playing.push(infos[i])
    } catch { /* skip bad clip */ }
  }
  if (!playing.length) return { error: '动画播放失败' }
  syncAnimParams(model, resolved, spd, loop, st, true)
  return { id: model.id, playing, loop: !!loop, speed: spd, animationPlay: readAnimationPlayParams(model) }
}

function stopModelAnimation(editor, { id }) {
  const err = findEditable(editor.scene, id).error
  if (err) return { error: err }
  const model = findAnimRoot(editor.scene, id)
  if (!model) return { error: `id=${id} 没有动画可停止` }
  const anim = model[AI_ANIM]
  if (anim) {
    anim.actions.forEach(a => { try { a.stop() } catch {} })
    anim.actions = []
  }
  syncAnimParams(model, [], 1, false, 0, false)
  return { id: model.id, stopped: true, animationPlay: readAnimationPlayParams(model) }
}

export const SCENE_SYSTEM = `你是 Three.js 场景编辑助手。操作前先查询，不要猜坐标或参数。

安全规则（必须遵守）：
- 只修改 listObjects/getDetail 中存在的对象 id
- 不可修改/删除相机、GridHelper、AxesHelper 等受保护对象
- setObjectParams 只能改 getObjectParams 返回的已有 params/uniforms 键，不可臆造字段
- 数值参数保持合理范围（count≤5000，opacity 0-1，scale>0）
- 操作返回 error 时停止重试，不要连续盲目修改
- 每次只改少量属性，改完可 getDetail 确认

空间：getDetail/getSelected/getGridInfo
参数：getObjectParams → setObjectParams（仅写 scene 对象属性）
变换：setProps（position/rotation/scale/color）
动画：listAnimations（含 animationPlay 初始加载参数）→ setAnimationPlayParams / playAnimation / stopAnimation
  animationPlay 字段：initPlay、speed、loop、startTime、clips[].play（与编辑器面板一致）
加：addMesh, addMeshes, addModel(initPlay/index 可加载即播), addComponent, addLight
读：listObjects, getCamera, listMeshes, listModels, listComponents, listScenes, listSkies, listAnimations
改：setProps, setObjectParams, setAnimationPlayParams, deleteObject, playAnimation, stopAnimation
视角：selectObject, focusObject, focusView
场景：loadScene, setSky, setEnv, setHelpers`

const vec3 = z.tuple([z.number(), z.number(), z.number()]).optional()
const vec3req = z.tuple([z.number(), z.number(), z.number()])

export function listObjects(editor, deep = false) {
  if (!deep) return editor.scene.children.filter(isObj).map(brief)
  const out = []
  editor.scene.traverse(o => { if (isObj(o)) out.push(brief(o)) })
  return out
}

export function createSceneTools(editor) {
  return {
    listObjects: guardTool({
      description: '列出场景对象，含 worldPosition 和 bounds。deep=true 含所有嵌套子对象',
      inputSchema: z.object({ deep: z.boolean().optional().describe('是否递归列出子对象') }),
      execute: ({ deep }) => ({
        selectedId: editor.transformControls.object?.id ?? null,
        objects: listObjects(editor, !!deep),
      }),
    }),
    getSelected: guardTool({
      description: '获取当前选中对象完整空间属性（世界坐标、包围盒、尺寸等）',
      inputSchema: z.object({}),
      execute: () => {
        const o = editor.transformControls.object
        return o ? { object: detail(o, { children: true }) } : { error: '未选中对象' }
      },
    }),
    getGridInfo: guardTool({
      description: '获取 GridHelper 网格参数与交点世界坐标，用于对齐放置物体',
      inputSchema: z.object({
        includePoints: z.boolean().optional().describe('是否返回交点坐标，默认 true'),
      }),
      execute: ({ includePoints }) => getGridInfo(editor, includePoints !== false),
    }),
    getDetail: guardTool({
      description: '获取对象完整属性：空间信息 + custom(params/uniforms/materials)',
      inputSchema: z.object({
        id: z.number(),
        children: z.boolean().optional().describe('是否包含直接子节点列表'),
      }),
      execute: ({ id, children }) => {
        const o = find(editor.scene, id)
        return o ? { object: detail(o, { children: !!children }) } : { error: `未找到 id=${id}` }
      },
    }),
    getObjectParams: guardTool({
      description: '读取场景对象上的 params、shader uniforms、标准材质、needsUpdate',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => {
        const o = find(editor.scene, id)
        return o ? { id, name: o.name || '(未命名)', custom: readCustomProps(o) } : { error: `未找到 id=${id}` }
      },
    }),
    setObjectParams: guardTool({
      description: '直接修改场景对象 params/uniforms/material/needsUpdate，不调用组件 setStorage',
      inputSchema: z.object({
        id: z.number(),
        params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional()
          .describe('组件 params，如 count/speed/size/gridColor'),
        uniforms: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.array(z.number())])).optional()
          .describe('shader uniform，如 uGridColor/animationSpeed/offsetX'),
        extras: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional()
          .describe('对象级属性，如 needsUpdate'),
        materials: z.record(z.string(), z.object({
          color: z.string().optional(), opacity: z.number().optional(),
          metalness: z.number().optional(), roughness: z.number().optional(), emissive: z.string().optional(),
        }).optional()).optional().describe('标准材质，key 为 self 或子 mesh 名称'),
      }),
      execute: (input) => setObjectParams(editor, input),
    }),
    listComponentSchema: guardTool({
      description: '列出组件可配置参数的默认值(schema)，添加或修改组件前可查阅',
      inputSchema: z.object({ label: z.string().describe('组件名，来自 listComponents') }),
      execute: ({ label }) => listComponentSchema(label),
    }),
    listAnimations: guardTool({
      description: '列出 GLB/FBX 模型自带动画 clips；不传 id 则扫描场景中所有含动画的模型',
      inputSchema: z.object({
        id: z.number().optional().describe('模型对象 id，来自 listObjects'),
      }),
      execute: ({ id }) => listAnimations(editor, id),
    }),
    playAnimation: guardTool({
      description: '播放模型自带动画。用 index/indices 或 name/names 指定 clip',
      inputSchema: z.object({
        id: z.number(),
        index: z.number().int().min(0).optional().describe('单个动画索引，来自 listAnimations'),
        indices: z.array(z.number().int().min(0)).optional().describe('多个动画索引'),
        name: z.string().optional().describe('单个动画名称'),
        names: z.array(z.string()).optional().describe('多个动画名称'),
        loop: z.boolean().optional().describe('是否循环，默认 true'),
        speed: z.number().min(-10).max(10).optional().describe('播放速度，默认 1'),
        startTime: z.number().min(0).max(10000).optional().describe('起始时间(秒)，默认 0'),
      }),
      execute: (input) => playModelAnimation(editor, input),
    }),
    stopAnimation: guardTool({
      description: '停止模型自带动画播放',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => stopModelAnimation(editor, { id }),
    }),
    setAnimationPlayParams: guardTool({
      description: '设置模型 animationPlayParams（初始加载播放、速度、循环、选中 clips），与编辑器动画面板一致',
      inputSchema: z.object({
        id: z.number(),
        initPlay: z.boolean().optional().describe('初始/自动播放开关'),
        speed: z.number().min(-10).max(10).optional(),
        loop: z.boolean().optional(),
        startTime: z.number().min(0).max(10000).optional().describe('开始时间(秒)'),
        play: z.boolean().optional().describe('立即按当前参数播放'),
        index: z.number().int().min(0).optional(),
        indices: z.array(z.number().int().min(0)).optional(),
        name: z.string().optional(),
        names: z.array(z.string()).optional(),
      }),
      execute: (input) => setAnimationPlayParams(editor, input),
    }),
    getCamera: guardTool({
      description: '获取当前相机位置和观察目标',
      inputSchema: z.object({}),
      execute: () => ({ position: v3(editor.camera.position), target: v3(editor.controls.target) }),
    }),
    setProps: guardTool({
      description: '修改对象属性（含灯光 intensity）',
      inputSchema: z.object({
        id: z.number(), name: z.string().optional(), visible: z.boolean().optional(),
        position: vec3, rotation: vec3, scale: vec3,
        color: z.string().optional(), opacity: z.number().min(0).max(1).optional(),
        intensity: z.number().min(0).max(MAX_INTENSITY).optional().describe('灯光强度'),
      }),
      execute: (input) => setProps(editor, input),
    }),
    selectObject: guardTool({
      description: '选中对象，不移动相机',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => selectObject(editor, id),
    }),
    deleteObject: guardTool({
      description: '从场景删除对象',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => deleteObject(editor, id),
    }),
    listModels: guardTool({
      description: '列出可加载的 GLB/FBX 模型',
      inputSchema: z.object({}),
      execute: () => ({ models: listModels() }),
    }),
    addModel: guardTool({
      description: '加载 GLB/FBX 模型。可设 initPlay/index 实现加载后自动播放自带动画',
      inputSchema: z.object({
        urlOrName: z.string().describe('模型 URL 或文件名，来自 listModels'),
        position: vec3.describe('位置，默认 [0,0,0]'),
        flyTo: z.boolean().optional().describe('加载后飞过去，默认 true'),
        initPlay: z.boolean().optional().describe('初始加载播放，需配合 index/indices'),
        index: z.number().int().min(0).optional().describe('加载后播放的动画索引'),
        indices: z.array(z.number().int().min(0)).optional(),
        loop: z.boolean().optional().describe('是否循环，默认 true'),
        speed: z.number().min(-10).max(10).optional().describe('播放速度，默认 1'),
      }),
      execute: ({ urlOrName, position, flyTo, initPlay, index, indices, loop, speed }) =>
        addModel(editor, urlOrName, position ?? [0, 0, 0], flyTo !== false, { initPlay, index, indices, loop, speed }),
    }),
    listComponents: guardTool({
      description: '列出可添加的组件',
      inputSchema: z.object({}),
      execute: () => ({ components: ThreeEditor.__DESIGNS__.map(d => d.label) }),
    }),
    addComponent: guardTool({
      description: '在坐标处添加组件',
      inputSchema: z.object({
        label: z.string(), position: vec3req, flyTo: z.boolean().optional(),
      }),
      execute: ({ label, position, flyTo }) => addComponent(editor, label, position, !!flyTo),
    }),
    listLights: guardTool({
      description: '列出可添加的灯光类型',
      inputSchema: z.object({}),
      execute: () => ({ types: LIGHT_TYPES }),
    }),
    addLight: guardTool({
      description: '添加灯光',
      inputSchema: z.object({
        type: z.enum(LIGHT_TYPES), position: vec3.describe('默认 [0,5,0]'),
      }),
      execute: ({ type, position }) => addLight(editor, type, position ?? [0, 5, 0]),
    }),
    listMeshes: guardTool({
      description: '列出可添加的基础几何体（立方体、球体等）',
      inputSchema: z.object({}),
      execute: () => ({ types: Object.keys(MESH_TYPES) }),
    }),
    addMesh: guardTool({
      description: '添加基础几何体 Mesh。position 为世界坐标（场景根下）',
      inputSchema: z.object({
        type: z.enum(Object.keys(MESH_TYPES)).describe('几何体类型，来自 listMeshes'),
        position: vec3.describe('位置，默认 [0,0,0]'),
        color: z.string().optional().describe('颜色，默认 #ffffff'),
        name: z.string().optional().describe('对象名称'),
        flyTo: z.boolean().optional(),
      }),
      execute: ({ type, position, color, name, flyTo }) =>
        addMesh(editor, type, position ?? [0, 0, 0], color ?? '#ffffff', name, !!flyTo),
    }),
    addMeshes: guardTool({
      description: '批量添加几何体，适合网格交点批量放置（最多 50 个）',
      inputSchema: z.object({
        items: z.array(z.object({
          type: z.enum(Object.keys(MESH_TYPES)),
          position: vec3req,
          color: z.string().optional(),
          name: z.string().optional(),
        })).min(1).max(50),
      }),
      execute: ({ items }) => addMeshes(editor, items),
    }),
    listScenes: guardTool({
      description: '列出可加载的配置案例场景',
      inputSchema: z.object({}),
      execute: () => ({ scenes: listScenes() }),
    }),
    loadScene: guardTool({
      description: '加载配置案例（会替换当前场景内容）',
      inputSchema: z.object({ name: z.string().describe('场景名，来自 listScenes') }),
      execute: ({ name }) => loadScene(editor, name),
    }),
    listSkies: guardTool({
      description: '列出天空盒/环境贴图选项',
      inputSchema: z.object({}),
      execute: () => ({ skies: SKIES.map(s => s.name) }),
    }),
    setSky: guardTool({
      description: '设置天空盒背景',
      inputSchema: z.object({ name: z.string().describe('来自 listSkies') }),
      execute: ({ name }) => setSky(editor, name),
    }),
    setEnv: guardTool({
      description: '设置环境反射贴图',
      inputSchema: z.object({ name: z.string().describe('蓝天/晴天/森林') }),
      execute: ({ name }) => setEnv(editor, name),
    }),
    setHelpers: guardTool({
      description: '显示/隐藏网格和坐标轴',
      inputSchema: z.object({ grid: z.boolean().optional(), axes: z.boolean().optional() }),
      execute: ({ grid, axes }) => setHelpers(editor, grid, axes),
    }),
    focusObject: guardTool({
      description: '选中并飞过去',
      inputSchema: z.object({ id: z.number(), duration: z.number().min(0.1).max(5).optional() }),
      execute: ({ id, duration }) => focusObject(editor, id, duration ?? 0.5),
    }),
    focusView: guardTool({
      description: '相机飞到指定位置和目标',
      inputSchema: z.object({
        position: vec3req, target: vec3req, duration: z.number().min(0.1).max(5).optional(),
      }),
      execute: ({ position, target, duration }) => focusView(editor, position, target, duration ?? 0.5),
    }),
  }
}
