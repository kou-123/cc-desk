/** Curated Claude Code slash commands useful in the panel chat. */
export type SlashCommand = {
  cmd: string
  label: string
  detail: string
  /** Insert with a trailing space so user can add args. */
  insertSpace?: boolean
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    cmd: '/compact',
    label: '压缩上下文',
    detail: '总结对话以释放上下文，可加说明引导摘要重点',
    insertSpace: true,
  },
  {
    cmd: '/context',
    label: '查看上下文占用',
    detail: '可视化当前上下文用量与优化建议',
  },
  {
    cmd: '/clear',
    label: '清空会话',
    detail: '开启空上下文的新对话（同会话目录下重新开始）',
  },
  {
    cmd: '/cost',
    label: '用量与费用',
    detail: '查看本次会话用量（/usage 别名）',
  },
  {
    cmd: '/model',
    label: '切换模型',
    detail: '打开 Claude Code 模型选择（命令行会话更完整）',
  },
  {
    cmd: '/plan',
    label: '计划模式',
    detail: '进入 plan mode，先规划再改代码',
  },
  {
    cmd: '/rewind',
    label: '回退检查点',
    detail: '回退对话或代码到检查点，也可局部摘要',
  },
  {
    cmd: '/doctor',
    label: '环境检查',
    detail: '诊断 Claude Code 安装与配置问题',
  },
  {
    cmd: '/help',
    label: '帮助',
    detail: '显示 Claude Code 帮助信息',
  },
]

/** Match `/` at the start of the input (optional filter text after). */
export function slashQuery(text: string): string | null {
  if (!text.startsWith('/')) return null
  if (/\s/.test(text)) return null
  return text.slice(1).toLowerCase()
}

export function filterSlashCommands(query: string | null): SlashCommand[] {
  if (query == null) return []
  if (!query) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (c) =>
      c.cmd.slice(1).toLowerCase().includes(query) ||
      c.label.toLowerCase().includes(query) ||
      c.detail.toLowerCase().includes(query),
  )
}
