/** Included allowances only. Wallet balances / paid overage are deliberately separate.
 * Windows come from the connected account, not a hard-coded plan-to-limit table.
 * References (checked 2026-09-17):
 * Claude: https://support.claude.com/en/articles/11049741-what-is-the-max-plan
 * Codex: https://learn.chatgpt.com/docs/pricing
 * Grok: https://docs.x.ai/grok/faq
 * Copilot: https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing
 */
export type UsageWindow = {
  id: string
  period: 'five-hour' | 'weekly' | 'calendar-month'
  label: string
  scope: string
  usedPercent: number | null
  resetsAt: number | null
}

export type ProviderUsage = {
  id: 'anthropic' | 'openai' | 'xai' | 'copilot'
  name: string
  plan: string
  windows: UsageWindow[]
}

// Design fixtures, not live account usage. Include every provider for comparison.
export function createUsagePreview(now: number): ProviderUsage[] {
  const hours = (value: number) => now + value * 3_600_000
  const date = new Date(now)
  return [
    {
      id: 'anthropic',
      name: 'Claude',
      plan: 'Max 5×',
      windows: [
        {
          id: 'session',
          period: 'five-hour',
          label: '5 hour',
          scope: 'Shared across Claude and Claude Code',
          usedPercent: 67,
          resetsAt: hours(2.25),
        },
        {
          id: 'weekly',
          period: 'weekly',
          label: 'Weekly',
          scope: 'All models',
          usedPercent: 19,
          resetsAt: hours(78),
        },
      ],
    },
    {
      id: 'openai',
      name: 'Codex',
      plan: 'Pro 5×',
      windows: [
        {
          id: 'session',
          period: 'five-hour',
          label: '5 hour',
          scope: 'Shared local and cloud usage',
          usedPercent: 32,
          resetsAt: hours(3.2),
        },
        {
          id: 'weekly',
          period: 'weekly',
          label: 'Weekly',
          scope: 'Account weekly allowance, when applicable',
          usedPercent: 48,
          resetsAt: hours(49),
        },
      ],
    },
    {
      id: 'xai',
      name: 'Grok',
      plan: 'SuperGrok',
      windows: [
        {
          id: 'weekly',
          period: 'weekly',
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
      windows: [
        {
          id: 'monthly',
          period: 'calendar-month',
          label: 'Monthly',
          scope: 'Included plan allowance · resets on the 1st at 00:00 UTC',
          usedPercent: 24,
          resetsAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
        },
      ],
    },
  ]
}

export function usageResetLabel(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return 'Reset time unavailable'
  const minutes = Math.ceil((resetsAt - now) / 60_000)
  if (minutes <= 0) return 'Reset pending'
  if (minutes >= 1440)
    return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 60) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `Resets in ${minutes}m`
}
