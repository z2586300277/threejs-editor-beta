<template>
  <div>
    <el-button circle type="primary" class="ai-float-btn" :style="{ transform: `translate3d(${btn.x}px, ${btn.y}px, 0)` }" @mousedown="onBtnMouseDown">
      <el-icon><ChatDotRound /></el-icon>
    </el-button>

    <div v-show="open" class="ai-chat-box" :style="{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' }">
      <div class="ai-chat-header" @mousedown="onDragStart">
        <span class="ai-header-label">AI 助手</span>
        <span class="ai-mode-badge" :class="{ offline: !agentOnline }">{{ agentOnline ? '在线' : '离线' }}</span>
        <div class="ai-header-actions" @mousedown.stop>
          <el-dropdown trigger="click" :hide-on-click="false" popper-class="ai-history-dropdown">
            <el-button class="ai-header-btn" link><el-icon><Clock /></el-icon></el-button>
            <template #dropdown>
              <div class="ai-history-panel">
                <div v-for="c in chatStore.chats" :key="c.id" class="ai-history-item" :class="{ 'is-current': c.id === chatStore.activeId }">
                  <span class="ai-history-title" @click="onSwitchChat(c.id)">{{ formatChatLabel(c) }}</span>
                  <el-button class="ai-history-del" link @click.stop="removeChat(c.id)"><el-icon><Delete /></el-icon></el-button>
                </div>
              </div>
            </template>
          </el-dropdown>
          <el-button class="ai-header-btn" link :disabled="loading" @click="newChat"><el-icon><Plus /></el-icon></el-button>
          <el-button class="ai-header-btn" link :class="{ 'is-active': showConfig }" @click="showConfig = !showConfig; save()"><el-icon><Setting /></el-icon></el-button>
          <el-button class="ai-header-btn" link @click="closePanel"><el-icon><Close /></el-icon></el-button>
        </div>
      </div>

      <div v-show="showConfig" class="ai-chat-settings">
        <el-input v-model="model" size="small" placeholder="deepseek-v4-flash" />
        <p class="ai-config-hint">API Key 配置在 server/.env</p>
      </div>

      <div ref="msgBoxRef" class="ai-chat-body">
        <div v-if="!messages.length" class="ai-empty">
          <p class="ai-empty-title">想做什么场景？</p>
          <p class="ai-empty-desc">例如：「分析当前场景并加阴影」「只改选中物体材质」</p>
        </div>
        <div v-for="m in messages" :key="m.id" class="ai-msg" :class="m.placement">
          <div v-if="m.loading && !m.content?.trim()" class="ai-msg-text ai-msg-pending">
            {{ m.statusHint || '思考中' }}<span class="ai-dots" aria-hidden="true"><i /><i /><i /></span>
          </div>
          <div v-else class="ai-msg-text">
            {{ m.content }}<span v-if="m.streaming" class="ai-stream-tail"><span class="ai-dots" aria-hidden="true"><i /><i /><i /></span></span>
          </div>
        </div>
      </div>

      <div class="ai-chat-footer">
        <el-input v-model="inputText" type="textarea" :rows="2" resize="none" placeholder="描述你想要的效果…" @keydown.enter.exact.prevent="send" />
        <div class="ai-footer-actions">
          <el-button v-if="loading" size="small" @click="stop">停止</el-button>
          <el-button v-else size="small" type="primary" :disabled="!inputText.trim()" @click="send">发送</el-button>
        </div>
      </div>

      <div v-for="dir in ['n','s','e','w','ne','nw','se','sw']" :key="dir" class="resize-handle" :class="'resize-' + dir" @mousedown="onResizeStart(dir, $event)" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { ChatDotRound, Close, Plus, Setting, Clock, Delete } from '@element-plus/icons-vue'
import {
  chatWithSceneAi, getAiConfig, formatAiError, restoreLayout, savePanelLayout,
  loadChats, persistActiveChat, createNewChat, switchChat, deleteChat, getActiveChat, formatChatLabel,
  refreshAgentMode,
} from './chat.js'

const BTN = 48, MIN_W = 320, MIN_H = 400
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
const layout = restoreLayout({ btnSize: BTN, minW: MIN_W, minH: MIN_H })
const chatStore = ref(loadChats())
const active = getActiveChat(chatStore.value)

const open = ref(layout.open)
const showConfig = ref(layout.showConfig)
const model = ref(getAiConfig().model)
const agentOnline = ref(false)
const loading = ref(false)
const inputText = ref('')
const messages = ref(active.messages)
const msgBoxRef = ref(null)
const btn = ref(layout.btn)
const box = ref(layout.box)
let msgId = active.msgId, abortCtrl = null, lastW = innerWidth

const save = () => savePanelLayout({ btn: btn.value, box: box.value, open: open.value, showConfig: showConfig.value })
const persistChat = () => persistActiveChat(chatStore.value, { msgId, messages: messages.value })
const scrollBottom = () => nextTick(() => { if (msgBoxRef.value) msgBoxRef.value.scrollTop = msgBoxRef.value.scrollHeight })
watch(messages, scrollBottom, { deep: true })

