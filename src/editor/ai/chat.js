import { streamText, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod/v4'
import {
  CFG_KEY, LAYOUT_KEY, CHATS_KEY, DEFAULT_AI_CONFIG, MAX_HISTORY, MAX_STEPS,
  TOOL_STATUS, CURATED, ADVANCED_HINT,
} from './config.js'
import {
  getLiveContext, buildScene, inspectScene, listResources, listObjects,
  getEditorSettings, getEditorApi, openEditorPanel, runEditorAction, listEditorActions,
  allSceneTools, mk, vec3, vec3req,
} from './core.js'

export function buildSystemPrompt(live) {
  const parts = []
  if (live?.ready) {
    parts.push(`场景 ${live.count} 个对象，地面 Y=${live.groundY}`)
    if (live.selected) parts.push(`当前选中 #${live.selected.id} ${live.selected.name}(${live.selected.role})`)
    if (live.roles) parts.push(`构成 ${fmtRoles(live.roles)}`)
    if (live.snapshot?.length) parts.push(`对象：${live.snapshot.join('；')}`)
  } else parts.push('编辑器就绪，场景为空或未加载')
  const ctx = parts.join('。')
  return `你是 Three.js 编辑器场景助理（技术美术视角）。${ctx}

按任务直接调工具，不要无意义地 inspectScene → listResources 全查一遍：
· 漂亮/随机场景 → buildScene，再 editObject 微调
· 改物体 → 有选中用其 id；否则 inspectScene 找 id → editObject（组件改 params/uniforms，几何改 color/position/scale）
· 添加几何/方块/球/柱/地面 → addMesh（见 meshUsage），不要用组件代替
· 添加特效/图表/UI/组件 → 三步：① listResources({ label }) 了解 looksLike/defaults → ② addComponent 添加尝试 → ③ editObject 微调或 deleteObject
· 不确定用哪个组件 → listResources({ query }) 搜索，再对选定 label 执行①
· 氛围 → setEnvironment；运镜 → focusCamera
· 原生 API / GUI / 导出 → runAdvanced（tool 名见 listResources.advancedTools）

回复习惯：先说打算做什么 → 调工具 → 收尾说明改了什么（含 id/名称）。不要只回「好了」。

约束：Y 向上，新物体默认贴地；不碰相机/GridHelper；不 loadScene、不清缓存，除非用户明确要求。`
}

function fmtRoles(roles) {
  return Object.entries(roles).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(' ')
}

/** @deprecated 用 buildSystemPrompt(getLiveContext(editor)) */
export const SCENE_SYSTEM = buildSystemPrompt({ ready: true, count: 0, groundY: 0, roles: {} })

/** 模型可见：16 个常用工具；runAdvanced 懒加载全量能力 */
export function createSceneTools(editor) {
  const all = allSceneTools(editor)
  return {
    inspectScene: mk('查看场景：对象(含 role)、地面高度。不确定有什么时才用', z.object({ id: z.number().optional(), name: z.string().optional() }), (input) => inspectScene(editor, { ...input, includeObjects: true })),
    listResources: mk('查资源/了解组件。label=查阅详情(解锁 addComponent)；query=搜索；无参=概览', z.object({
      label: z.string().optional().describe('精确组件名 — 查阅后可 addComponent'),
      query: z.string().optional().describe('模糊搜索，如 地面、粒子、图表'),
    }), (input) => listResources(editor, input || {})),
    getObject: mk('读取对象详情（含组件 params/uniforms）', z.object({ id: z.number(), children: z.boolean().optional() }), ({ id, children }) => all.getDetail.execute({ id, children })),

    editObject: mk("改对象：位置/旋转/缩放/颜色/组件 params/uniforms", z.object({
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
        params: z
          .record(z.string(), z.union([z.number(), z.string(), z.boolean()]))
          .optional(),
        uniforms: z
          .record(
            z.string(),
            z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]),
          )
          .optional(),
      }), async (input) => {
        const {
          id,
          params,
          uniforms,
          metalness,
          roughness,
          emissive,
          ...rest
        } = input;
        let last;
        if (params || uniforms) {
          last = await all.setObjectParams.execute({ id, params, uniforms });
          if (last?.error) return last;
        }
        const mat = {
          metalness,
          roughness,
          emissive,
          color: rest.color,
          opacity: rest.opacity,
        };
        if (Object.values(mat).some((v) => v != null)) {
          last = await all.setMaterial.execute({ id, ...mat });
          if (last?.error) return last;
          delete rest.color;
          delete rest.opacity;
        }
        if (Object.keys(rest).some((k) => k !== "id" && rest[k] != null)) {
          last = await all.setProps.execute({ id, ...rest });
        }
        return last || { error: "没有可应用的修改" };
      }),

    addMesh: all.addMesh,
    addComponent: all.addComponent,
    addModel: all.addModel,
    addLight: all.addLight,
    deleteObject: all.deleteObject,
    placeOnGround: all.placeOnGround,

    setEnvironment: mk("天空盒/环境贴图/背景色/雾", z.object({
        sky: z.string().optional(),
        env: z.string().optional(),
        background: z.string().nullable().optional(),
        fog: z
          .object({
            color: z.string().optional(),
            near: z.number().optional(),
            far: z.number().optional(),
          })
          .nullable()
          .optional(),
      }), async ({ sky, env, background, fog }) => {
        const out = {};
        if (sky) Object.assign(out, await all.setSky.execute({ name: sky }));
        if (env) Object.assign(out, await all.setEnv.execute({ name: env }));
        if (background !== undefined || fog !== undefined) {
          Object.assign(
            out,
            await all.setSceneProps.execute({ background, fog }),
          );
        }
        return Object.keys(out).length
          ? out
          : { error: "请指定 sky/env/background/fog" };
      }),

    focusCamera: mk("相机飞到 objectId 或 position+target", z.object({
        objectId: z.number().optional(),
        position: vec3req.optional(),
        target: vec3req.optional(),
      }), async ({ objectId, position, target }) => {
        if (objectId != null) return all.focusObject.execute({ id: objectId });
        if (position && target)
          return all.focusView.execute({ position, target });
        return { error: "需要 objectId 或 position+target" };
      }),

    playAnimation: all.playAnimation,

    history: mk("undo 撤销 / redo 重做", z.object({ action: z.enum(["undo", "redo"]) }), ({ action }) =>
        action === "undo"
          ? all.undoEditor.execute({})
          : all.redoEditor.execute({})),

    buildScene: mk("一键搭建审美统一的示例场景。用户要漂亮/随机场景时首选", z.object({
        palette: z
          .string()
          .optional()
          .describe("黄昏暖调|森林清晨|海洋暮色|极简中性|霓虹赛博"),
      }), ({ palette }) => buildScene(editor, { palette })),

    runAdvanced: mk('高级：runAdvanced({ tool, input })。tool 如 createMesh/setMaterial/exportSceneGlb/runEditorAction；名见 listResources.advancedTools', z.object({
        tool: z.string(),
        input: z.record(z.string(), z.unknown()).optional(),
      }), ({ tool: name, input = {} }) => {
        if (CURATED.has(name)) return { error: `请直接用「${name}」工具` }
        if (name === 'runEditorAction') return runEditorAction(editor, { action: input.action, params: input.params || {} })
        if (name === 'listEditorActions') return listEditorActions()
        const t = all[name]
        if (!t?.execute) return { error: `未知工具「${name}」`, hint: ADVANCED_HINT }
        return t.execute(input)
      }),
  };
}

