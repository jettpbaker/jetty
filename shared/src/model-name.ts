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
  const name = model.provider === 'claude' ? claudeModelName(model.id, model.name) : model.name
  return model.contextWindow === '1m' || /\[1m\]$/i.test(model.id) ? `${name} · 1M` : name
}
