export function claudeModelName(value: string, displayName: string, description = ''): string {
  const lead = description.split(' · ')[0]?.replace(/ with 1M context$/i, '')
  const clean = displayName.replace(/\s*\(1M context\)$/i, '')
  if (lead?.startsWith(`${clean} `) && /\d/.test(lead)) return lead
  if (/\d/.test(clean)) return clean
  return clean || lead || value
}

export function modelLabelText(model: {
  provider: string
  id: string
  name: string
  contextWindow?: '1m'
}): string {
  return model.provider === 'claude' ? claudeModelName(model.id, model.name) : model.name
}

// Providers rename a model's context variant (`opus` ↔ `opus[1m]`), stranding saved IDs.
export function baseModelId(id: string) {
  return id.replace(/\[1m\]$/i, '').toLowerCase()
}