// ═══ 聊天 UI ═════════════════════════════════════════════════════════

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
function loadJson(key, legacyKey) {
  try {
    let raw = localStorage.getItem(key);
    if (!raw && legacyKey) {
      raw = localStorage.getItem(legacyKey);
      if (raw) localStorage.setItem(key, raw);
    }
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function normUrl(url) {
  return (url || DEFAULT_AI_CONFIG.baseURL).trim().replace(/\/+$/, "");
}
function chatTitle(messages) {
  const first = messages.find(
    (m) => m.placement === "end" && m.content?.trim(),
  );
  if (!first) return "";
  const t = first.content.trim();
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}
export function formatChatLabel(chat) {
  const title = chatTitle(chat.messages);
  if (title) return title;
  const d = new Date(chat.updatedAt || Date.now());
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `新对话 ${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
function emptyChat(id = String(Date.now())) {
  return { id, msgId: 0, messages: [], updatedAt: Date.now() };
}
function migrateLegacyChat(store) {
  if (store.chats.length) return store;
  const legacy = loadJson("AI_chat");
  if (!legacy?.messages?.length) return store;
  const id = String(Date.now());
  store.chats.unshift({
    id,
    msgId: legacy.msgId || 0,
    messages: legacy.messages.filter((m) => !m.loading),
    updatedAt: Date.now(),
  });
  store.activeId = id;
  return store;
}
export function loadChats() {
  let store = loadJson(CHATS_KEY) || { activeId: "", chats: [] };
  store = migrateLegacyChat(store);
  if (!store.chats.length) {
    const chat = emptyChat();
    store = { activeId: chat.id, chats: [chat] };
    saveChats(store);
  }
  if (!store.chats.some((c) => c.id === store.activeId)) {
    store.activeId = store.chats[0].id;
    saveChats(store);
  }
  return store;
}
export function saveChats(store) {
  localStorage.setItem(CHATS_KEY, JSON.stringify(store));
}
export function getActiveChat(store) {
  return store.chats.find((c) => c.id === store.activeId) || store.chats[0];
}
export function persistActiveChat(store, { msgId, messages }) {
  const chat = getActiveChat(store);
  const list = messages.filter((m) => !m.loading);
  chat.msgId = msgId;
  chat.messages = list;
  chat.updatedAt = Date.now();
  saveChats(store);
}
export function createNewChat(store) {
  const current = getActiveChat(store);
  if (!current.messages.length) return current;
  const chat = emptyChat();
  store.chats.unshift(chat);
  if (store.chats.length > 30) store.chats.length = 30;
  store.activeId = chat.id;
  saveChats(store);
  return chat;
}
export function switchChat(store, id) {
  const chat = store.chats.find((c) => c.id === id);
  if (!chat || store.activeId === id) return null;
  store.activeId = id;
  saveChats(store);
  return chat;
}
export function deleteChat(store, id) {
  const idx = store.chats.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const wasActive = store.activeId === id;
  store.chats.splice(idx, 1);
  if (!store.chats.length) {
    const chat = emptyChat();
    store.chats.push(chat);
    store.activeId = chat.id;
    saveChats(store);
    return chat;
  }
  if (wasActive) store.activeId = store.chats[0].id;
  saveChats(store);
  return wasActive ? getActiveChat(store) : null;
}
export function getAiConfig() {
  const saved = loadJson(CFG_KEY) || {};
  return { ...DEFAULT_AI_CONFIG, ...saved, baseURL: normUrl(saved.baseURL) };
}
export function formatAiError(err) {
  const msg = (err?.message || String(err)).trim();
  if (/insufficient balance/i.test(msg))
    return "DeepSeek 账户余额不足，请到 platform.deepseek.com 充值后再试。";
  if (/invalid api key|authentication/i.test(msg))
    return "API Key 无效，请到 DeepSeek 控制台重新复制。";
  return msg || "请求失败";
}
function saveAiConfig(baseURL, apiKey, model) {
  const key = apiKey?.trim();
  if (!key) throw new Error("请填写 DeepSeek API Key");
  const config = {
    baseURL: normUrl(baseURL),
    apiKey: key,
    model: model?.trim() || DEFAULT_AI_CONFIG.model,
  };
  localStorage.setItem(CFG_KEY, JSON.stringify(config));
  return config;
}
export async function chatWithSceneAi(
  userMessage,
  history,
  baseURL,
  apiKey,
  model,
  { onText, onStatus, signal } = {},
) {
  const editor = window.threeEditor;
  if (!editor) throw new Error("编辑器尚未就绪，请等待场景加载完成");
  const config = saveAiConfig(baseURL, apiKey, model);
  const provider = createAnthropic({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
  const messages = history

    .filter((m) => m.content?.trim() && !m.loading)
    .map((m) => ({
      role: m.placement === "end" ? "user" : "assistant",
      content: m.content.trim(),
    }))
    .slice(-MAX_HISTORY);
  const system = buildSystemPrompt(getLiveContext(editor));
  onStatus?.("思考中…");
  const result = streamText({
    model: provider(config.model),
    system,
    messages: [...messages, { role: "user", content: userMessage }],
    tools: createSceneTools(editor),
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal: signal,
  });
  let stepText = ''
  const toolSteps = []
  try {
    for await (const part of result.fullStream) {
      if (signal?.aborted) break
      if (part.type === 'start-step') stepText = ''
      if (part.type === 'tool-call') {
        toolSteps.push(TOOL_STATUS[part.toolName] || part.toolName)
        onStatus?.(`${toolSteps[toolSteps.length - 1]}…`)
      }
      if (part.type === 'text-delta') {
        const chunk = part.text ?? part.delta
        if (!chunk) continue
        if (chunk.startsWith(stepText) && chunk.length >= stepText.length) stepText = chunk
        else stepText += chunk
        onText?.(stepText)
      }
    }
    if (signal?.aborted) return stepText || '已停止。'
    let final = (await result.text)?.trim() || stepText || (toolSteps.length ? '已执行操作。' : '好了。')
    if (toolSteps.length && !/（已执行|已执行：）/.test(final)) {
      final = `${final}\n\n（已执行：${toolSteps.join(' → ')}）`
    }
    onText?.(final)
    return final
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') return stepText || '已停止。'
    throw e
  }
}
export function restoreLayout({ btnSize = 48, minW = 320, minH = 400 } = {}) {
  const saved = loadJson(LAYOUT_KEY, "ai_panel_layout");
  const btn = saved?.btn
    ? {
        x: clamp(saved.btn.x, 0, innerWidth - btnSize),
        y: clamp(saved.btn.y, 0, innerHeight - btnSize),
      }
    : { x: innerWidth - 72, y: innerHeight - 128 };
  const box = saved?.box
    ? {
        x: clamp(saved.box.x, 0, innerWidth - minW),
        y: clamp(saved.box.y, 0, innerHeight - minH),
        w: clamp(saved.box.w, minW, innerWidth),
        h: clamp(saved.box.h, minH, innerHeight),
      }
    : {
        x: Math.max(0, innerWidth - 404),
        y: Math.max(0, innerHeight - 660),
        w: 380,
        h: 520,
      };
  return {
    btn,
    box,
    open: !!saved?.open,
    showConfig: saved?.showConfig ?? true,
  };
}
export function savePanelLayout(layout) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}
export function mountSceneAI(threeEditor) {
  window.sceneAI = {
    list: () => listObjects(threeEditor),
    getSettings: () => getEditorSettings(threeEditor),
    getApi: () => getEditorApi(threeEditor),
    listActions: () => listEditorActions(),
    run: (action, params) =>
      runEditorAction(threeEditor, { action, params: params || {} }),
    openPanel: (panel) =>
      openEditorPanel(
        threeEditor,
        typeof panel === "string" ? { panel } : panel || {},
      ),
  };
}
