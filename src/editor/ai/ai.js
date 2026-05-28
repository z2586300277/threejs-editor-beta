/**
 * AI 模块入口（对外仍 import from './ai'）
 *
 *   config.js  L0  常量 / 资源表
 *   core.js    L1-L3  editorActions + 场景实现 + 全量工具(60+)
 *   chat.js    L4-L5  prompt + 16 精选工具 + 对话 UI
 *
 * 数据流: aiPanel → chatWithSceneAi → createSceneTools → core.* → ThreeEditor
 */
export * from './config.js'
export * from './core.js'
export * from './chat.js'
