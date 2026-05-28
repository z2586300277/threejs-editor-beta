import { tool } from 'ai'
import { z } from 'zod/v4'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { ThreeEditor, CORES_LIST, getObjectViews, createGsapAnimation, restoreHistoryHandler, getObjectBox3, getMaterials, createSpriteText } from '../lib'
import { listEditorActions, runEditorAction, EDITOR_ACTIONS } from './editorActions'

export { listEditorActions, runEditorAction }

const SKIP = new Set(['PerspectiveCamera', 'AxesHelper', 'GridHelper', 'Box3Helper'])
const LIGHT_TYPES = ['环境光', '平行光', '点光源', '聚光灯', '半球光', '平面光']
const NATIVE_LIGHT_TYPES = ['AmbientLight', 'DirectionalLight', 'PointLight', 'SpotLight', 'HemisphereLight', 'RectAreaLight']
const MAX_INSTANCES = 2000
const MAX_CURVE_POINTS = 256
const NATIVE_TOOL_NAMES = [
  'createMesh', 'createBufferMesh', 'createInstancedMesh', 'createLatheMesh', 'addTubeMesh',
  'createGroup', 'reparentObject', 'cloneObject', 'lookAt',
  'setMaterial', 'replaceGeometry', 'applyTexture', 'updateMeshGeometry', 'addMeshWireframe',
  'addLine', 'addPoints', 'addSprite', 'addNativeLight', 'setLightProps', 'setSceneProps', 'setProps',
]
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
const MATERIAL_TYPES = ['MeshBasicMaterial', 'MeshStandardMaterial', 'MeshPhongMaterial', 'MeshLambertMaterial', 'MeshNormalMaterial', 'MeshPhysicalMaterial', 'MeshToonMaterial', 'MeshDepthMaterial']
const GEOMETRY_TYPES = ['BoxGeometry', 'SphereGeometry', 'PlaneGeometry', 'CylinderGeometry', 'ConeGeometry', 'TorusGeometry', 'TorusKnotGeometry', 'IcosahedronGeometry', 'OctahedronGeometry', 'DodecahedronGeometry', 'TetrahedronGeometry', 'CapsuleGeometry', 'RingGeometry', 'CircleGeometry', 'LatheGeometry', 'TubeGeometry']
const TEXTURE_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']
const SIDE_MAP = { FrontSide: THREE.FrontSide, BackSide: THREE.BackSide, DoubleSide: THREE.DoubleSide }
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
const LIST_CAP = 40
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

function safeHexInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return clampN(Math.floor(v), 0, 0xffffff)
  if (typeof v === 'string') {
    const c = safeColor(v.startsWith('#') ? v : `#${v.replace(/^#/, '').padStart(6, '0')}`)
    return c ? parseInt(c.slice(1), 16) : null
  }
  return null
}

function vec3Input(v, lo = -MAX_POS, hi = MAX_POS) {
  if (Array.isArray(v) && v.length === 3) return safeVec3(v, lo, hi)
  if (v && typeof v === 'object' && v.x != null) return safeVec3([v.x, v.y, v.z], lo, hi)
  return null
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
  if (!scene || id == null) return null
  return scene.getObjectById(id) ?? null
}

function isObj(o) {
  return o && !o.isHelper && !o.isTransformControlsRoot && !SKIP.has(o.type)
}

function isHorizWorld(o) {
  const rot = worldRotDeg(o)
  if (Math.abs(Math.abs(rot[0]) - 90) < 12) return true
  const b = getBounds(o)
  return !!(b && b.size[1] < 0.05 && b.size[0] > 0.3 && b.size[2] > 0.3)
}

function isFloorLike(o) {
  const tag = `${o.name || ''}${o.designType || ''}`
  if (/地面|floor|ground|gridFloor/i.test(tag)) return true
  return o.geometry?.type === 'PlaneGeometry' && isHorizWorld(o)
}

function detectGroundSurface(editor) {
  let ref = { y: 0, source: 'world origin', id: null }
  editor.scene.traverse(o => {
    if (!isObj(o)) return
    if (!isFloorLike(o) && !o.designType?.includes('Floor')) return
    const b = getBounds(o)
    if (!b || !isHorizWorld(o)) return
    if (b.max[1] >= ref.y - 0.001) {
      ref = { y: r(b.max[1]), source: o.name || o.designType || o.type, id: o.id }
    }
  })
  return ref
}

function brief(o) {
  const b = {
    id: o.id, name: o.name || '(未命名)', type: o.designType || o.type,
    editorType: o.editorType || null, designType: o.designType || null,
    visible: o.visible, position: v3(o.position), worldPosition: worldPos(o),
  }
  const bounds = getBounds(o)
  if (bounds) {
    b.bounds = {
      center: bounds.center, size: bounds.size,
      bottomY: bounds.min[1], topY: bounds.max[1],
    }
  }
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
  if (o.isMesh) d.shadow = { castShadow: !!o.castShadow, receiveShadow: !!o.receiveShadow }
  if (o.renderOrder) d.renderOrder = o.renderOrder
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
  return {
    grids,
    hint: '默认不含交点列表；需对齐网格时用 includePoints:true。贴地请用 getSpatialContext + placeOnGround',
  }
}

function getSpatialContext(editor, id) {
  const ground = detectGroundSurface(editor)
  const cfg = editor.handler?.helpers?.grid
  const grid = cfg ? {
    show: cfg.showGrid, size: cfg.size, divisions: cfg.divisions,
    cellSize: r(cfg.size / cfg.divisions), plane: 'xz',
  } : null
  const floors = []
  editor.scene.traverse(o => {
    if (!isObj(o)) return
    const b = getBounds(o)
    if (!b || !isFloorLike(o)) return
    floors.push({
      id: o.id, name: o.name || '(未命名)', designType: o.designType || null,
      topY: b.max[1], bottomY: b.min[1], size: b.size, horizontal: isHorizWorld(o),
      worldRotation: worldRotDeg(o),
    })
  })
  let focus = null
  if (id != null) {
    const o = find(editor.scene, id)
    if (!o) focus = { error: `未找到 id=${id}` }
    else {
      const b = getBounds(o)
      focus = {
        id, name: o.name || '(未命名)', type: o.designType || o.type,
        bounds: b, bottomY: b?.min[1], topY: b?.max[1],
        gapToGround: b ? r(ground.y - b.min[1]) : null,
        worldRotation: worldRotDeg(o), geometry: geomInfo(o),
      }
    }
  }
  return {
    axes: { up: '+Y', groundPlane: 'XZ', recommendedGroundY: ground.y, groundRef: ground },
    grid, floors: floors.slice(0, 8), focus,
    rules: {
      pivot: 'position 是轴心不是底面，bottomY=bounds.min.y',
      planeFlat: 'PlaneGeometry 默认竖立，作地面需 rotation [-90,0,0] 或 placeOnGround(flat:true)',
      groundScale: '地面已放平后 scale 必须 [S,S,1] 正方形；禁止 [S,1,1] 会变长条',
      onGround: 'placeOnGround(id) 自动算 y；或 y += recommendedGroundY - bottomY',
    },
  }
}

function placeOnGround(editor, { id, groundY, flat, x, z, refId }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  let targetY = groundY
  if (targetY == null) {
    if (refId != null) {
      const ref = find(editor.scene, refId)
      const b = ref && getBounds(ref)
      targetY = b ? b.max[1] : 0
    } else {
      targetY = detectGroundSurface(editor).y
    }
  }
  if (flat) {
    let mesh = obj.geometry?.type === 'PlaneGeometry' ? obj : null
    obj.traverse?.(c => { if (!mesh && c.isMesh?.geometry?.type === 'PlaneGeometry') mesh = c })
    if (mesh && !isHorizWorld(mesh)) mesh.rotation.x = -Math.PI / 2
  }
  obj.updateWorldMatrix(true, true)
  const b = getBounds(obj)
  if (!b) return { error: '无法计算包围盒' }
  obj.position.y += targetY - b.min[1]
  if (x != null || z != null) {
    const nx = x != null ? clampN(x, -MAX_POS, MAX_POS) : obj.position.x
    const nz = z != null ? clampN(z, -MAX_POS, MAX_POS) : obj.position.z
    obj.position.set(nx, obj.position.y, nz)
  }
  editor.transformControls.attach(obj)
  const after = getBounds(obj)
  return {
    id: obj.id, groundY: r(targetY), bottomY: after?.min[1],
    object: detail(obj),
  }
}

function findDesign(obj) {
  if (!obj?.designType) return null
  return ThreeEditor.__DESIGNS__.find(d => d.name === obj.designType)
}

function isGroundComponent(design) {
  const tag = `${design?.label || ''}${design?.name || ''}`
  return /地面|floor|ground|海面|grass|Grass/i.test(tag)
}