async function confirmAction(message, title, okText) {
  try {
    await ElMessageBox.confirm(message, title, { confirmButtonText: okText, cancelButtonText: '取消', type: 'warning' })
    return true
  } catch { return false }
}

function applyChat(chat) { messages.value = chat.messages; msgId = chat.msgId }

async function newChat() {
  if (loading.value || !messages.value.length) return
  if (!await confirmAction('当前对话将保存到历史，确定新建？', '新建对话', '新建')) return
  persistChat()
  applyChat(createNewChat(chatStore.value))
}

function onSwitchChat(id) {
  if (loading.value || id === chatStore.activeId) return
  persistChat()
  const chat = switchChat(chatStore.value, id)
  if (chat) applyChat(chat)
}

async function removeChat(id) {
  if (loading.value) return
  const chat = chatStore.value.chats.find(c => c.id === id)
  if (!chat) return
  if (chat.messages.length && !await confirmAction(`删除「${formatChatLabel(chat)}」？`, '删除对话', '删除')) return
  const next = deleteChat(chatStore.value, id)
  if (next) applyChat(next)
}

function track(e, move, up, stop = false) {
  if (e.button !== 0) return
  e.preventDefault()
  if (stop) e.stopPropagation()
  const end = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', end); up?.() }
  addEventListener('mousemove', move)
  addEventListener('mouseup', end)
}

function closePanel() { open.value = false; save() }

function onBtnMouseDown(e) {
  let drag = false
  const sx = e.clientX, sy = e.clientY, ox = btn.value.x, oy = btn.value.y
  track(e, ev => {
    if (Math.abs(ev.clientX - sx) > 3 || Math.abs(ev.clientY - sy) > 3) drag = true
    btn.value.x = clamp(ox + ev.clientX - sx, 0, innerWidth - BTN)
    btn.value.y = clamp(oy + ev.clientY - sy, 0, innerHeight - BTN)
  }, async () => {
    if (!drag) {
      open.value = !open.value
      if (open.value) agentOnline.value = (await refreshAgentMode()) === 'backend'
    }
    save()
  })
}

function onDragStart(e) {
  const sx = e.clientX, sy = e.clientY, ox = box.value.x, oy = box.value.y
  track(e, ev => {
    box.value.x = clamp(ox + ev.clientX - sx, 0, innerWidth - box.value.w)
    box.value.y = clamp(oy + ev.clientY - sy, 0, innerHeight - box.value.h)
  }, save)
}

function onResizeStart(dir, e) {
  const sx = e.clientX, sy = e.clientY, { x, y, w, h } = box.value
  track(e, ev => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy
    let nx = x, ny = y, nw = w, nh = h
    if (dir.includes('e')) nw = w + dx
    if (dir.includes('w')) { nw = w - dx; nx = x + dx }
    if (dir.includes('s')) nh = h + dy
    if (dir.includes('n')) { nh = h - dy; ny = y + dy }
    if (nw < MIN_W) { if (dir.includes('w')) nx -= MIN_W - nw; nw = MIN_W }
    if (nh < MIN_H) { if (dir.includes('n')) ny -= MIN_H - nh; nh = MIN_H }
    box.value = { x: clamp(nx, 0, innerWidth - nw), y: clamp(ny, 0, innerHeight - nh), w: clamp(nw, MIN_W, innerWidth - nx), h: clamp(nh, MIN_H, innerHeight - ny) }
  }, save, true)
}

async function send() {
  const text = inputText.value.trim()
  if (!text || loading.value) return
  messages.value.push({ id: ++msgId, content: text, placement: 'end' })
  inputText.value = ''
  persistChat()
  loading.value = true
  const aiId = ++msgId
  messages.value.push({ id: aiId, content: '', placement: 'start', loading: true, streaming: true, statusHint: '' })
  const patch = f => { messages.value = messages.value.map(m => m.id === aiId ? { ...m, ...f } : m) }
  abortCtrl = new AbortController()
  try {
    const reply = await chatWithSceneAi(text, messages.value.filter(m => m.id !== aiId), model.value, {
      signal: abortCtrl.signal,
      onStatus: (msg) => {
        const cur = messages.value.find(m => m.id === aiId)
        patch({ statusHint: msg, loading: !cur?.content?.trim(), streaming: true })
      },
      onText: c => patch({ content: c, loading: false, streaming: true, statusHint: '' }),
      onDone: () => patch({ streaming: false, loading: false, statusHint: '' }),
    })
    const cur = messages.value.find(m => m.id === aiId)
    if (cur?.streaming || cur?.loading || !cur?.content?.trim()) {
      patch({ content: reply?.trim() || cur?.content || '（无回复）', streaming: false, loading: false, statusHint: '' })
    }
  } catch (e) {
    if (!abortCtrl.signal.aborted) patch({ content: formatAiError(e), streaming: false, loading: false, statusHint: '' })
  } finally {
    if (abortCtrl.signal.aborted) {
      const cur = messages.value.find(m => m.id === aiId)
      patch({ content: cur?.content?.trim() || '已停止。', streaming: false, loading: false, statusHint: '' })
    }
    loading.value = false
    abortCtrl = null
    persistChat()
  }
}

