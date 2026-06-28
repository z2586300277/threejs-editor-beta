import { z } from 'zod/v4'
import {
  ADVANCED_HINT, BASIC_PANELS, COLOR_PALETTE_NAMES, CURATED,
  GEOMETRY_TYPES, LIGHT_TYPES, MATERIAL_TYPES, MESH_TYPE_NAMES,
  SKY_NAMES, TEXTURE_MAPS,
} from './shared.js'

export const vec3 = z.tuple([z.number(), z.number(), z.number()]).optional()
export const vec3req = z.tuple([z.number(), z.number(), z.number()])

/**
 * 场景工具定义（仅 schema + 描述），执行逻辑由 executors 注入。
 * 前后端共享：前端 bindLocalExecutors，后端 bindRemoteExecutors。
 */
export function defineSceneTools({ mk, atomic, executors }) {
  const e = executors

  return {
    inspectScene: mk(
      '查看场景全貌：对象列表、空间信息、地面高度、选中状态。不确定场景有什么时先调用',
      z.object({ id: z.number().optional().describe('聚焦某个对象的详情') }),
      e.inspectScene,
    ),

    listResources: mk(
      '查可用资源。label=查单个组件详情（查后才能 addComponent）；query=模糊搜索；无参=全览（meshes/lights/components/models/skies）',
      z.object({
        label: z.string().optional().describe('精确组件名，如"网格地面"，查后解锁 addComponent'),
        query: z.string().optional().describe('模糊搜索，如"粒子"、"地面"、"图表"'),
      }),
      e.listResources,
    ),

    getObject: mk(
      '读取对象完整属性：bounds/editHints/custom(params/uniforms)/material/shadow。改任何对象前必须先调用',
      z.object({
        id: z.number(),
        children: z.boolean().optional().describe('是否包含子节点列表'),
      }),
      e.getObject,
    ),

    editObject: mk(
      '精准修改对象属性。先 getObject 读 editHints；组件改 params/uniforms；mesh 改 color/material；改完自动 focusCamera',
      z.object({
        id: z.number(),
        name: z.string().optional(),
        visible: z.boolean().optional(),
        position: vec3,
        rotation: vec3,
        scale: vec3,
        color: z.string().optional().describe('#rrggbb，仅 mesh 有效'),
        opacity: z.number().min(0).max(1).optional(),
        intensity: z.number().optional().describe('灯光强度'),
        castShadow: z.boolean().optional(),
        receiveShadow: z.boolean().optional(),
        metalness: z.number().min(0).max(1).optional(),
        roughness: z.number().min(0).max(1).optional(),
        emissive: z.string().optional(),
        params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional()
          .describe('组件 params，key 必须来自 getObject.custom.params'),
        uniforms: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.array(z.number())])).optional()
          .describe('shader uniforms，key 必须来自 getObject.custom.uniforms'),
      }),
      e.editObject,
    ),

    addMesh: atomic('addMesh',
      `添加基础几何体。类型：${MESH_TYPE_NAMES.join('/')}。支持颜色/名称/贴地/运镜`,
      z.any(),
      e.addMesh,
    ),
    addComponent: atomic('addComponent',
      '添加场景组件（特效/地面/图表/UI等）。必须先 listResources({ label }) 查阅后才能调用',
      z.any(),
      e.addComponent,
    ),
    addModel: atomic('addModel',
      '加载本地 GLB/FBX 模型。先 listResources 查 models 列表，再用文件名调用。默认贴地+飞到模型',
      z.any(),
      e.addModel,
    ),
    addLight: atomic('addLight',
      `添加灯光。类型：${LIGHT_TYPES.join('/')}。平行光/聚光灯自动开 castShadow`,
      z.any(),
      e.addLight,
    ),
    cloneObject: atomic('cloneObject', '深拷贝对象（含子节点/几何/材质），可指定新位置', z.any(), e.cloneObject),
    deleteObject: atomic('deleteObject', '删除对象并释放 GPU 资源', z.any(), e.deleteObject),
    placeOnGround: atomic('placeOnGround', '将对象底面精确对齐到地面高度', z.any(), e.placeOnGround),

    createMesh: atomic('createMesh',
      `Three.js 原生建模：用几何类名创建 Mesh。几何类型：${GEOMETRY_TYPES.join('/')}...`,
      z.any(),
      e.createMesh,
    ),
    setMaterial: atomic('setMaterial',
      `切换材质类型或修改 PBR 参数。材质类型：${MATERIAL_TYPES.join('/')}`,
      z.any(),
      e.setMaterial,
    ),
    setSceneProps: atomic('setSceneProps', '修改场景背景色(background)或雾效(fog)', z.any(), e.setSceneProps),
    addNativeLight: atomic('addNativeLight', 'Three.js 原生灯光，用 API 类名创建', z.any(), e.addNativeLight),
    setLightProps: atomic('setLightProps', '精细调整灯光：target/castShadow/distance/angle/penumbra/shadowMapSize', z.any(), e.setLightProps),
    applyTexture: atomic('applyTexture', `加载远程纹理赋给材质通道。通道：${TEXTURE_MAPS.join('/')}`, z.any(), e.applyTexture),
    lookAt: atomic('lookAt', '让对象朝向目标点或目标对象', z.any(), e.lookAt),

    setEnvironment: mk(
      `设置天空盒/环境贴图/背景色/雾效。天空选项：${SKY_NAMES.join('/')}。用户明确要求时才调用`,
      z.object({
        sky: z.string().optional().describe('天空盒名称'),
        env: z.string().optional().describe('环境反射贴图名称'),
        background: z.string().nullable().optional().describe('#rrggbb 或 null 清除'),
        fog: z.object({
          color: z.string().optional(),
          near: z.number().optional(),
          far: z.number().optional(),
        }).nullable().optional(),
      }),
      e.setEnvironment,
    ),

    enableShadows: mk(
      '一键开启阴影四要素：renderer.shadowMap + 主光源castShadow + mesh castShadow + 地面receiveShadow',
      z.object({
        castIds: z.array(z.number()).optional().describe('指定投射阴影的对象 id，不传则自动处理所有 mesh'),
        receiveIds: z.array(z.number()).optional().describe('指定接收阴影的地面 id'),
      }),
      e.enableShadows,
    ),

    focusCamera: mk(
      '对准相机视角。objectId=飞到某个对象；不传则框选整个场景',
      z.object({
        objectId: z.number().optional(),
        position: vec3req.optional().describe('直接指定相机位置'),
        target: vec3req.optional().describe('直接指定相机目标点'),
      }),
      e.focusCamera,
    ),

    playAnimation: atomic('playAnimation', '播放 GLB/FBX 模型自带动画。先 listResources 或 getObject 查看动画列表', z.any(), e.playAnimation),

    history: mk(
      '撤销(undo)或重做(redo)操作',
      z.object({ action: z.enum(['undo', 'redo']) }),
      e.history,
    ),

    openPanel: mk(
      `打开编辑器配置面板。选项：${BASIC_PANELS.join('/')}`,
      z.object({ panel: z.enum(BASIC_PANELS).optional() }),
      e.openPanel,
    ),

    buildScene: mk(
      `快速搭建完整示例场景（地面+灯光+主体+装饰+阴影+运镜）。色调：${COLOR_PALETTE_NAMES.join('/')}。仅用户要示例/好看场景时用`,
      z.object({ palette: z.string().optional().describe('色调名称，不传则随机') }),
      e.buildScene,
    ),

    runAdvanced: mk(
      '调用高级工具：createInstancedMesh/createLatheMesh/addTubeMesh/exportSceneGlb/captureScreenshot/setEditorSettings/runEditorAction 等',
      z.object({
        tool: z.string().describe('工具名，来自 listResources.advancedTools 或 listEditorActions'),
        input: z.record(z.string(), z.unknown()).optional(),
      }),
      e.runAdvanced,
    ),
  }
}