function normalizeParamsInput(params) {
  const out = {}
  for (const [k, v] of Object.entries(params)) {
    let val = typeof v === 'string' && v.startsWith('#') && /color/i.test(k) ? hexToNum(v) : v
    if (typeof val === 'number') val = clampParam(k, val)
    out[k] = val
  }
  return out
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
    const normalized = normalizeParamsInput(params)
    const design = findDesign(obj)
    if (design?.setStorage) {
      safeCall(() => design.setStorage(obj, { params: normalized }), 'setStorage')
    } else {
      for (const [k, v] of Object.entries(normalized)) obj.params[k] = v
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

  // 结构性 params 变更：无 setStorage 时尝试刷新
  const design = findDesign(obj)
  const needsRebuild = params && !design?.setStorage && Object.keys(params).some(k => REBUILD_PARAMS.has(k))
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

function setProps(editor, { id, name, visible, position, rotation, scale, color, opacity, intensity, castShadow, receiveShadow, renderOrder }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  if (name != null) obj.name = String(name).slice(0, 128)
  if (visible != null) obj.visible = !!visible
  if (position) {
    const p = vec3Input(position)
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
  if (renderOrder != null) obj.renderOrder = clampN(renderOrder, -1000, 1000)
  if (castShadow != null || receiveShadow != null) {
    obj.traverse?.(c => {
      if (!c.isMesh) return
      if (castShadow != null) c.castShadow = !!castShadow
      if (receiveShadow != null) c.receiveShadow = !!receiveShadow
    })
  }
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

function attachObject(editor, obj) {
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
  disposeObject3D(obj)
  editor.scene.remove(obj)
  return { deleted: id, name: obj.name || '(未命名)', disposed: true }
}

function disposeObject3D(obj) {
  obj.traverse?.(c => {
    safeCall(() => c.geometry?.dispose(), 'disposeGeometry')
    const mats = c.material ? [].concat(c.material) : []
    for (const m of mats) {
      if (!m) continue
      for (const k of Object.keys(m)) {
        if (m[k]?.isTexture) safeCall(() => m[k].dispose(), 'disposeTexture')
      }
      safeCall(() => m.dispose?.(), 'disposeMaterial')
    }
  })
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
  attachObject(editor, light)
  return { object: detail(light) }
}

function addNativeLight(editor, { type = 'DirectionalLight', position, color, intensity }) {
  const hex = color != null ? safeHexInt(color) : 0xffffff
  if (color != null && hex == null) return { error: 'color 无效，需 #rrggbb 或数字' }
  const i = clampN(intensity ?? 1, 0, MAX_INTENSITY)
  let light
  switch (type) {
    case 'AmbientLight': light = new THREE.AmbientLight(hex, i); break
    case 'DirectionalLight': light = new THREE.DirectionalLight(hex, i); break
    case 'PointLight': light = new THREE.PointLight(hex, i, 0, 0); break
    case 'SpotLight': light = new THREE.SpotLight(hex, i, 0, Math.PI / 6, 0, 0); break
    case 'HemisphereLight': light = new THREE.HemisphereLight(hex, 0x000000, i); break
    case 'RectAreaLight': light = new THREE.RectAreaLight(hex, i, 100, 100); break
    default: return { error: `未知灯光「${type}」`, types: NATIVE_LIGHT_TYPES }
  }
  if (light.target) editor.scene.add(light.target)
  light.editorType = 'isLight'
  light.name = type
  light.position.set(...(safeVec3(position) || [0, 5, 0]))
  attachObject(editor, light)
  return { object: detail(light) }
}

async function addMesh(editor, type, position = [0, 0, 0], color = '#ffffff', name, flyTo = false, opts = {}) {
  const geoFn = MESH_TYPES[type]
  if (!geoFn) return { error: `未知几何体「${type}」`, types: Object.keys(MESH_TYPES) }
  const hex = safeColor(color.startsWith('#') ? color : `#${color}`) || '#ffffff'
  const pos = safeVec3(position) || [0, 0, 0]
  const isGroundPlane = type === '平面' && (opts.onGround || opts.flat || opts.size != null)
  const geo = isGroundPlane
    ? new THREE.PlaneGeometry(
        clampN(opts.size ?? editor.handler?.helpers?.grid?.size ?? 50, 1, 500),
        clampN(opts.size ?? editor.handler?.helpers?.grid?.size ?? 50, 1, 500),
      )
    : geoFn()
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hex }))
  mesh.editorType = 'isInnerMesh'
  mesh.name = String(name || type).slice(0, 128)
  mesh.position.set(...pos)
  if (opts.rotation) {
    const rot = safeVec3(opts.rotation, -3600, 3600)
    if (rot) mesh.rotation.set(...rot.map(d => d * Math.PI / 180))
  }
  if (opts.onGround || opts.flat) {
    editor.scene.add(mesh)
    const res = placeOnGround(editor, { id: mesh.id, flat: opts.flat ?? type === '平面' })
    if (res.error) return res
    editor.transformControls.attach(mesh)
    if (flyTo) await flyToObject(editor, mesh, 0.3)
    return { object: res.object, placed: { groundY: res.groundY, bottomY: res.bottomY } }
  }
  attachObject(editor, mesh)
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

async function addComponent(editor, label, position, flyTo = false, onGround) {
  const design = ThreeEditor.__DESIGNS__.find(d => d.label === label || d.name === label)
  if (!design) return { error: `未找到组件「${label}」`, hint: '用 listCatalog 查可用组件' }
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
  const shouldGround = onGround ?? isGroundComponent(design)
  if (shouldGround) {
    const res = placeOnGround(editor, { id: mesh.id, flat: true })
    if (res.error) return res
    editor.transformControls.attach(mesh)
    if (flyTo) await flyToObject(editor, mesh, 0.3)
    return { object: res.object, placed: { groundY: res.groundY, bottomY: res.bottomY } }
  }
  editor.transformControls.attach(mesh)
  if (flyTo) await flyToObject(editor, mesh, 0.3)
  return { object: detail(mesh) }
}

function addModel(editor, urlOrName, position = [0, 0, 0], flyTo = false, anim = {}, onGround = true) {
  const url = resolveModelUrl(urlOrName)
  if (!url) return { error: `未找到模型「${urlOrName}」`, hint: '用 listCatalog 查可用模型' }
  const pos = safeVec3(position) || [0, 0, 0]
  return new Promise(resolve => {
    try {
      const { loaderService } = editor.modelCores.loadModel(url)
      loaderService.complete = async model => {
        try {
          model.position.set(...pos)
          ensureAnimationPlayParams(model)
          if (onGround) {
            const pg = placeOnGround(editor, { id: model.id })
            if (pg.error) { resolve(pg); return }
          }
          attachObject(editor, model)
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
    if (!editor.camera || !editor.controls) return
    const views = getObjectViews(obj, editor.camera)
    const maxView = views?.maxView
    const target = views?.target
    if (maxView?.x == null || target?.x == null) return
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

// ── Three.js 原生操作 ──

function resolveMeshTarget(obj, meshName) {
  if (!obj) return null
  if (!meshName) return obj.isMesh ? obj : null
  let found = null
  obj.traverse(c => { if (!found && c.isMesh && c.name === meshName) found = c })
  return found
}

function gp(p, key, def, lo, hi) {
  return clampN(p[key] ?? def, lo, hi)
}

function parsePath3D(points, max = MAX_CURVE_POINTS) {
  if (!Array.isArray(points) || points.length < 2) return { error: 'points 至少 2 个点' }
  if (points.length > max) return { error: `points 最多 ${max} 个` }
  const out = []
  for (const p of points) {
    const v = vec3Input(p)
    if (!v) return { error: 'points 含无效坐标' }
    out.push(new THREE.Vector3(...v))
  }
  return { vectors: out }
}

function parseProfile2D(points, max = MAX_CURVE_POINTS) {
  if (!Array.isArray(points) || points.length < 2) return { error: 'profile 至少 2 个点' }
  if (points.length > max) return { error: `profile 最多 ${max} 个点` }
  const out = []
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) return { error: 'profile 格式 [[x,y],...]' }
    out.push(new THREE.Vector2(clampN(p[0], -MAX_POS, MAX_POS), clampN(p[1], -MAX_POS, MAX_POS)))
  }
  return { vectors: out }
}

function buildNativeGeometry(type, params = {}) {
  const p = params
  switch (type) {
    case 'BoxGeometry':
      return new THREE.BoxGeometry(gp(p, 'width', 1, 0.01, 500), gp(p, 'height', 1, 0.01, 500), gp(p, 'depth', 1, 0.01, 500))
    case 'SphereGeometry':
      return new THREE.SphereGeometry(gp(p, 'radius', 0.5, 0.01, 500), gp(p, 'widthSegments', 32, 3, 128), gp(p, 'heightSegments', 16, 2, 128))
    case 'PlaneGeometry':
      return new THREE.PlaneGeometry(gp(p, 'width', 1, 0.01, 500), gp(p, 'height', 1, 0.01, 500), gp(p, 'widthSegments', 1, 1, 128), gp(p, 'heightSegments', 1, 1, 128))
    case 'CylinderGeometry':
      return new THREE.CylinderGeometry(gp(p, 'radiusTop', 0.5, 0.01, 500), gp(p, 'radiusBottom', 0.5, 0.01, 500), gp(p, 'height', 1, 0.01, 500), gp(p, 'radialSegments', 32, 3, 128))
    case 'ConeGeometry':
      return new THREE.ConeGeometry(gp(p, 'radius', 0.5, 0.01, 500), gp(p, 'height', 1, 0.01, 500), gp(p, 'radialSegments', 32, 3, 128))
    case 'TorusGeometry':
      return new THREE.TorusGeometry(gp(p, 'radius', 0.5, 0.01, 500), gp(p, 'tube', 0.2, 0.01, 200), gp(p, 'radialSegments', 16, 3, 128), gp(p, 'tubularSegments', 32, 3, 128))
    case 'TorusKnotGeometry':
      return new THREE.TorusKnotGeometry(gp(p, 'radius', 0.4, 0.01, 500), gp(p, 'tube', 0.1, 0.01, 200), gp(p, 'tubularSegments', 64, 3, 256), gp(p, 'radialSegments', 8, 3, 64))
    case 'IcosahedronGeometry':
      return new THREE.IcosahedronGeometry(gp(p, 'radius', 0.5, 0.01, 500), gp(p, 'detail', 0, 0, 8))
    case 'OctahedronGeometry':
      return new THREE.OctahedronGeometry(gp(p, 'radius', 0.5, 0.01, 500), gp(p, 'detail', 0, 0, 8))
    case 'DodecahedronGeometry':
      return new THREE.DodecahedronGeometry(gp(p, 'radius', 0.5, 0.01, 500), gp(p, 'detail', 0, 0, 8))
    case 'TetrahedronGeometry':
      return new THREE.TetrahedronGeometry(gp(p, 'radius', 0.5, 0.01, 500), gp(p, 'detail', 0, 0, 8))
    case 'CapsuleGeometry':
      return new THREE.CapsuleGeometry(gp(p, 'radius', 0.5, 0.01, 500), gp(p, 'length', 1, 0.01, 500), gp(p, 'capSegments', 4, 1, 32), gp(p, 'radialSegments', 8, 3, 64))
    case 'RingGeometry':
      return new THREE.RingGeometry(gp(p, 'innerRadius', 0.3, 0.01, 500), gp(p, 'outerRadius', 0.5, 0.01, 500), gp(p, 'thetaSegments', 32, 3, 128))
    case 'CircleGeometry':
      return new THREE.CircleGeometry(gp(p, 'radius', 0.5, 0.01, 500), gp(p, 'segments', 32, 3, 128))
    case 'LatheGeometry': {
      const parsed = parseProfile2D(p.points)
      if (parsed.error) return null
      return new THREE.LatheGeometry(parsed.vectors, gp(p, 'segments', 32, 3, 128), gp(p, 'phiStart', 0, -Math.PI * 2, Math.PI * 2), gp(p, 'phiLength', Math.PI * 2, 0, Math.PI * 2))
    }
    case 'TubeGeometry': {
      const parsed = parsePath3D(p.points)
      if (parsed.error) return null
      const curve = new THREE.CatmullRomCurve3(parsed.vectors)
      return new THREE.TubeGeometry(curve, gp(p, 'tubularSegments', 64, 8, 256), gp(p, 'radius', 0.2, 0.01, 50), gp(p, 'radialSegments', 8, 3, 64), false)
    }
    default:
      return null
  }
}

function materialOptsFromParams(params = {}) {
  const opts = {}
  if (params.color != null) {
    const c = safeColor(typeof params.color === 'string' && !params.color.startsWith('#') ? `#${params.color}` : String(params.color))
    if (c) opts.color = c
  }
  if (params.emissive != null) {
    const c = safeColor(typeof params.emissive === 'string' && !params.emissive.startsWith('#') ? `#${params.emissive}` : String(params.emissive))
    if (c) opts.emissive = c
  }
  if (params.opacity != null) {
    opts.opacity = clampN(params.opacity, 0, 1)
    opts.transparent = opts.opacity < 1
  }
  if (params.metalness != null) opts.metalness = clampN(params.metalness, 0, 1)
  if (params.roughness != null) opts.roughness = clampN(params.roughness, 0, 1)
  if (params.wireframe != null) opts.wireframe = !!params.wireframe
  if (params.flatShading != null) opts.flatShading = !!params.flatShading
  if (params.side != null) {
    opts.side = typeof params.side === 'string' ? (SIDE_MAP[params.side] ?? THREE.FrontSide) : clampN(params.side, 0, 2)
  }
  if (params.vertexColors != null) opts.vertexColors = !!params.vertexColors
  return opts
}

function buildNativeMaterial(type, params = {}) {
  const map = {
    MeshBasicMaterial: THREE.MeshBasicMaterial,
    MeshStandardMaterial: THREE.MeshStandardMaterial,
    MeshPhongMaterial: THREE.MeshPhongMaterial,
    MeshLambertMaterial: THREE.MeshLambertMaterial,
    MeshNormalMaterial: THREE.MeshNormalMaterial,
    MeshPhysicalMaterial: THREE.MeshPhysicalMaterial,
    MeshToonMaterial: THREE.MeshToonMaterial,
    MeshDepthMaterial: THREE.MeshDepthMaterial,
  }
  const Cls = map[type]
  if (!Cls) return null
  return new Cls(materialOptsFromParams(params))
}

function createGroup(editor, { name, position, parentId } = {}) {
  const group = new THREE.Group()
  group.name = String(name || 'Group').slice(0, 128)
  const pos = safeVec3(position) || [0, 0, 0]
  group.position.set(...pos)
  let parent = editor.scene
  if (parentId != null) {
    const p = find(editor.scene, parentId)
    if (!p) return { error: `未找到 parentId=${parentId}` }
    if (!isEditable(p)) return { error: `parentId=${parentId} 不可作为父节点` }
    parent = p
  }
  parent.add(group)
  editor.transformControls.attach(group)
  return { object: detail(group) }
}

function reparentObject(editor, { id, parentId }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  let parent = editor.scene
  if (parentId != null) {
    const p = find(editor.scene, parentId)
    if (!p) return { error: `未找到 parentId=${parentId}` }
    if (!isEditable(p)) return { error: `parentId=${parentId} 不可作为父节点` }
    parent = p
  }
  parent.attach(obj)
  editor.transformControls.attach(obj)
  return { object: detail(obj), parentId: parent.id ?? null }
}

function cloneObject(editor, { id, name, position, parentId } = {}) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const cloned = obj.clone(true)
  if (name) cloned.name = String(name).slice(0, 128)
  else cloned.name = `${obj.name || 'Object'}_copy`.slice(0, 128)
  if (obj.editorType === 'isInnerMesh') cloned.editorType = 'isInnerMesh'
  const pos = vec3Input(position)
  if (pos) cloned.position.set(...pos)
  let parent = obj.parent || editor.scene
  if (parentId != null) {
    const p = find(editor.scene, parentId)
    if (!p) return { error: `未找到 parentId=${parentId}` }
    if (!isEditable(p)) return { error: `parentId=${parentId} 不可作为父节点` }
    parent = p
  }
  parent.add(cloned)
  editor.transformControls.attach(cloned)
  return { object: detail(cloned), clonedFrom: id }
}

function lookAtObject(editor, { id, target, targetId }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const tp = new THREE.Vector3()
  if (targetId != null) {
    const t = find(editor.scene, targetId)
    if (!t) return { error: `未找到 targetId=${targetId}` }
    t.updateWorldMatrix(true, false)
    t.getWorldPosition(tp)
  } else {
    const t = vec3Input(target)
    if (!t) return { error: 'target 无效，需 [x,y,z] 或 targetId' }
    tp.set(...t)
  }
  obj.lookAt(tp)
  editor.transformControls.attach(obj)
  return { object: detail(obj) }
}

function setMaterial(editor, { id, meshName, materialType, ...rest }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const mesh = resolveMeshTarget(obj, meshName)
  if (!mesh?.isMesh) return { error: meshName ? `未找到子 mesh「${meshName}」` : '对象不是 Mesh，可传 meshName 指定子网格' }
  const params = { ...rest }
  if (materialType) {
    const mat = buildNativeMaterial(materialType, params)
    if (!mat) return { error: `未知材质类型「${materialType}」`, types: MATERIAL_TYPES }
    mesh.material = mat
  } else {
    const mats = [].concat(mesh.material)
    for (const m of mats) {
      const opts = materialOptsFromParams(params)
      if (opts.color && m.color) m.color.set(opts.color)
      if (opts.emissive && m.emissive) m.emissive.set(opts.emissive)
      if (opts.opacity != null) { m.opacity = opts.opacity; m.transparent = opts.transparent ?? m.opacity < 1 }
      if (opts.metalness != null && 'metalness' in m) m.metalness = opts.metalness
      if (opts.roughness != null && 'roughness' in m) m.roughness = opts.roughness
      if (opts.wireframe != null) m.wireframe = opts.wireframe
      if (opts.flatShading != null) m.flatShading = opts.flatShading
      if (opts.side != null) m.side = opts.side
      if (opts.vertexColors != null) m.vertexColors = opts.vertexColors
      m.needsUpdate = true
    }
  }
  editor.transformControls.attach(obj)
  return { object: detail(obj) }
}

function replaceGeometry(editor, { id, meshName, geometryType, params }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const mesh = resolveMeshTarget(obj, meshName)
  if (!mesh?.isMesh) return { error: meshName ? `未找到子 mesh「${meshName}」` : '对象不是 Mesh' }
  const geo = buildNativeGeometry(geometryType, params)
  if (!geo) return { error: `未知几何体「${geometryType}」`, types: GEOMETRY_TYPES }
  safeCall(() => mesh.geometry?.dispose(), 'disposeGeometry')
  mesh.geometry = geo
  editor.transformControls.attach(obj)
  return { object: detail(obj) }
}

async function createMesh(editor, { geometryType, geometryParams, materialType, materialParams, position, rotation, name, parentId, onGround, flat, flyTo }) {
  const geo = buildNativeGeometry(geometryType, geometryParams)
  if (!geo) return { error: `未知几何体「${geometryType}」`, types: GEOMETRY_TYPES }
  const matType = materialType || 'MeshStandardMaterial'
  const mat = buildNativeMaterial(matType, materialParams || { color: '#ffffff' })
  if (!mat) return { error: `未知材质「${matType}」`, types: MATERIAL_TYPES }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.editorType = 'isInnerMesh'
  mesh.name = String(name || geometryType).slice(0, 128)
  const pos = safeVec3(position) || [0, 0, 0]
  mesh.position.set(...pos)
  if (rotation) {
    const rot = safeVec3(rotation, -3600, 3600)
    if (rot) mesh.rotation.set(...rot.map(d => d * Math.PI / 180))
  }
  let parent = editor.scene
  if (parentId != null) {
    const p = find(editor.scene, parentId)
    if (!p) return { error: `未找到 parentId=${parentId}` }
    if (!isEditable(p)) return { error: `parentId=${parentId} 不可作为父节点` }
    parent = p
  }
  parent.add(mesh)
  if (onGround || flat) {
    const res = placeOnGround(editor, { id: mesh.id, flat: !!flat || geometryType === 'PlaneGeometry' })
    if (res.error) return res
    editor.transformControls.attach(mesh)
    if (flyTo) await flyToObject(editor, mesh, 0.3)
    return { object: res.object, placed: { groundY: res.groundY, bottomY: res.bottomY } }
  }
  editor.transformControls.attach(mesh)
  if (flyTo) await flyToObject(editor, mesh, 0.3)
  return { object: detail(mesh) }
}

function addLine(editor, { points, color, name, closed, linewidth }) {
  if (!Array.isArray(points) || points.length < 2) return { error: 'points 至少 2 个点' }
  if (points.length > 500) return { error: 'points 最多 500 个' }
  const verts = []
  for (const p of points) {
    const v = vec3Input(p)
    if (!v) return { error: 'points 含无效坐标' }
    verts.push(...v)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  const hex = safeColor(color?.startsWith?.('#') ? color : `#${color || 'ffffff'}`) || '#ffffff'
  const mat = new THREE.LineBasicMaterial({ color: hex, linewidth: clampN(linewidth ?? 1, 1, 10) })
  const line = closed && points.length >= 3 ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat)
  line.name = String(name || 'Line').slice(0, 128)
  line.editorType = 'isInnerMesh'
  editor.scene.add(line)
  editor.transformControls.attach(line)
  return { object: detail(line) }
}

function addPoints(editor, { points, color, size, name }) {
  if (!Array.isArray(points) || points.length < 1) return { error: 'points 至少 1 个点' }
  if (points.length > 5000) return { error: 'points 最多 5000 个' }
  const verts = []
  for (const p of points) {
    const v = vec3Input(p)
    if (!v) return { error: 'points 含无效坐标' }
    verts.push(...v)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  const hex = safeColor(color?.startsWith?.('#') ? color : `#${color || 'ffffff'}`) || '#ffffff'
  const mat = new THREE.PointsMaterial({ color: hex, size: clampN(size ?? 0.1, 0.01, 50) })
  const pts = new THREE.Points(geo, mat)
  pts.name = String(name || 'Points').slice(0, 128)
  pts.editorType = 'isInnerMesh'
  editor.scene.add(pts)
  editor.transformControls.attach(pts)
  return { object: detail(pts) }
}

async function createBufferMesh(editor, { positions, indices, colors, materialType, materialParams, name, position, parentId, onGround, flat, flyTo }) {
  if (!Array.isArray(positions) || positions.length < 9) return { error: 'positions 至少 3 个顶点(9 个数)' }
  if (positions.length % 3 !== 0) return { error: 'positions 长度须为 3 的倍数' }
  if (positions.length > 15000) return { error: 'positions 最多 5000 顶点' }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (colors != null) {
    if (!Array.isArray(colors) || colors.length !== positions.length) return { error: 'colors 长度须与 positions 相同' }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  }
  if (indices != null) {
    if (!Array.isArray(indices) || !indices.length) return { error: 'indices 须为非空数组' }
    if (indices.length > 50000) return { error: 'indices 过多' }
    geo.setIndex(indices)
  }
  const matType = materialType || 'MeshStandardMaterial'
  const mat = buildNativeMaterial(matType, materialParams || { color: '#ffffff' })
  if (!mat) return { error: `未知材质「${matType}」`, types: MATERIAL_TYPES }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.editorType = 'isInnerMesh'
  mesh.name = String(name || 'BufferMesh').slice(0, 128)
  mesh.position.set(...(safeVec3(position) || [0, 0, 0]))
  let parent = editor.scene
  if (parentId != null) {
    const p = find(editor.scene, parentId)
    if (!p) return { error: `未找到 parentId=${parentId}` }
    if (!isEditable(p)) return { error: `parentId=${parentId} 不可作为父节点` }
    parent = p
  }
  parent.add(mesh)
  if (onGround || flat) {
    const res = placeOnGround(editor, { id: mesh.id, flat: !!flat })
    if (res.error) return res
    editor.transformControls.attach(mesh)
    if (flyTo) await flyToObject(editor, mesh, 0.3)
    return { object: res.object, placed: { groundY: res.groundY, bottomY: res.bottomY }, vertexCount: positions.length / 3 }
  }
  editor.transformControls.attach(mesh)
  if (flyTo) await flyToObject(editor, mesh, 0.3)
  return { object: detail(mesh), vertexCount: positions.length / 3 }
}

function addSprite(editor, { text, textureUrl, position, color, fontSize, name }) {
  if (!text && !textureUrl) return { error: 'text 或 textureUrl 至少填一个' }
  const pos = safeVec3(position) || [0, 1, 0]
  if (textureUrl) {
    if (!textureUrl.startsWith('http')) return { error: 'textureUrl 需为 http(s) 地址' }
    return new Promise(resolve => {
      new THREE.TextureLoader().load(
        textureUrl,
        tex => {
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
          sprite.name = String(name || 'Sprite').slice(0, 128)
          sprite.position.set(...pos)
          attachObject(editor, sprite)
          resolve({ object: detail(sprite), textureUrl })
        },
        undefined,
        err => resolve({ error: `纹理加载失败: ${err?.message || textureUrl}` }),
      )
    })
  }
  const sprite = createSpriteText({ text: String(text).slice(0, 256), color, fontSize })
  sprite.name = String(name || String(text).slice(0, 16)).slice(0, 128)
  sprite.position.set(...pos)
  attachObject(editor, sprite)
  return { object: detail(sprite), text: String(text).slice(0, 64) }
}

async function createInstancedMesh(editor, { geometryType, geometryParams, materialType, materialParams, count, instances, name, position, parentId, flyTo }) {
  const n = clampN(count ?? 1, 1, MAX_INSTANCES)
  const geo = buildNativeGeometry(geometryType, geometryParams || {})
  if (!geo) return { error: `geometry 无效「${geometryType}」`, types: GEOMETRY_TYPES, hint: 'LatheGeometry/TubeGeometry 需 geometryParams.points' }
  const matType = materialType || 'MeshStandardMaterial'
  const mat = buildNativeMaterial(matType, materialParams || { color: '#ffffff' })
  if (!mat) return { error: `未知材质「${matType}」`, types: MATERIAL_TYPES }
  const mesh = new THREE.InstancedMesh(geo, mat, n)
  mesh.editorType = 'isInnerMesh'
  mesh.name = String(name || 'InstancedMesh').slice(0, 128)
  mesh.position.set(...(safeVec3(position) || [0, 0, 0]))
  const dummy = new THREE.Object3D()
  const list = Array.isArray(instances) ? instances.slice(0, n) : []
  for (let i = 0; i < n; i++) {
    const inst = list[i] || {}
    dummy.position.set(...(safeVec3(inst.position) || [0, 0, 0]))
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(1, 1, 1)
    if (inst.rotation) {
      const rot = safeVec3(inst.rotation, -3600, 3600)
      if (rot) dummy.rotation.set(...rot.map(d => d * Math.PI / 180))
    }
    if (inst.scale != null) {
      const s = safeScaleVec(Array.isArray(inst.scale) ? inst.scale : null)
      if (s) dummy.scale.set(...s)
      else if (typeof inst.scale === 'number') dummy.scale.setScalar(clampN(inst.scale, MIN_SCALE, MAX_SCALE))
    }
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  let parent = editor.scene
  if (parentId != null) {
    const p = find(editor.scene, parentId)
    if (!p) return { error: `未找到 parentId=${parentId}` }
    if (!isEditable(p)) return { error: `parentId=${parentId} 不可作为父节点` }
    parent = p
  }
  parent.add(mesh)
  editor.transformControls.attach(mesh)
  if (flyTo) await flyToObject(editor, mesh, 0.3)
  return { object: detail(mesh), count: n }
}

async function createLatheMesh(editor, { profile, segments, materialType, materialParams, name, position, parentId, onGround, flyTo }) {
  const geo = buildNativeGeometry('LatheGeometry', { points: profile, segments })
  if (!geo) return { error: 'profile 无效，需 [[x,y],...] 至少 2 点' }
  const mat = buildNativeMaterial(materialType || 'MeshStandardMaterial', materialParams || { color: '#ffffff' })
  if (!mat) return { error: '材质无效', types: MATERIAL_TYPES }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.editorType = 'isInnerMesh'
  mesh.name = String(name || 'LatheMesh').slice(0, 128)
  mesh.position.set(...(safeVec3(position) || [0, 0, 0]))
  let parent = editor.scene
  if (parentId != null) {
    const p = find(editor.scene, parentId)
    if (!p) return { error: `未找到 parentId=${parentId}` }
    if (!isEditable(p)) return { error: `parentId=${parentId} 不可作为父节点` }
    parent = p
  }
  parent.add(mesh)
  if (onGround) {
    const res = placeOnGround(editor, { id: mesh.id })
    if (res.error) return res
    editor.transformControls.attach(mesh)
    if (flyTo) await flyToObject(editor, mesh, 0.3)
    return { object: res.object, placed: { groundY: res.groundY, bottomY: res.bottomY } }
  }
  editor.transformControls.attach(mesh)
  if (flyTo) await flyToObject(editor, mesh, 0.3)
  return { object: detail(mesh) }
}

async function addTubeMesh(editor, { points, radius, tubularSegments, radialSegments, materialType, materialParams, name, position, parentId, flyTo }) {
  const geo = buildNativeGeometry('TubeGeometry', { points, radius, tubularSegments, radialSegments })
  if (!geo) return { error: 'points 无效，需 [[x,y,z],...] 至少 2 点' }
  const mat = buildNativeMaterial(materialType || 'MeshStandardMaterial', materialParams || { color: '#ffffff' })
  if (!mat) return { error: '材质无效', types: MATERIAL_TYPES }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.editorType = 'isInnerMesh'
  mesh.name = String(name || 'TubeMesh').slice(0, 128)
  mesh.position.set(...(safeVec3(position) || [0, 0, 0]))
  let parent = editor.scene
  if (parentId != null) {
    const p = find(editor.scene, parentId)
    if (!p) return { error: `未找到 parentId=${parentId}` }
    if (!isEditable(p)) return { error: `parentId=${parentId} 不可作为父节点` }
    parent = p
  }
  parent.add(mesh)
  editor.transformControls.attach(mesh)
  if (flyTo) await flyToObject(editor, mesh, 0.3)
  return { object: detail(mesh) }
}

function updateMeshGeometry(editor, { id, meshName, computeNormals, center, computeBounds }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const mesh = resolveMeshTarget(obj, meshName)
  if (!mesh?.geometry) return { error: meshName ? `未找到子 mesh「${meshName}」` : '对象无 geometry' }
  const geo = mesh.geometry
  const done = []
  if (computeNormals) { geo.computeVertexNormals(); done.push('normals') }
  if (center) { geo.center(); done.push('center') }
  if (computeBounds) { geo.computeBoundingBox(); geo.computeBoundingSphere(); done.push('bounds') }
  if (!done.length) return { error: '至少指定 computeNormals / center / computeBounds 之一' }
  editor.transformControls.attach(obj)
  return { id: obj.id, updated: done }
}

function addMeshWireframe(editor, { id, meshName, mode = 'edges', color, thresholdAngle, name }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const mesh = resolveMeshTarget(obj, meshName)
  if (!mesh?.geometry) return { error: meshName ? `未找到子 mesh「${meshName}」` : '对象无 geometry' }
  const hex = safeColor(color?.startsWith?.('#') ? color : `#${color || 'ffffff'}`) || '#ffffff'
  const geo = mode === 'wireframe'
    ? new THREE.WireframeGeometry(mesh.geometry)
    : new THREE.EdgesGeometry(mesh.geometry, clampN(thresholdAngle ?? 15, 1, 90))
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: hex }))
  line.name = String(name || `${mesh.name || 'Mesh'}_${mode}`).slice(0, 128)
  line.editorType = 'isInnerMesh'
  mesh.add(line)
  editor.transformControls.attach(obj)
  return { object: detail(line), parentId: mesh.id, mode }
}

function setSceneProps(editor, { background, fog }) {
  const scene = editor.scene
  const out = {}
  if (background !== undefined) {
    if (background === null || background === 'none') {
      scene.background = null
      out.background = null
    } else {
      const c = safeColor(typeof background === 'string' && !background.startsWith('#') ? `#${background}` : String(background))
      if (!c) return { error: 'background 无效，需 #rrggbb 或 null' }
      scene.background = new THREE.Color(c)
      out.background = c
    }
  }
  if (fog !== undefined) {
    if (fog === null || fog.type === 'none') {
      scene.fog = null
      out.fog = null
    } else {
      const fc = safeColor(typeof fog.color === 'string' && !fog.color?.startsWith('#') ? `#${fog.color}` : String(fog.color || '#cccccc'))
      if (!fc) return { error: 'fog.color 无效' }
      if (fog.type === 'FogExp2') {
        scene.fog = new THREE.FogExp2(fc, clampN(fog.density ?? 0.00025, 0, 0.01))
      } else {
        scene.fog = new THREE.Fog(fc, clampN(fog.near ?? 1, 0.01, 1e4), clampN(fog.far ?? 1000, 1, 1e6))
      }
      out.fog = { type: scene.fog.constructor.name, color: fc }
    }
  }
  return out
}

function applyTexture(editor, { id, url, map, meshName }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  const channel = map || 'map'
  if (!TEXTURE_MAPS.includes(channel)) return { error: `不支持的 map: ${channel}`, allowed: TEXTURE_MAPS }
  const mesh = resolveMeshTarget(obj, meshName)
  if (!mesh?.material) return { error: meshName ? `未找到子 mesh「${meshName}」` : '对象无 material' }
  if (!url?.startsWith('http')) return { error: 'url 需为 http(s) 地址' }
  return new Promise(resolve => {
    new THREE.TextureLoader().load(
      url,
      tex => {
        [].concat(mesh.material).forEach(m => { m[channel] = tex; m.needsUpdate = true })
        editor.transformControls.attach(obj)
        resolve({ object: detail(obj), texture: { url, map: channel } })
      },
      undefined,
      err => resolve({ error: `纹理加载失败: ${err?.message || url}` }),
    )
  })
}

function setLightProps(editor, { id, target, castShadow, distance, angle, penumbra, decay, shadowBias, shadowMapSize }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  if (!obj.isLight) return { error: '对象不是灯光，用 addLight 添加' }
  if (target && obj.target) {
    const t = vec3Input(target)
    if (!t) return { error: 'target 无效' }
    if (!obj.target.parent) editor.scene.add(obj.target)
    obj.target.position.set(...t)
  }
  if (castShadow != null) obj.castShadow = !!castShadow
  if (distance != null && 'distance' in obj) obj.distance = clampN(distance, 0, MAX_POS)
  if (angle != null && 'angle' in obj) obj.angle = clampN(angle, 0, Math.PI)
  if (penumbra != null && 'penumbra' in obj) obj.penumbra = clampN(penumbra, 0, 1)
  if (decay != null && 'decay' in obj) obj.decay = clampN(decay, 0, 10)
  if (shadowBias != null && obj.shadow) obj.shadow.bias = clampN(shadowBias, -0.01, 0.01)
  if (shadowMapSize != null && obj.shadow?.mapSize) {
    const s = clampN(shadowMapSize, 256, 4096)
    obj.shadow.mapSize.set(s, s)
  }
  editor.transformControls.attach(obj)
  return { object: detail(obj) }
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

function refreshEditorGrid(editor) {
  const g = editor.handler?.helpers?.grid
  if (!g) return
  const scene = editor.scene
  if (g.gridHelper) {
    scene.remove(g.gridHelper)
    g.gridHelper.geometry?.dispose()
    const m = g.gridHelper.material
    ;[].concat(m).forEach(x => x?.dispose?.())
    g.gridHelper = null
  }
  if (g.showGrid) {
    g.gridHelper = new THREE.GridHelper(g.size, g.divisions, g.colorCenterLine ?? 0x444444, g.colorGrid ?? 0x888888)
    scene.add(g.gridHelper)
  }
}

function applyHelpersPatch(editor, { grid, axes, box3 } = {}) {
  const h = editor.handler?.helpers
  if (!h) return { error: '编辑器 helpers 未就绪' }
  let needGridRefresh = false
  const g = h.grid
  const ax = h.axes
  const b = h.box3
  if (grid && g) {
    if (grid.showGrid != null) { g.showGrid = !!grid.showGrid; if (g.showGrid) needGridRefresh = true }
    if (grid.size != null) { g.size = clampN(grid.size, 1, 10000); needGridRefresh = true }
    if (grid.divisions != null) { g.divisions = clampN(grid.divisions, 1, 200); needGridRefresh = true }
    if (grid.colorCenterLine != null) {
      const c = safeHexInt(grid.colorCenterLine)
      if (c != null) { g.colorCenterLine = c; needGridRefresh = true }
    }
    if (grid.colorGrid != null) {
      const c = safeHexInt(grid.colorGrid)
      if (c != null) { g.colorGrid = c; needGridRefresh = true }
    }
  }
  if (axes && ax) {
    if (axes.showAxes != null) ax.showAxes = !!axes.showAxes
    if (axes.axesLength != null) ax.axesLength = clampN(axes.axesLength, 1, 10000)
  }
  if (box3 && b) {
    if (box3.useBox3 != null) b.useBox3 = !!box3.useBox3
    if (box3.color != null) {
      const c = safeHexInt(box3.color)
      if (c != null) b.color = c
    }
  }
  if (needGridRefresh) safeCall(() => refreshEditorGrid(editor), 'refreshGrid')
  return null
}

function readHelpersSnapshot(editor) {
  const g = editor.handler?.helpers?.grid
  const ax = editor.handler?.helpers?.axes
  const b = editor.handler?.helpers?.box3
  return {
    grid: g?.showGrid ?? null,
    axes: ax?.showAxes ?? null,
    size: g?.size != null ? r(g.size) : null,
    divisions: g?.divisions ?? null,
    cellSize: g?.size && g?.divisions ? r(g.size / g.divisions) : null,
    colorCenterLine: g?.colorCenterLine ?? null,
    colorGrid: g?.colorGrid ?? null,
    axesLength: ax?.axesLength != null ? r(ax.axesLength) : null,
    useBox3: b?.useBox3 ?? null,
    box3Color: b?.color ?? null,
  }
}

function setHelpers(editor, input = {}) {
  const { grid, axes, size, divisions, colorCenterLine, colorGrid, axesLength, useBox3, box3Color } = input
  const helpers = {}
  if (grid != null || size != null || divisions != null || colorCenterLine != null || colorGrid != null) {
    helpers.grid = {}
    if (grid != null) helpers.grid.showGrid = !!grid
    if (size != null) helpers.grid.size = size
    if (divisions != null) helpers.grid.divisions = divisions
    if (colorCenterLine != null) helpers.grid.colorCenterLine = colorCenterLine
    if (colorGrid != null) helpers.grid.colorGrid = colorGrid
  }
  if (axes != null || axesLength != null) {
    helpers.axes = {}
    if (axes != null) helpers.axes.showAxes = !!axes
    if (axesLength != null) helpers.axes.axesLength = axesLength
  }
  if (useBox3 != null || box3Color != null) {
    helpers.box3 = {}
    if (useBox3 != null) helpers.box3.useBox3 = !!useBox3
    if (box3Color != null) helpers.box3.color = box3Color
  }
  const err = applyHelpersPatch(editor, helpers)
  if (err) return err
  return readHelpersSnapshot(editor)
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

const EDITOR_SETTING_KEYS = ['scene', 'perspectiveCamera', 'webglRenderer', 'orbitControls', 'transformControls', 'effectComposer', 'handler', 'other']
const EFFECT_PASS_KEYS = new Set(['fxaaPass', 'outlinePass', 'outputPass', 'saoPass', 'screenMaskPass', 'ssrPass', 'unrealBloomPass'])
const RENDER_WAYS = new Set(['effectComposer', 'webglRenderer'])
const TC_MODES = new Set(['translate', 'rotate', 'scale'])
const TC_SPACES = new Set(['world', 'local'])
const HANDLER_MODES = new Set(['transform', 'select', 'none'])
const OUTPUT_COLOR_SPACES = new Set(['srgb', 'srgb-linear', 'display-p3', 'linear-srgb'])
const RENDER_LIST_NAMES = new Set(['stats', 'controls', 'scene', 'css3DRender', 'css2DRender'])
const BASIC_PANELS = ['渲染配置', '相机配置', '轨道配置', '变换配置', '环境配置', '后期处理']
const OBJECT_PANELS = {
  basicConf: '基础配置',
  materialConf: '材质配置',
  shaderConf: '着色配置',
  relatedConf: '相关配置',
}

export function getEditorSettings(editor) {
  const saved = editor.saveSceneEdit?.()
  if (!saved) return { error: '编辑器未就绪' }
  const out = {}
  for (const k of EDITOR_SETTING_KEYS) if (saved[k]) out[k] = saved[k]
  return out
}

function patchSceneSettings(scene, p) {
  if (p.backgroundBlurriness != null) scene.backgroundBlurriness = clampN(p.backgroundBlurriness, 0, 1)
  if (p.backgroundIntensity != null) scene.backgroundIntensity = clampN(p.backgroundIntensity, 0, 10)
  if (p.environmentEnabled != null) scene.environmentEnabled = !!p.environmentEnabled
}

function patchCameraSettings(cam, p) {
  if (p.fov != null) cam.fov = clampN(p.fov, 1, 179)
  if (p.near != null) cam.near = clampN(p.near, 0.001, 1000)
  if (p.far != null) cam.far = clampN(p.far, 1, 1e7)
  if (cam.near >= cam.far) return { error: 'perspectiveCamera: near 必须小于 far' }
  if (p.zoom != null) cam.zoom = clampN(p.zoom, 0.01, 10)
  if (p.filmOffset != null) cam.filmOffset = clampN(p.filmOffset, -10, 10)
  if (p.filmGauge != null) cam.filmGauge = clampN(p.filmGauge, 1, 100)
  if (p.position) {
    const pos = vec3Input(p.position)
    if (!pos) return { error: 'perspectiveCamera.position 无效' }
    cam.position.set(...pos)
  }
  safeCall(() => cam.updateProjectionMatrix?.(), 'updateProjectionMatrix')
  return null
}

function patchRendererSettings(r, p) {
  if (p.outputColorSpace != null) {
    if (!OUTPUT_COLOR_SPACES.has(p.outputColorSpace)) return { error: `webglRenderer.outputColorSpace 无效: ${p.outputColorSpace}` }
    r.outputColorSpace = p.outputColorSpace
  }
  if (p.toneMapping != null) r.toneMapping = clampN(p.toneMapping, 0, 7)
  if (p.toneMappingExposure != null) r.toneMappingExposure = clampN(p.toneMappingExposure, 0, 10)
  if (p.color != null) {
    const c = safeHexInt(p.color)
    if (c != null) r.setClearColor?.(c, r.getClearAlpha?.() ?? 0)
  }
  if (p.opacity != null) r.setClearAlpha?.(clampN(p.opacity, 0, 1))
  if (p.shadowMap) {
    if (p.shadowMap.enabled != null) r.shadowMap.enabled = !!p.shadowMap.enabled
    if (p.shadowMap.type != null) r.shadowMap.type = clampN(p.shadowMap.type, 0, 2)
  }
  if (p.sortObjects != null) r.sortObjects = !!p.sortObjects
  if (p.localClippingEnabled != null) r.localClippingEnabled = !!p.localClippingEnabled
  if (p.autoClear != null) r.autoClear = !!p.autoClear
  if (p.autoClearColor != null) r.autoClearColor = !!p.autoClearColor
  p.renderListCompare?.forEach(item => {
    if (!RENDER_LIST_NAMES.has(item.name)) return
    const hit = r.renderListCompare?.find(x => x.name === item.name)
    if (hit && item.enabled != null) hit.enabled = !!item.enabled
  })
  safeCall(() => r.refreshRenderList?.(), 'refreshRenderList')
  return null
}

function patchControlsSettings(c, p) {
  const setB = (k) => { if (p[k] != null) c[k] = !!p[k] }
  const setN = (k, lo, hi) => { if (p[k] != null) c[k] = clampN(p[k], lo, hi) }
  setB('autoRotate'); setN('autoRotateSpeed', 0, 30)
  setB('enableDamping'); setN('dampingFactor', 0, 1)
  setN('minDistance', 0, MAX_POS); setN('maxDistance', 0, MAX_POS)
  if (p.maxAzimuthAngle != null) c.maxAzimuthAngle = clampN(p.maxAzimuthAngle, -Math.PI * 4, Math.PI * 4)
  if (p.minAzimuthAngle != null) c.minAzimuthAngle = clampN(p.minAzimuthAngle, -Math.PI * 4, Math.PI * 4)
  setN('maxPolarAngle', 0, Math.PI * 2); setN('minPolarAngle', 0, Math.PI * 2)
  setN('maxTargetRadius', 0, MAX_POS); setN('minTargetRadius', 0, MAX_POS)
  setB('enablePan'); setN('panSpeed', 0, 10)
  setB('enableRotate'); setN('rotateSpeed', 0, 10)
  setB('enableZoom'); setN('zoomSpeed', 0, 10)
  setB('zoomToCursor')
  if (p.target) {
    const t = vec3Input(p.target)
    if (!t) return { error: 'orbitControls.target 无效' }
    c.target.set(...t)
  }
  safeCall(() => c.update?.(), 'controls.update')
  return null
}

function patchTransformControlsSettings(tc, p) {
  if (p.mode != null) {
    if (!TC_MODES.has(p.mode)) return { error: `transformControls.mode 无效: ${p.mode}` }
    tc.mode = p.mode
  }
  if (p.space != null) {
    if (!TC_SPACES.has(p.space)) return { error: `transformControls.space 无效: ${p.space}` }
    tc.space = p.space
  }
  if (p.size != null) tc.size = clampN(p.size, 0.1, 5)
  if (p.showX != null) tc.showX = !!p.showX
  if (p.showY != null) tc.showY = !!p.showY
  if (p.showZ != null) tc.showZ = !!p.showZ
  if ('translationSnap' in p) tc.translationSnap = p.translationSnap === null ? null : clampN(p.translationSnap, 0, 100)
  if ('rotationSnap' in p) tc.rotationSnap = p.rotationSnap === null ? null : clampN(p.rotationSnap, 0, Math.PI)
  if ('scaleSnap' in p) tc.scaleSnap = p.scaleSnap === null ? null : clampN(p.scaleSnap, 0, 10)
  return null
}

function patchHandlerSettings(editor, p) {
  const h = editor.handler
  if (!h) return { error: '编辑器 handler 未就绪' }
  if (p.mode != null) {
    if (!HANDLER_MODES.has(p.mode)) return { error: `handler.mode 无效: ${p.mode}` }
    h.mode = p.mode
  }
  if (p.selectChildEnabled != null) h.selectChildEnabled = !!p.selectChildEnabled
  if (p.selectChildLevel != null) h.selectChildLevel = clampN(p.selectChildLevel, 1, 10)
  if (p.stats) {
    if (p.stats.showStats != null) h.stats.showStats = !!p.stats.showStats
    if (p.stats.statsMode != null) h.stats.statsMode = clampN(p.stats.statsMode, 0, 2)
  }
  if (p.helpers) {
    const err = applyHelpersPatch(editor, p.helpers)
    if (err) return err
  }
  return null
}

function patchOtherSettings(editor, p) {
  const other = editor.other
  if (!other) return { error: '编辑器 other 未就绪' }
  if (p.clipping?.size != null) {
    if (!other.clipping) other.clipping = { size: 20, clipList: [] }
    other.clipping.size = clampN(p.clipping.size, 0.1, 1000)
  }
  return null
}

function patchEffectComposerSettings(ec, p) {
  const skipped = []
  if (p.renderWay != null) {
    if (!RENDER_WAYS.has(p.renderWay)) {
      skipped.push(`renderWay:${p.renderWay}`)
    } else {
      ec.renderWay = p.renderWay
    }
  }
  const ep = ec?.effectPass
  if (!ep) return skipped
  for (const [key, val] of Object.entries(p)) {
    if (key === 'renderWay' || val == null || typeof val !== 'object') continue
    if (!EFFECT_PASS_KEYS.has(key)) { skipped.push(key); continue }
    const pass = ep[key]
    if (!pass) { skipped.push(key); continue }
    try {
      if (val.enabled != null) pass.enabled = !!val.enabled
      if (val.order != null) pass.order = clampN(val.order, 0, 100)
      pass.originInfo?.setStorage?.(pass, val)
    } catch { skipped.push(key) }
  }
  safeCall(() => ec.refreshPassSort?.(), 'refreshPassSort')
  return skipped
}

function setEditorSettings(editor, input) {
  const keys = Object.keys(input)
  const unknown = keys.filter(k => !EDITOR_SETTING_KEYS.includes(k))
  if (unknown.length) return { error: `未知配置段: ${unknown.join(', ')}`, allowed: EDITOR_SETTING_KEYS }
  if (!keys.length) return { error: '未提供任何配置' }

  if (input.scene) patchSceneSettings(editor.scene, input.scene)
  let err = input.perspectiveCamera ? patchCameraSettings(editor.camera, input.perspectiveCamera) : null
  if (err) return err
  err = input.webglRenderer ? patchRendererSettings(editor.renderer, input.webglRenderer) : null
  if (err) return err
  err = input.orbitControls ? patchControlsSettings(editor.controls, input.orbitControls) : null
  if (err) return err
  err = input.transformControls ? patchTransformControlsSettings(editor.transformControls, input.transformControls) : null
  if (err) return err
  err = input.handler ? patchHandlerSettings(editor, input.handler) : null
  if (err) return err
  err = input.other ? patchOtherSettings(editor, input.other) : null
  if (err) return err
  const passSkipped = input.effectComposer
    ? patchEffectComposerSettings(editor.effectComposer, input.effectComposer)
    : []
  const result = getEditorSettings(editor)
  if (passSkipped.length) result.passSkipped = passSkipped
  return result
}

// ── ThreeEditor / lib API ──

export function getEditorApi(editor) {
  const hh = editor.handler?.handlerHistory
  const r = editor.renderer
  return {
    threeEditor: {
      core: ['scene', 'camera', 'renderer', 'controls', 'transformControls', 'effectComposer', 'css3DRender', 'css2DRender', 'stats', 'DOM'],
      methods: ['saveSceneEdit', 'resetEditorStorage', 'openControlPanel', 'getSceneEditorImage', 'getSceneEvent', 'setOutlinePass', 'setCss2dDOM', 'setCss3dDOM', 'renderSceneResize'],
      cores: ['modelCores', 'shaderCores', 'handler', 'other', 'innerCores', 'lightCores', 'drawCores', 'textCores', 'particleCores', 'designCores'].filter(k => editor[k]),
      panelApi: {
        basic: BASIC_PANELS,
        object: Object.entries(OBJECT_PANELS).map(([key, name]) => ({ key, name })),
      },
    },
    lib: {
      exports: ['getObjectViews', 'getObjectBox3', 'createGsapAnimation', 'restoreHistoryHandler', 'getMaterials', 'objectChangeTransform', 'cloneObjectMaterial', 'createSpriteText', 'setGsapMeshAction'],
      usedByAi: ['getObjectViews', 'createGsapAnimation', 'restoreHistoryHandler', 'getObjectBox3', 'getMaterials', 'createSpriteText', 'setGsapMeshAction'],
    },
    sceneApi: {
      attach_add: 'scene.attach_add(obj) = add + transformControls.attach，与 GUI 一致',
      setSceneBackground: '六面 skybox；runEditorAction setSceneSkybox 或 setSky',
      setEnvBackground: 'IBL 环境；runEditorAction setSceneEnvironment 或 setEnv',
    },
    threeJsNative: {
      tools: NATIVE_TOOL_NAMES,
      lightTypes: NATIVE_LIGHT_TYPES,
      geometries: GEOMETRY_TYPES,
      materials: MATERIAL_TYPES,
      hint: 'listCatalog.threeJs 查类名；原生优先于 runEditorAction',
    },
    tools: {
      openControlBoard: 'openEditorPanel({ openMain: true })',
      openRendererPanel: 'openEditorPanel({ panel: "渲染配置" })',
      openCorePanel: 'runEditorAction({ action: "openCorePanel", params: { panel: "textCores" } })',
      openTheatrePanel: 'runEditorAction({ action: "openOtherPanel", params: { panel: "编辑动画" } })',
      innerMesh: 'addMesh(中文几何) 或 runEditorAction addInnerMesh(geometryType 类名)',
      blendShader: 'runEditorAction listBlendShaders → applyBlendShader({ id, shaderName })',
      coreModelLoad: 'addModel 或 runEditorAction loadOnlineModel（modelCores + attach_add）',
      anyCapability: 'listEditorActions → runEditorAction({ action, params })',
      changeRendererValues: 'setEditorSettings({ webglRenderer: {...} })',
      undo: 'undoEditor()',
      save: 'saveEditorScene()',
      screenshot: 'captureScreenshot({ download: true })',
    },
    actionCatalog: `listEditorActions 共 ${Object.keys(EDITOR_ACTIONS).length} 个 runEditorAction`,
    runtime: {
      selectedId: editor.transformControls?.object?.id ?? null,
      handlerMode: editor.handler?.mode ?? null,
      transformMode: editor.transformControls?.mode ?? null,
      guiReady: !!editor.GUI,
      guiFolders: editor.GUI?.children?.map(f => f._title).filter(Boolean) ?? [],
      renderer: r ? {
        shadowMap: !!r.shadowMap?.enabled,
        toneMapping: r.toneMapping,
        toneMappingExposure: r.toneMappingExposure,
        outputColorSpace: r.outputColorSpace,
      } : null,
      history: hh ? { undoStack: hh.list?.length ?? 0, redoStack: hh.reList?.length ?? 0, index: hh.index } : null,
      sceneName: localStorage.getItem('new_sceneName') || null,
    },
    settingsSections: EDITOR_SETTING_KEYS,
  }
}

export function openEditorPanel(editor, { panel, openMain = true } = {}) {
  if (!editor.GUI) return { error: '编辑器 GUI 未就绪' }
  if (openMain && editor.GUI.children.length <= 1) editor.openControlPanel?.()
  if (!panel) {
    return {
      opened: openMain ? '控制板(操作/场景/核心/其他)' : null,
      basicPanels: BASIC_PANELS,
      hint: '传 panel:"渲染配置" 打开渲染器配置浮动窗；改数值也可用 setEditorSettings',
    }
  }
  const api = editor.panelApi?.basicPanelApi
  if (!api) return { error: 'panelApi 不可用' }
  const openers = {
    '渲染配置': () => api.setWebGLRendererPanel(editor.renderer, editor.GUI.addDragFolder('渲染配置')),
    '相机配置': () => api.setPerspectiveCameraPanel(editor.camera, editor.GUI.addDragFolder('相机配置')),
    '轨道配置': () => api.setOrbitControlsPanel(editor.controls, editor.GUI.addDragFolder('轨道配置')),
    '变换配置': () => api.setTransformControlsPanel(editor.transformControls, editor.GUI.addDragFolder('变换配置')),
    '环境配置': () => api.setScenePanel(editor.scene, editor.GUI.addDragFolder('环境配置')),
    '后期处理': () => api.setEffectComposerPanel(editor.effectComposer, editor.GUI.addDragFolder('后期处理')),
  }
  const open = openers[panel]
  if (!open) return { error: `未知 panel「${panel}」`, panels: BASIC_PANELS }
  open()
  return { opened: panel, type: 'floating_gui' }
}

function openObjectPanel(editor, { id, panel = 'materialConf' }) {
  const { obj, error } = findEditable(editor.scene, id)
  if (error) return { error }
  if (!OBJECT_PANELS[panel]) return { error: `未知 panel「${panel}」`, panels: Object.keys(OBJECT_PANELS) }
  if (!editor.handler?.setActivePanel) return { error: 'setActivePanel 不可用' }
  if (!editor.GUI) return { error: 'GUI 未就绪' }
  if (editor.GUI.children.length <= 1) editor.openControlPanel?.()
  editor.transformControls.attach(obj)
  editor.handler.setActivePanel({}, { key: panel })
  return { opened: OBJECT_PANELS[panel], panel, id: obj.id, name: obj.name || '(未命名)' }
}

function undoEditor(editor) {
  const hh = editor.handler?.handlerHistory
  if (!hh) return { error: '撤销栈不可用' }
  const idx = hh.index
  restoreHistoryHandler(hh, 'z')
  return { undone: hh.index !== idx, index: hh.index, undoStack: hh.list?.length ?? 0 }
}

function redoEditor(editor) {
  const hh = editor.handler?.handlerHistory
  if (!hh) return { error: '重做栈不可用' }
  const idx = hh.index
  restoreHistoryHandler(hh, 'y')
  return { redone: hh.index !== idx, index: hh.index, redoStack: hh.reList?.length ?? 0 }
}

function saveEditorScene(editor, { sceneName } = {}) {
  const data = editor.saveSceneEdit?.()
  if (!data) return { error: 'saveSceneEdit 不可用' }
  const name = String(sceneName || localStorage.getItem('new_sceneName') || '三维测试').slice(0, 64)
  localStorage.setItem(`${name}-newEditor`, JSON.stringify(data))
  localStorage.setItem('new_sceneName', name)
  return { saved: name }
}

function exportSceneJson(editor, { download = true, sceneName } = {}) {
  const data = editor.saveSceneEdit?.()
  if (!data) return { error: 'saveSceneEdit 不可用' }
  const name = sceneName || localStorage.getItem('new_sceneName') || '场景'
  if (download) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${name}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }
  return { exported: name, keys: Object.keys(data), downloaded: download }
}

function exportSceneGlb(editor, { sceneName } = {}) {
  const exportObjects = []
  editor.scene.children.forEach(child => {
    if (
      child.isTransformControls || child.type === 'TransformControls' || child.type === 'TransformControlsPlane'
      || child.isHelper || child.type.includes('Helper') || !child.visible
    ) return
    if ((child.isMesh || child.isGroup || child.isObject3D || child.isLine) && !child.isLight && !child.isPoints) {
      exportObjects.push(child)
    }
  })
  if (!exportObjects.length) return { error: '场景中没有可导出的模型' }
  const exportScene = new THREE.Scene()
  exportObjects.forEach(obj => exportScene.add(obj.clone(true)))
  const name = sceneName || localStorage.getItem('new_sceneName') || '场景'
  return new Promise(resolve => {
    new GLTFExporter().parse(
      exportScene,
      result => {
        const blob = new Blob([result instanceof ArrayBuffer ? result : JSON.stringify(result)], {
          type: result instanceof ArrayBuffer ? 'model/gltf-binary' : 'model/gltf+json',
        })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `${name}.glb`
        link.click()
        URL.revokeObjectURL(link.href)
        resolve({ exported: `${name}.glb`, objectCount: exportObjects.length })
      },
      err => resolve({ error: `GLB 导出失败: ${err?.message || String(err)}` }),
      { binary: true, embedImages: true },
    )
  })
}

function captureScreenshot(editor, { download = true, quality = 0.8 } = {}) {
  const base64 = editor.getSceneEditorImage?.(['image/png', String(clampN(quality, 0.1, 1))])
  if (!base64) return { error: 'getSceneEditorImage 不可用' }
  const name = localStorage.getItem('new_sceneName') || '场景'
  if (download) {
    const link = document.createElement('a')
    link.href = base64
    link.download = `${name}.png`
    link.click()
  }
  return { captured: true, downloaded: download, format: 'png' }
}

function setEditorMode(editor, { handlerMode, transformMode, preview } = {}) {
  const h = editor.handler
  const tc = editor.transformControls
  if (!h || !tc) return { error: 'handler/transformControls 未就绪' }
  if (handlerMode != null) {
    if (!HANDLER_MODES.has(handlerMode)) return { error: `handlerMode 无效: ${handlerMode}`, allowed: [...HANDLER_MODES] }
    h.mode = handlerMode
  }
  if (transformMode != null) {
    if (!TC_MODES.has(transformMode)) return { error: `transformMode 无效: ${transformMode}`, allowed: [...TC_MODES] }
    tc.setMode(transformMode)
    if (h.mode !== 'transform' && h.mode !== 'select' && h.mode !== 'none') h.mode = 'transform'
    else if (transformMode && h.mode === 'none') h.mode = 'transform'
  }
  if (preview != null) {
    h.mode = preview ? 'none' : (transformMode ? 'transform' : h.mode === 'none' ? 'transform' : h.mode)
  }
  return { handlerMode: h.mode, transformMode: tc.mode, preview: preview ?? undefined }
}

function getObjectMaterials(editor, { id }) {
  const o = find(editor.scene, id)
  if (!o) return { error: `未找到 id=${id}` }
  const mats = getMaterials(o)
  const list = mats.map((m, i) => ({
    index: i,
    type: m?.type,
    color: m?.color ? `#${m.color.getHexString()}` : undefined,
    opacity: m?.opacity != null ? r(m.opacity) : undefined,
    wireframe: m?.wireframe,
  }))
  return { id, name: o.name || '(未命名)', count: list.length, materials: list }
}

function getObjectBox3Info(editor, { id }) {
  const o = find(editor.scene, id)
  if (!o) return { error: `未找到 id=${id}` }
  const b = getObjectBox3(o)
  return {
    id, name: o.name || '(未命名)',
    center: v3(b.center), radius: r(b.radius),
    min: v3(b.min), max: v3(b.max),
  }
}

export const SCENE_SYSTEM = `Three.js 场景编辑助手。Y 轴向上，地面 XZ 平面。

【工作流 - 必须遵守】
1. 不熟悉场景 → inspectScene 一次（含 spatial+对象摘要）
2. 要加资源 → listCatalog 一次（含 routes 任务路由），禁止连环 listModels/listComponents
3. 改已有对象 → getDetail(id) 一次；禁止 getDetail 后再 getObjectParams
4. 贴地 → addMesh/addModel/addComponent 默认 onGround；改已有用 placeOnGround

【任务路由 - listCatalog.routes】
编辑器便捷：加模型→addModel | 加组件→addComponent | 加几何→addMesh | 加灯→addLight
Three.js 原生：createMesh/createBufferMesh | createGroup/reparentObject/cloneObject
线点图元→addLine/addPoints | 材质贴图→setMaterial/applyTexture/replaceGeometry
原生灯光→addNativeLight+setLightProps | 场景雾/底色→setSceneProps | 标签→addSprite
3D字/着色器/GUI→runEditorAction | 未知→listEditorActions

【Three.js 原生 - 与编辑器并列，优先于 runEditorAction】
- 标准几何+参数 → createMesh（Capsule/Lathe/Tube 等见 listCatalog.threeJs）
- 自定义顶点 → createBufferMesh | 大量副本 → createInstancedMesh(最多${MAX_INSTANCES})
- 曲线管道 → addTubeMesh | 旋转体 → createLatheMesh
- 几何后处理 → updateMeshGeometry(法线/居中/包围盒) | 线框 → addMeshWireframe
- 层级 → createGroup / reparentObject(attach) / cloneObject / lookAt
- 图元 → addLine / addPoints / addSprite
- 材质 → setMaterial / replaceGeometry / applyTexture
- 灯光 → addNativeLight(AmbientLight 等 API 名) + setLightProps(target/阴影)
- 变换/可见 → setProps(position/rotation/scale/visible/castShadow)
- 场景 → setSceneProps(background/fog)；六面 skybox 仍用 setSky/setEnv
- 编辑器中文几何/组件/模型 → addMesh/addComponent/addModel（便捷封装，非原生 API）

【安全】
- 只改 inspectScene 中存在的 id；不可改相机/GridHelper/AxesHelper
- setObjectParams 只写 getDetail.custom 已有键；error 时停止重试
- loadScene/clearEditorCache 会替换或清空场景，用户未明确要求禁止调用

【效率】
- 简单任务 1-3 步；禁止连续 3+ 次只读工具
- listObjects 最多 40 条；getGridInfo/getEditorSettings 仅在需要时用

【能力覆盖】
- 专用工具 ~65 个：场景/对象/模型/组件/Three.js 原生/GUI/导出/动画
- runEditorAction ~${Object.keys(EDITOR_ACTIONS).length} 个：Cores GUI/Theatre/场景槽/裁剪/CSS/视角等
- 完整粒子/三维地块等 → runEditorAction openCorePanel({ panel:"粒子物体"|"三维地块" })`

const vec3 = z.tuple([z.number(), z.number(), z.number()]).optional()
const vec3req = z.tuple([z.number(), z.number(), z.number()])
const profile2d = z.array(z.tuple([z.number(), z.number()])).min(2).max(MAX_CURVE_POINTS)
const path3d = z.array(vec3req).min(2).max(MAX_CURVE_POINTS)
const geoParams = z.record(z.string(), z.union([z.number(), z.array(z.union([z.number(), z.array(z.number())]))])).optional()
const matParams = z.object({
  color: z.string().optional(), emissive: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  roughness: z.number().min(0).max(1).optional(),
  wireframe: z.boolean().optional(),
  flatShading: z.boolean().optional(),
  vertexColors: z.boolean().optional(),
  side: z.union([z.enum(['FrontSide', 'BackSide', 'DoubleSide']), z.number().int().min(0).max(2)]).optional(),
}).optional()
const vec3flex = z.union([
  z.tuple([z.number(), z.number(), z.number()]),
  z.object({ x: z.number(), y: z.number(), z: z.number() }),
]).optional()
const hexColor = z.union([z.number(), z.string()])
const passPatch = z.object({
  enabled: z.boolean().optional(),
  order: z.number().optional(),
}).catchall(z.union([z.number(), z.boolean(), z.string()]))

function matchObjectFilter(o, { name, type, lightsOnly, designType } = {}) {
  if (lightsOnly && !o.isLight) return false
  if (name && !(o.name || '').includes(name)) return false
  if (designType && o.designType !== designType && !(o.name || '').includes(designType)) return false
  if (type) {
    const t = o.designType || o.type
    if (t !== type && o.type !== type && o.editorType !== type) return false
  }
  return true
}

function collectObjects(editor, opts = {}) {
  const { deep, name, type, lightsOnly, designType } = typeof opts === 'boolean' ? { deep: opts } : opts
  const raw = deep
    ? (() => { const out = []; editor.scene.traverse(o => { if (isObj(o)) out.push(o) }); return out })()
    : editor.scene.children.filter(isObj)
  return raw.filter(o => matchObjectFilter(o, { name, type, lightsOnly, designType }))
}

function summarizeObjects(raw) {
  const s = { total: raw.length, floors: 0, lights: 0, designs: 0, models: 0, meshes: 0 }
  for (const o of raw) {
    if (isFloorLike(o)) s.floors++
    else if (o.isLight) s.lights++
    else if (o.designType) s.designs++
    else if (o.animations?.length) s.models++
    else if (o.editorType === 'isInnerMesh') s.meshes++
  }
  return s
}

function listCatalog() {
  return {
    models: listModels().slice(0, 30),
    components: ThreeEditor.__DESIGNS__.map(d => d.label),
    lights: LIGHT_TYPES,
    meshes: Object.keys(MESH_TYPES),
    skies: SKIES.map(s => s.name),
    scenes: listScenes().map(s => s.name),
    cores: CORES_LIST.map(c => ({ name: c.name, label: c.label })),
    threeJs: {
      geometries: GEOMETRY_TYPES,
      materials: MATERIAL_TYPES,
      lightTypes: NATIVE_LIGHT_TYPES,
      textureMaps: TEXTURE_MAPS,
      sides: ['FrontSide', 'BackSide', 'DoubleSide'],
      tools: NATIVE_TOOL_NAMES,
    },
    editor: {
      basicPanels: BASIC_PANELS,
      objectPanels: Object.keys(OBJECT_PANELS),
      settingsSections: EDITOR_SETTING_KEYS,
      handlerModes: [...HANDLER_MODES],
      transformModes: [...TC_MODES],
      actionCount: Object.keys(EDITOR_ACTIONS).length,
    },
    routes: {
      看场景: 'inspectScene',
      查可添加资源: 'listCatalog（本工具）',
      加模型: 'addModel({ urlOrName, onGround:true })',
      加组件: 'addComponent({ type, onGround:true })',
      加几何体: 'addMesh(中文) 或 createMesh/createBufferMesh(Three.js 类名/顶点)',
      加灯光: 'addLight(中文) 或 addNativeLight(AmbientLight 等)',
      加3D文字: 'runEditorAction({ action:"addText3D", params:{ text } })',
      贴地: 'placeOnGround({ id })',
      改属性: 'setProps / setObjectParams / setMaterial',
      原生网格: 'createMesh / createBufferMesh / createInstancedMesh',
      曲线旋转: 'addTubeMesh / createLatheMesh',
      几何处理: 'updateMeshGeometry / addMeshWireframe / replaceGeometry',
      原生层级: 'createGroup / reparentObject / cloneObject',
      原生图元: 'addLine / addPoints / addSprite',
      混合着色器: 'runEditorAction listBlendShaders → applyBlendShader',
      打开GUI: 'openEditorPanel / openObjectPanel / runEditorAction openCorePanel',
      撤销重做: 'undoEditor / redoEditor',
      未知能力: 'listEditorActions → runEditorAction',
    },
    hint: '优先 routes 选工具；一次 listCatalog 即可，勿连环 listModels+listComponents',
  }
}

function inspectScene(editor, { id, name, type, designType, deep, includeObjects = true } = {}) {
  const out = {
    selectedId: editor.transformControls.object?.id ?? null,
    spatial: getSpatialContext(editor, id),
  }
  if (id != null) {
    const o = find(editor.scene, id)
    if (o) out.focus = { object: detail(o, { children: true }) }
  }
  if (!includeObjects) return out
  const raw = collectObjects(editor, { deep, name, type, designType })
  out.summary = summarizeObjects(raw)
  out.objects = raw.slice(0, LIST_CAP).map(brief)
  if (raw.length > LIST_CAP) out.truncated = true
  return out
}

export function listObjects(editor, opts = {}) {
  return collectObjects(editor, opts).map(brief)
}

export function createSceneTools(editor) {
  return {
    inspectScene: guardTool({
      description: '【首选】一次读取场景：空间上下文+对象摘要+选中项。替代 listObjects+getSpatialContext 组合',
      inputSchema: z.object({
        id: z.number().optional().describe('可选，同时返回该对象完整 detail'),
        name: z.string().optional().describe('按名称过滤对象列表'),
        type: z.string().optional().describe('按类型过滤'),
        designType: z.string().optional().describe('按组件 designType 过滤'),
        deep: z.boolean().optional().describe('递归列出子对象'),
        includeObjects: z.boolean().optional().describe('是否含对象列表，默认 true'),
      }),
      execute: (input) => inspectScene(editor, input),
    }),
    listCatalog: guardTool({
      description: '【首选】一次列出可添加的模型/组件/灯光/几何体/天空/案例场景，替代多个 list* 工具',
      inputSchema: z.object({}),
      execute: () => listCatalog(),
    }),
    listObjects: guardTool({
      description: '列出场景对象(最多40)。优先用 inspectScene；大场景用 name/type 过滤',
      inputSchema: z.object({
        deep: z.boolean().optional().describe('是否递归列出子对象'),
        name: z.string().optional().describe('名称包含匹配'),
        type: z.string().optional().describe('类型匹配，如 Mesh、AmbientLight、isLight'),
        designType: z.string().optional().describe('组件 designType 过滤'),
        lightsOnly: z.boolean().optional().describe('仅返回灯光'),
      }),
      execute: (input) => {
        const all = listObjects(editor, input)
        const cap = LIST_CAP
        return {
          selectedId: editor.transformControls.object?.id ?? null,
          objects: all.slice(0, cap),
          ...(all.length > cap ? { truncated: true, total: all.length, hint: '用 name/type 缩小范围' } : {}),
        }
      },
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
      description: '网格参数；默认不含交点(省 token)，需网格对齐时 includePoints:true',
      inputSchema: z.object({
        includePoints: z.boolean().optional().describe('返回网格交点坐标，默认 false'),
      }),
      execute: ({ includePoints }) => getGridInfo(editor, !!includePoints),
    }),
    getSpatialContext: guardTool({
      description: '空间上下文：地面高度、已有地面列表、网格、可选单物体 gapToGround。放置/贴地前优先调用',
      inputSchema: z.object({
        id: z.number().optional().describe('可选，分析该物体与地面的距离'),
      }),
      execute: ({ id }) => getSpatialContext(editor, id),
    }),
    placeOnGround: guardTool({
      description: '将物体底面贴到地面。自动算 y；平面可 flat:true 放平',
      inputSchema: z.object({
        id: z.number(),
        groundY: z.number().optional().describe('目标地面高度，默认取 getSpatialContext.recommendedGroundY'),
        flat: z.boolean().optional().describe('PlaneGeometry 放平为 XZ 地面，rotation [-90,0,0]'),
        x: z.number().optional(),
        z: z.number().optional(),
        refId: z.number().optional().describe('参考另一物体顶面作为 groundY'),
      }),
      execute: (input) => placeOnGround(editor, input),
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
      description: '仅当 getDetail.custom 不够用时读取 params/uniforms。改参直接用 setObjectParams',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => {
        const o = find(editor.scene, id)
        return o ? { id, name: o.name || '(未命名)', custom: readCustomProps(o) } : { error: `未找到 id=${id}` }
      },
    }),
    setObjectParams: guardTool({
      description: '修改组件 params/uniforms/material。组件会走 setStorage 与 GUI 一致',
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
    getEditorApi: guardTool({
      description: 'ThreeEditor 实例能力图谱：属性/方法/panelApi/lib/专用工具映射；全量 action 见 listEditorActions',
      inputSchema: z.object({}),
      execute: () => getEditorApi(editor),
    }),
    listEditorActions: guardTool({
      description: '【兜底目录】列出 runEditorAction 全部 action：Cores GUI/Theatre/场景槽/裁剪/CSS标签/视角记录等',
      inputSchema: z.object({}),
      execute: () => listEditorActions(),
    }),
    runEditorAction: guardTool({
      description: '执行 listEditorActions 中的任意 action，覆盖编辑器尚未专用工具化的能力',
      inputSchema: z.object({
        action: z.string().describe('action 名，来自 listEditorActions'),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])).optional(),
      }),
      execute: ({ action, params }) => runEditorAction(editor, { action, params: params || {} }),
    }),
    openEditorPanel: guardTool({
      description: '打开编辑器 GUI 浮动窗。panel=渲染配置|相机配置|轨道配置|变换配置|环境配置|后期处理；不传 panel 则打开控制板',
      inputSchema: z.object({
        panel: z.enum(BASIC_PANELS).optional().describe('子配置窗名称，如 渲染配置'),
        openMain: z.boolean().optional().describe('是否同时打开控制板四宫格，默认 true'),
      }),
      execute: (input) => openEditorPanel(editor, input),
    }),
    openObjectPanel: guardTool({
      description: '打开选中对象的 GUI 配置窗（等同右键菜单）：basicConf/materialConf/shaderConf/relatedConf',
      inputSchema: z.object({
        id: z.number(),
        panel: z.enum(Object.keys(OBJECT_PANELS)).optional().describe('默认 materialConf'),
      }),
      execute: ({ id, panel }) => openObjectPanel(editor, { id, panel: panel || 'materialConf' }),
    }),
    setEditorMode: guardTool({
      description: '切换编辑器交互模式：handlerMode(transform/select/none)、transformMode(translate/rotate/scale)、preview 预览',
      inputSchema: z.object({
        handlerMode: z.enum([...HANDLER_MODES]).optional(),
        transformMode: z.enum([...TC_MODES]).optional(),
        preview: z.boolean().optional().describe('true 时 handler.mode=none（不折叠侧栏）'),
      }),
      execute: (input) => setEditorMode(editor, input),
    }),
    undoEditor: guardTool({
      description: '撤销上一步变换操作（等同 Ctrl+Z）',
      inputSchema: z.object({}),
      execute: () => undoEditor(editor),
    }),
    redoEditor: guardTool({
      description: '重做变换操作（等同 Ctrl+Y）',
      inputSchema: z.object({}),
      execute: () => redoEditor(editor),
    }),
    saveEditorScene: guardTool({
      description: '保存当前场景到 localStorage（等同顶部「保存」）',
      inputSchema: z.object({
        sceneName: z.string().optional().describe('场景名，默认当前场景'),
      }),
      execute: (input) => saveEditorScene(editor, input),
    }),
    captureScreenshot: guardTool({
      description: '截取当前视口 PNG（等同相机按钮），默认自动下载',
      inputSchema: z.object({
        download: z.boolean().optional().describe('默认 true'),
        quality: z.number().min(0.1).max(1).optional(),
      }),
      execute: (input) => captureScreenshot(editor, input),
    }),
    exportSceneJson: guardTool({
      description: '导出 saveSceneEdit JSON 模板文件',
      inputSchema: z.object({
        download: z.boolean().optional(),
        sceneName: z.string().optional(),
      }),
      execute: (input) => exportSceneJson(editor, input),
    }),
    exportSceneGlb: guardTool({
      description: '导出场景可见模型为 GLB 文件',
      inputSchema: z.object({ sceneName: z.string().optional() }),
      execute: (input) => exportSceneGlb(editor, input),
    }),
    getObjectBox3Info: guardTool({
      description: 'lib.getObjectBox3：精确包围盒 center/radius/min/max',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => getObjectBox3Info(editor, { id }),
    }),
    getObjectMaterials: guardTool({
      description: 'lib.getMaterials：列出对象及子节点上的材质摘要',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => getObjectMaterials(editor, { id }),
    }),
    getEditorSettings: guardTool({
      description: '读取 saveSceneEdit 持久化配置。runtime 状态用 getEditorApi',
      inputSchema: z.object({}),
      execute: () => getEditorSettings(editor),
    }),
    setEditorSettings: guardTool({
      description: '修改 saveSceneEdit 配置段。改渲染器数值无需 openEditorPanel；要弹 GUI 用 openEditorPanel({ panel:"渲染配置" })',
      inputSchema: z.object({
        scene: z.object({
          backgroundBlurriness: z.number().min(0).max(1).optional(),
          backgroundIntensity: z.number().min(0).max(10).optional(),
          environmentEnabled: z.boolean().optional(),
        }).optional(),
        perspectiveCamera: z.object({
          fov: z.number().min(1).max(179).optional(),
          near: z.number().min(0.001).max(1000).optional(),
          far: z.number().min(1).max(1e7).optional(),
          zoom: z.number().min(0.01).max(10).optional(),
          filmOffset: z.number().min(-10).max(10).optional(),
          filmGauge: z.number().min(1).max(100).optional(),
          position: vec3flex,
        }).optional(),
        webglRenderer: z.object({
          outputColorSpace: z.enum(['srgb', 'srgb-linear', 'display-p3', 'linear-srgb']).optional(),
          toneMapping: z.number().int().min(0).max(7).optional(),
          toneMappingExposure: z.number().min(0).max(10).optional(),
          color: hexColor.optional().describe('清屏色，十六进制整数或 #rrggbb'),
          opacity: z.number().min(0).max(1).optional().describe('清屏透明度'),
          shadowMap: z.object({ enabled: z.boolean().optional(), type: z.number().int().min(0).max(2).optional() }).optional(),
          sortObjects: z.boolean().optional(),
          localClippingEnabled: z.boolean().optional(),
          autoClear: z.boolean().optional(),
          autoClearColor: z.boolean().optional(),
          renderListCompare: z.array(z.object({
            name: z.enum(['stats', 'controls', 'scene', 'css3DRender', 'css2DRender']),
            enabled: z.boolean().optional(),
          })).optional(),
        }).optional(),
        orbitControls: z.object({
          autoRotate: z.boolean().optional(),
          autoRotateSpeed: z.number().min(0).max(30).optional(),
          enableDamping: z.boolean().optional(),
          dampingFactor: z.number().min(0).max(1).optional(),
          minDistance: z.number().optional(),
          maxDistance: z.number().optional(),
          maxTargetRadius: z.number().optional(),
          minTargetRadius: z.number().optional(),
          enablePan: z.boolean().optional(),
          panSpeed: z.number().optional(),
          enableRotate: z.boolean().optional(),
          rotateSpeed: z.number().optional(),
          enableZoom: z.boolean().optional(),
          zoomSpeed: z.number().optional(),
          zoomToCursor: z.boolean().optional(),
          target: vec3flex,
        }).optional(),
        transformControls: z.object({
          mode: z.enum(['translate', 'rotate', 'scale']).optional(),
          space: z.enum(['world', 'local']).optional(),
          size: z.number().optional(),
          showX: z.boolean().optional(),
          showY: z.boolean().optional(),
          showZ: z.boolean().optional(),
          translationSnap: z.number().min(0).max(100).nullable().optional(),
          rotationSnap: z.number().min(0).max(Math.PI).nullable().optional(),
          scaleSnap: z.number().min(0).max(10).nullable().optional(),
        }).optional(),
        effectComposer: z.object({
          renderWay: z.enum(['effectComposer', 'webglRenderer']).optional(),
          fxaaPass: passPatch.optional(),
          outlinePass: passPatch.optional(),
          outputPass: passPatch.optional(),
          saoPass: passPatch.optional(),
          screenMaskPass: passPatch.optional(),
          ssrPass: passPatch.optional(),
          unrealBloomPass: passPatch.optional(),
        }).optional(),
        handler: z.object({
          mode: z.enum(['transform', 'select', 'none']).optional().describe('编辑器交互模式'),
          selectChildEnabled: z.boolean().optional(),
          selectChildLevel: z.number().int().min(1).max(10).optional(),
          stats: z.object({
            showStats: z.boolean().optional(),
            statsMode: z.number().int().min(0).max(2).optional(),
          }).optional(),
          helpers: z.object({
            grid: z.object({
              showGrid: z.boolean().optional(),
              size: z.number().min(1).max(10000).optional(),
              divisions: z.number().int().min(1).max(200).optional(),
              colorCenterLine: hexColor.optional(),
              colorGrid: hexColor.optional(),
            }).optional(),
            axes: z.object({
              showAxes: z.boolean().optional(),
              axesLength: z.number().min(1).max(10000).optional(),
            }).optional(),
            box3: z.object({
              useBox3: z.boolean().optional(),
              color: hexColor.optional(),
            }).optional(),
          }).optional(),
        }).optional(),
        other: z.object({
          clipping: z.object({ size: z.number().min(0.1).max(1000).optional() }).optional(),
        }).optional(),
      }),
      execute: (input) => setEditorSettings(editor, input),
    }),
    setProps: guardTool({
      description: '修改对象属性（含灯光 intensity、阴影、renderOrder）',
      inputSchema: z.object({
        id: z.number(), name: z.string().optional(), visible: z.boolean().optional(),
        position: vec3flex, rotation: vec3, scale: vec3,
        color: z.string().optional(), opacity: z.number().min(0).max(1).optional(),
        intensity: z.number().min(0).max(MAX_INTENSITY).optional().describe('灯光强度'),
        castShadow: z.boolean().optional(),
        receiveShadow: z.boolean().optional(),
        renderOrder: z.number().int().min(-1000).max(1000).optional(),
      }),
      execute: (input) => setProps(editor, input),
    }),
    selectObject: guardTool({
      description: '选中对象，不移动相机',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => selectObject(editor, id),
    }),
    deleteObject: guardTool({
      description: '从场景删除对象并 dispose 几何/材质/纹理',
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => deleteObject(editor, id),
    }),
    listModels: guardTool({
      description: '列出 GLB/FBX 模型。优先用 listCatalog',
      inputSchema: z.object({}),
      execute: () => ({ models: listModels() }),
    }),
    addModel: guardTool({
      description: '加载 GLB/FBX 模型。默认贴地(onGround)且不自飞(flyTo)。可设 initPlay/index 自动播放动画',
      inputSchema: z.object({
        urlOrName: z.string().describe('模型 URL 或文件名，来自 listCatalog'),
        position: vec3.describe('位置，默认 [0,0,0]'),
        flyTo: z.boolean().optional().describe('加载后飞过去，默认 false'),
        onGround: z.boolean().optional().describe('加载后自动贴地，默认 true'),
        initPlay: z.boolean().optional().describe('初始加载播放，需配合 index/indices'),
        index: z.number().int().min(0).optional().describe('加载后播放的动画索引'),
        indices: z.array(z.number().int().min(0)).optional(),
        loop: z.boolean().optional().describe('是否循环，默认 true'),
        speed: z.number().min(-10).max(10).optional().describe('播放速度，默认 1'),
      }),
      execute: ({ urlOrName, position, flyTo, onGround, initPlay, index, indices, loop, speed }) =>
        addModel(editor, urlOrName, position ?? [0, 0, 0], !!flyTo, { initPlay, index, indices, loop, speed }, onGround !== false),
    }),
    listComponents: guardTool({
      description: '列出可添加组件。优先用 listCatalog',
      inputSchema: z.object({}),
      execute: () => ({ components: ThreeEditor.__DESIGNS__.map(d => d.label) }),
    }),
    addComponent: guardTool({
      description: '添加组件。地面类(网格地面/科技地面等)自动贴地；可 onGround:false 关闭',
      inputSchema: z.object({
        label: z.string().describe('组件名，来自 listCatalog'),
        position: vec3req,
        flyTo: z.boolean().optional(),
        onGround: z.boolean().optional().describe('自动贴地，地面类默认 true'),
      }),
      execute: ({ label, position, flyTo, onGround }) => addComponent(editor, label, position, !!flyTo, onGround),
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
      description: '列出基础几何体类型。优先用 listCatalog',
      inputSchema: z.object({}),
      execute: () => ({ types: Object.keys(MESH_TYPES) }),
    }),
    addMesh: guardTool({
      description: '添加基础几何体。地面: type=平面 + onGround + flat + size(默认跟网格)',
      inputSchema: z.object({
        type: z.enum(Object.keys(MESH_TYPES)).describe('几何体类型，来自 listMeshes'),
        position: vec3.describe('位置，默认 [0,0,0]'),
        color: z.string().optional().describe('颜色，默认 #ffffff'),
        name: z.string().optional().describe('对象名称'),
        size: z.number().min(1).max(500).optional().describe('平面边长(正方形)，仅 type=平面 且作地面时用'),
        rotation: vec3.optional().describe('欧拉角(度)，平面作地面常用 [-90,0,0]'),
        onGround: z.boolean().optional().describe('添加后自动贴地'),
        flat: z.boolean().optional().describe('PlaneGeometry 放平，等同 placeOnGround(flat:true)'),
        flyTo: z.boolean().optional(),
      }),
      execute: ({ type, position, color, name, size, rotation, onGround, flat, flyTo }) =>
        addMesh(editor, type, position ?? [0, 0, 0], color ?? '#ffffff', name, !!flyTo, { size, rotation, onGround, flat }),
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
    createGroup: guardTool({
      description: 'Three.js 原生：创建 Group 容器，可指定 parentId 挂到已有节点下',
      inputSchema: z.object({
        name: z.string().optional(),
        position: vec3,
        parentId: z.number().optional().describe('父节点 id，默认加到 scene 根'),
      }),
      execute: (input) => createGroup(editor, input),
    }),
    reparentObject: guardTool({
      description: 'Three.js 原生：改变父节点，Object3D.attach 保持世界变换不变',
      inputSchema: z.object({
        id: z.number(),
        parentId: z.number().nullable().optional().describe('新父 id，null/省略=移到 scene 根'),
      }),
      execute: ({ id, parentId }) => reparentObject(editor, { id, parentId: parentId ?? null }),
    }),
    cloneObject: guardTool({
      description: 'Three.js 原生：深拷贝对象(含子节点/几何/材质)，可指定新位置与父节点',
      inputSchema: z.object({
        id: z.number(),
        name: z.string().optional(),
        position: vec3flex,
        parentId: z.number().optional(),
      }),
      execute: (input) => cloneObject(editor, input),
    }),
    lookAt: guardTool({
      description: 'Three.js 原生：Object3D.lookAt，使 -Z 轴指向目标点或目标对象',
      inputSchema: z.object({
        id: z.number(),
        target: vec3flex.describe('世界坐标目标点'),
        targetId: z.number().optional().describe('或指向某对象的世界位置'),
      }),
      execute: (input) => lookAtObject(editor, input),
    }),
    createMesh: guardTool({
      description: 'Three.js 原生：用 geometryType/materialType 类名创建 Mesh，比 addMesh 更灵活',
      inputSchema: z.object({
        geometryType: z.enum(GEOMETRY_TYPES),
        geometryParams: geoParams.describe('数值参数；LatheGeometry.points=[[x,y],...]；TubeGeometry.points=[[x,y,z],...]'),
        materialType: z.enum(MATERIAL_TYPES).optional().describe('默认 MeshStandardMaterial'),
        materialParams: matParams,
        position: vec3, rotation: vec3, name: z.string().optional(),
        parentId: z.number().optional(),
        onGround: z.boolean().optional(), flat: z.boolean().optional(), flyTo: z.boolean().optional(),
      }),
      execute: (input) => createMesh(editor, input),
    }),
    setMaterial: guardTool({
      description: 'Three.js 原生：切换材质类型或改 wireframe/side/metalness 等 PBR 属性',
      inputSchema: z.object({
        id: z.number(),
        meshName: z.string().optional().describe('Group 内子 mesh 名称'),
        materialType: z.enum(MATERIAL_TYPES).optional().describe('传入则整体替换材质'),
        color: z.string().optional(), emissive: z.string().optional(),
        opacity: z.number().min(0).max(1).optional(),
        metalness: z.number().min(0).max(1).optional(),
        roughness: z.number().min(0).max(1).optional(),
        wireframe: z.boolean().optional(),
        flatShading: z.boolean().optional(),
        vertexColors: z.boolean().optional(),
        side: z.union([z.enum(['FrontSide', 'BackSide', 'DoubleSide']), z.number().int().min(0).max(2)]).optional(),
      }),
      execute: (input) => setMaterial(editor, input),
    }),
    replaceGeometry: guardTool({
      description: 'Three.js 原生：替换 Mesh 几何体(释放旧 geometry)，用 Three.js Geometry 类名+参数',
      inputSchema: z.object({
        id: z.number(),
        meshName: z.string().optional(),
        geometryType: z.enum(GEOMETRY_TYPES),
        params: geoParams,
      }),
      execute: ({ id, meshName, geometryType, params }) => replaceGeometry(editor, { id, meshName, geometryType, params }),
    }),
    addLine: guardTool({
      description: 'Three.js 原生：BufferGeometry + Line/LineLoop，points 为 [[x,y,z],...]',
      inputSchema: z.object({
        points: z.array(vec3req).min(2).max(500),
        color: z.string().optional(),
        name: z.string().optional(),
        closed: z.boolean().optional().describe('true 时用 LineLoop'),
        linewidth: z.number().min(1).max(10).optional(),
      }),
      execute: (input) => addLine(editor, input),
    }),
    addPoints: guardTool({
      description: 'Three.js 原生：点云 Points + PointsMaterial',
      inputSchema: z.object({
        points: z.array(vec3req).min(1).max(5000),
        color: z.string().optional(),
        size: z.number().min(0.01).max(50).optional(),
        name: z.string().optional(),
      }),
      execute: (input) => addPoints(editor, input),
    }),
    setSceneProps: guardTool({
      description: 'Three.js 原生：scene.background 纯色、scene.fog(Fog/FogExp2)，与 setSky 互补',
      inputSchema: z.object({
        background: z.union([z.string(), z.null()]).optional().describe('#rrggbb 或 null 清除'),
        fog: z.union([
          z.null(),
          z.object({
            type: z.enum(['Fog', 'FogExp2', 'none']).optional(),
            color: z.string().optional(),
            near: z.number().optional(),
            far: z.number().optional(),
            density: z.number().optional(),
          }),
        ]).optional(),
      }),
      execute: (input) => setSceneProps(editor, input),
    }),
    applyTexture: guardTool({
      description: 'Three.js 原生：TextureLoader 加载远程贴图并赋给 material.map 等通道',
      inputSchema: z.object({
        id: z.number(),
        url: z.string().describe('http(s) 纹理 URL'),
        map: z.enum(TEXTURE_MAPS).optional().describe('默认 map'),
        meshName: z.string().optional(),
      }),
      execute: (input) => applyTexture(editor, input),
    }),
    setLightProps: guardTool({
      description: 'Three.js 原生：灯光 target/castShadow/distance/angle/penumbra/shadow 参数',
      inputSchema: z.object({
        id: z.number(),
        target: vec3flex.describe('平行光/聚光灯照射目标点'),
        castShadow: z.boolean().optional(),
        distance: z.number().min(0).optional(),
        angle: z.number().min(0).max(3.14).optional(),
        penumbra: z.number().min(0).max(1).optional(),
        decay: z.number().min(0).max(10).optional(),
        shadowBias: z.number().min(-0.01).max(0.01).optional(),
        shadowMapSize: z.number().int().min(256).max(4096).optional(),
      }),
      execute: (input) => setLightProps(editor, input),
    }),
    createBufferMesh: guardTool({
      description: 'Three.js 原生：BufferGeometry 自定义顶点网格，positions 为 [x,y,z,...] 扁平数组',
      inputSchema: z.object({
        positions: z.array(z.number()).min(9).max(15000),
        indices: z.array(z.number().int().min(0)).max(50000).optional(),
        colors: z.array(z.number()).optional().describe('与 positions 等长，顶点色'),
        materialType: z.enum(MATERIAL_TYPES).optional(),
        materialParams: z.object({
          color: z.string().optional(), opacity: z.number().min(0).max(1).optional(),
          metalness: z.number().min(0).max(1).optional(), roughness: z.number().min(0).max(1).optional(),
          wireframe: z.boolean().optional(),
        }).optional(),
        name: z.string().optional(), position: vec3, parentId: z.number().optional(),
        onGround: z.boolean().optional(), flat: z.boolean().optional(), flyTo: z.boolean().optional(),
      }),
      execute: (input) => createBufferMesh(editor, input),
    }),
    addNativeLight: guardTool({
      description: 'Three.js 原生：用 API 类名添加灯光(AmbientLight/DirectionalLight/...)，配合 setLightProps',
      inputSchema: z.object({
        type: z.enum(NATIVE_LIGHT_TYPES).optional().describe('默认 DirectionalLight'),
        position: vec3, color: z.string().optional(), intensity: z.number().min(0).max(MAX_INTENSITY).optional(),
      }),
      execute: (input) => addNativeLight(editor, input),
    }),
    addSprite: guardTool({
      description: 'Three.js 原生：Sprite 文字标签或贴图精灵',
      inputSchema: z.object({
        text: z.string().optional(), textureUrl: z.string().optional().describe('http(s) 贴图 URL'),
        position: vec3, color: z.string().optional(), fontSize: z.number().optional(), name: z.string().optional(),
      }),
      execute: (input) => addSprite(editor, input),
    }),
    createInstancedMesh: guardTool({
      description: 'Three.js 原生：InstancedMesh 批量渲染相同几何，count 最多 2000',
      inputSchema: z.object({
        geometryType: z.enum(GEOMETRY_TYPES),
        geometryParams: geoParams.optional(),
        materialType: z.enum(MATERIAL_TYPES).optional(),
        materialParams: matParams,
        count: z.number().int().min(1).max(MAX_INSTANCES),
        instances: z.array(z.object({
          position: vec3, rotation: vec3, scale: z.union([vec3, z.number()]).optional(),
        })).max(MAX_INSTANCES).optional(),
        name: z.string().optional(), position: vec3, parentId: z.number().optional(), flyTo: z.boolean().optional(),
      }),
      execute: (input) => createInstancedMesh(editor, input),
    }),
    createLatheMesh: guardTool({
      description: 'Three.js 原生：LatheGeometry 旋转体，profile=[[x,y],...] 轮廓点',
      inputSchema: z.object({
        profile: profile2d,
        segments: z.number().int().min(3).max(128).optional(),
        materialType: z.enum(MATERIAL_TYPES).optional(),
        materialParams: matParams,
        name: z.string().optional(), position: vec3, parentId: z.number().optional(),
        onGround: z.boolean().optional(), flyTo: z.boolean().optional(),
      }),
      execute: (input) => createLatheMesh(editor, input),
    }),
    addTubeMesh: guardTool({
      description: 'Three.js 原生：CatmullRomCurve3 + TubeGeometry 管道网格',
      inputSchema: z.object({
        points: path3d,
        radius: z.number().min(0.01).max(50).optional(),
        tubularSegments: z.number().int().min(8).max(256).optional(),
        radialSegments: z.number().int().min(3).max(64).optional(),
        materialType: z.enum(MATERIAL_TYPES).optional(),
        materialParams: matParams,
        name: z.string().optional(), position: vec3, parentId: z.number().optional(), flyTo: z.boolean().optional(),
      }),
      execute: (input) => addTubeMesh(editor, input),
    }),
    updateMeshGeometry: guardTool({
      description: 'Three.js 原生：BufferGeometry 后处理 computeVertexNormals/center/包围盒',
      inputSchema: z.object({
        id: z.number(), meshName: z.string().optional(),
        computeNormals: z.boolean().optional(),
        center: z.boolean().optional(),
        computeBounds: z.boolean().optional(),
      }),
      execute: (input) => updateMeshGeometry(editor, input),
    }),
    addMeshWireframe: guardTool({
      description: 'Three.js 原生：EdgesGeometry/WireframeGeometry 线框叠加',
      inputSchema: z.object({
        id: z.number(), meshName: z.string().optional(),
        mode: z.enum(['edges', 'wireframe']).optional(),
        color: z.string().optional(),
        thresholdAngle: z.number().min(1).max(90).optional(),
        name: z.string().optional(),
      }),
      execute: (input) => addMeshWireframe(editor, input),
    }),
    listScenes: guardTool({
      description: '列出可加载的配置案例场景',
      inputSchema: z.object({}),
      execute: () => ({ scenes: listScenes() }),
    }),
    loadScene: guardTool({
      description: '【慎用】加载配置案例，会替换当前场景。用户明确要求时才调用',
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
      description: '网格/坐标轴/包围盒辅助：显示、尺寸、颜色、长度',
      inputSchema: z.object({
        grid: z.boolean().optional(),
        axes: z.boolean().optional(),
        size: z.number().min(1).max(10000).optional().describe('网格总尺寸'),
        divisions: z.number().int().min(1).max(200).optional().describe('网格分割数'),
        colorCenterLine: hexColor.optional().describe('网格中心线颜色'),
        colorGrid: hexColor.optional().describe('网格线颜色'),
        axesLength: z.number().min(1).max(10000).optional().describe('坐标轴长度'),
        useBox3: z.boolean().optional().describe('显示选中包围盒'),
        box3Color: hexColor.optional().describe('包围盒颜色'),
      }),
      execute: (input) => setHelpers(editor, input),
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