function stop() { abortCtrl?.abort(); loading.value = false }

function onResize() {
  const dw = innerWidth - lastW
  btn.value.x = clamp(btn.value.x + dw, 0, innerWidth - BTN)
  box.value.x = clamp(box.value.x + dw, 0, innerWidth - box.value.w)
  lastW = innerWidth
  save()
}

onMounted(async () => {
  window.addEventListener('resize', onResize)
  agentOnline.value = (await refreshAgentMode()) === 'backend'
})
onUnmounted(() => window.removeEventListener('resize', onResize))
</script>

<style scoped>
.ai-float-btn { position: fixed; z-index: 1000; top: 0; left: 0; width: 48px; height: 48px; font-size: 22px; box-shadow: 0 4px 12px rgba(0,0,0,.35); transition: none !important; }
.ai-chat-box { position: fixed; z-index: 1001; display: flex; flex-direction: column; background: #252525; border: 1px solid #404040; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.45); overflow: hidden; }
.resize-handle { position: absolute; z-index: 2; }
.resize-n, .resize-s { left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.resize-n { top: 0; } .resize-s { bottom: 0; }
.resize-e, .resize-w { top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.resize-e { right: 0; } .resize-w { left: 0; }
.resize-ne, .resize-nw, .resize-se, .resize-sw { width: 12px; height: 12px; }
.resize-ne { top: 0; right: 0; cursor: nesw-resize; }
.resize-nw { top: 0; left: 0; cursor: nwse-resize; }
.resize-se { right: 0; bottom: 0; cursor: nwse-resize; }
.resize-sw { left: 0; bottom: 0; cursor: nesw-resize; }
.ai-chat-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #404040; cursor: move; user-select: none; color: #e5eaf3; }
.ai-header-label { font-weight: 500; flex: 1; }
.ai-mode-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; color: #67c23a; background: rgba(103,194,58,.12); border: 1px solid rgba(103,194,58,.35); }
.ai-mode-badge.offline { color: #f56c6c; background: rgba(245,108,108,.12); border-color: rgba(245,108,108,.35); }
.ai-header-actions { display: flex; gap: 2px; }
.ai-header-btn { padding: 4px; color: #888; }
.ai-header-btn:hover, .ai-header-btn.is-active { color: #409eff; }
.ai-chat-settings { padding: 8px 12px; border-bottom: 1px solid #333; }
.ai-config-hint { margin: 6px 0 0; font-size: 11px; color: #888; }
.ai-chat-body { flex: 1; padding: 12px; overflow-y: auto; min-height: 0; }
.ai-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #888; }
.ai-empty-title { margin: 0 0 6px; color: #e5eaf3; font-size: 15px; }
.ai-empty-desc { margin: 0; font-size: 13px; line-height: 1.5; max-width: 260px; }
.ai-msg { margin-bottom: 10px; display: flex; }
.ai-msg.end { justify-content: flex-end; }
.ai-msg.start { justify-content: flex-start; }
.ai-msg-text, .ai-msg-loading { max-width: 88%; padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.ai-msg.end .ai-msg-text { background: #409eff; color: #fff; }
.ai-msg.start .ai-msg-text, .ai-msg-pending { background: #1a1a1a; color: #e5eaf3; border: 1px solid #404040; }
.ai-msg-pending { color: #888; font-style: italic; }
.ai-stream-tail { margin-left: 2px; }
.ai-dots { display: inline-flex; gap: 3px; align-items: center; margin-left: 4px; vertical-align: baseline; }
.ai-dots i {
  width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: .35;
  animation: ai-dot-bounce 1.2s ease-in-out infinite;
}
.ai-dots i:nth-child(2) { animation-delay: .15s; }
.ai-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes ai-dot-bounce {
  0%, 80%, 100% { opacity: .25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}
.ai-chat-footer { padding: 8px 12px 12px; border-top: 1px solid #404040; }
.ai-footer-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
.ai-history-panel { min-width: 200px; max-height: 260px; overflow-y: auto; padding: 4px 0; }
.ai-history-item { display: flex; align-items: center; padding: 8px 12px; gap: 4px; }
.ai-history-item:hover { background: #333; }
.ai-history-item.is-current .ai-history-title { color: #409eff; }
.ai-history-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: #ccc; cursor: pointer; }
.ai-history-del { color: #666; }
:global(.ai-history-dropdown.el-popper) { background: #2a2a2a !important; border: 1px solid #404040 !important; }
</style>
