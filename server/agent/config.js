/** 读取 AI_API_KEY、模型名等环境变量 */
export function getAgentConfig(overrides = {}) {
  const apiKey = overrides.apiKey || process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('服务端未配置 AI_API_KEY 或 DEEPSEEK_API_KEY')

  return {
    baseURL: (overrides.baseURL || process.env.AI_BASE_URL || 'https://api.deepseek.com/anthropic').replace(/\/+$/, ''),
    apiKey,
    model: overrides.model || process.env.AI_MODEL || 'deepseek-v4-flash',
    plannerModel: process.env.AI_PLANNER_MODEL || overrides.model || process.env.AI_MODEL || 'deepseek-v4-pro',
  }
}
