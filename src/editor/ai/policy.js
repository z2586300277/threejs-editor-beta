const HIGH_RISK_ADVANCED_TOOLS = new Set([
  'loadScene',
])

const HIGH_RISK_EDITOR_ACTIONS = new Set([
  'clearEditorCache',
  'switchScene',
  'createSceneSlot',
  'deleteSceneSlot',
  'setPixelRatio',
  'setLogDepthBuffer',
  'applyTheatreAnimation',
  'clearTheatreAnimation',
])

const ONLINE_MODEL_ACTIONS = new Set([
  'loadOnlineModel',
])

const DANGER_WORDS = /清空|清除|删除|重置|重载|覆盖|切换场景|缓存|reload|reset|clear/i
const CONFIRM_WORDS = /确认|确定|同意|允许|继续|执行|立即|就是要|放心做|强制|承担风险|我知道后果|confirm|yes|ok/i
const ONLINE_WORDS = /在线|联网|网络|url|链接|http|https|官方|远程|外部|下载|threejs|three\.js/i

function hasDangerConsent(userMessage = '') {
  const text = String(userMessage || '').trim()
  if (!text) return false
  return DANGER_WORDS.test(text) && CONFIRM_WORDS.test(text)
}

function hasOnlineConsent(userMessage = '') {
  const text = String(userMessage || '').trim()
  if (!text) return false
  return ONLINE_WORDS.test(text)
}

function blocked(label) {
  return {
    error: `安全策略已拦截「${label}」。请在同一句明确确认危险操作，例如：确认清空缓存并重载。`,
    blocked: true,
    risk: 'high',
  }
}

export function guardAdvancedInvocation({ userMessage, toolName, input } = {}) {
  if (!toolName) return null

  if (HIGH_RISK_ADVANCED_TOOLS.has(toolName) && !hasDangerConsent(userMessage)) {
    return blocked(toolName)
  }

  if (toolName === 'runEditorAction') {
    const action = input?.action
    if (action && HIGH_RISK_EDITOR_ACTIONS.has(action) && !hasDangerConsent(userMessage)) {
      return blocked(`runEditorAction(${action})`)
    }
    if (action && ONLINE_MODEL_ACTIONS.has(action) && !hasOnlineConsent(userMessage)) {
      return {
        error: '已拦截外部模型加载。默认优先使用编辑器本地模型库。',
        blocked: true,
        risk: 'medium',
        hint: '先 listResources 查看 models，再 addModel({ urlOrName })；仅当用户明确要求在线 URL 时才用 runEditorAction(loadOnlineModel)。',
      }
    }
  }

  return null
}

export function safetyPromptAddon() {
  return [
    '安全策略：默认禁止危险操作（清缓存、切场景、重载、删除场景槽、改像素比/深度缓冲、应用/清除 Theatre 动画）。',
    '只有用户在同一句里明确确认危险意图时，才允许执行。',
    '模型策略：默认优先编辑器本地模型库（listResources + addModel），不要擅自走外网模型 URL。',
  ].join('\n')
}
