// Included allowances only; wallet balances and paid overage are deliberately separate.
export type UsageWindow = {
  id: string
  label: string
  scope: string
  usedPercent: number
  resetsAt: number
}

export type ProviderUsage = {
  id: 'claude' | 'codex' | 'grok' | 'copilot'
  name: string
  plan: string
  windows: UsageWindow[]
}

export function createUsagePreview(now: number): ProviderUsage[] {
  const hours = (value: number) => now + value * 3_600_000
  return [
    {
      id: 'claude',
      name: 'Claude',
      plan: 'Max 5×',
      windows: [
        {
          id: 'session',
          label: '5 hour',
          scope: 'Shared across Claude and Claude Code',
          usedPercent: 67,
          resetsAt: hours(2.25),
        },
        {
          id: 'weekly',
          label: 'Weekly',
          scope: 'All models',
          usedPercent: 19,
          resetsAt: hours(78),
        },
      ],
    },
    {
      id: 'codex',
      name: 'Codex',
      plan: 'Pro 5×',
      windows: [
        {
          id: 'session',
          label: '5 hour',
          scope: 'Shared local and cloud usage',
          usedPercent: 32,
          resetsAt: hours(3.2),
        },
        {
          id: 'weekly',
          label: 'Weekly',
          scope: 'Account weekly allowance, when applicable',
          usedPercent: 48,
          resetsAt: hours(49),
        },
      ],
    },
    {
      id: 'grok',
      name: 'Grok',
      plan: 'SuperGrok',
      windows: [
        {
          id: 'weekly',
          label: 'Weekly',
          scope: 'Shared across Grok products',
          usedPercent: 86,
          resetsAt: hours(31),
        },
      ],
    },
    {
      id: 'copilot',
      name: 'Copilot',
      plan: 'Pro',
      windows: [],
    },
  ]
}

export function usageResetLabel(resetsAt: number, now: number): string {
  const minutes = Math.ceil((resetsAt - now) / 60_000)
  if (minutes <= 0) return 'Reset pending'
  if (minutes >= 1440)
    return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 60) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `Resets in ${minutes}m`
}
