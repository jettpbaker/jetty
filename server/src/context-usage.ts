import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ContextUsage } from '@jetty/shared/events'

/** Only place the SDK getContextUsage method name may appear. */
export async function readContextUsage(query: Query): Promise<ContextUsage | null> {
  if (typeof query.getContextUsage !== 'function') return null
  try {
    const response = await query.getContextUsage()
    const maxTokens = Number(response.maxTokens)
    const totalTokens = Number(response.totalTokens)
    if (!Number.isFinite(maxTokens) || maxTokens <= 0) return null
    if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null

    const max = Math.round(maxTokens)
    const usedTokens = Math.min(Math.round(totalTokens), max)

    const slices: ContextUsage['slices'] = []
    for (const cat of response.categories ?? []) {
      const tokens = Math.round(Number(cat.tokens))
      if (!Number.isFinite(tokens) || tokens <= 0) continue
      if (typeof cat.name === 'string' && cat.name.toLowerCase() === 'free space') continue
      slices.push({ label: String(cat.name), tokens })
    }

    const threshold = response.autoCompactThreshold
    const compactAt =
      response.isAutoCompactEnabled &&
      threshold != null &&
      Number.isFinite(threshold) &&
      threshold > 0
        ? Math.round(threshold)
        : undefined

    const model =
      typeof response.model === 'string' && response.model.length > 0 ? response.model : undefined

    return {
      usedTokens,
      maxTokens: max,
      ...(compactAt != null ? { compactAt } : {}),
      slices,
      ...(model ? { model } : {}),
      asOf: Date.now(),
    }
  } catch {
    // closing query throws; treat as miss
    return null
  }
}
