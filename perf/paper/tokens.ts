import { join } from 'node:path'

import type { Page } from '../driver'

import { repoRoot } from '../app'

export type Theme = 'dark' | 'light' | 'oled'
export type Token = { name: string; value: string }

export async function readTokens(page: Page, theme: Theme) {
  const css = await Bun.file(join(repoRoot, 'client/src/index.css')).text()
  const colors = [...css.matchAll(/--color-([\w-]+): var\(--([\w-]+)\)/g)].map((match) => ({
    name: match[1]!,
    source: match[2]!,
  }))
  const unique = [...new Map(colors.map((color) => [color.name, color])).values()]
  const resolved = await page.evaluate<Record<string, string>>(`(() => {
    const probe = document.createElement('div'); document.body.append(probe)
    const values = {}
    for (const color of ${JSON.stringify(unique)}) { probe.style.backgroundColor = 'var(--'+color.source+')'; values[color.name] = getComputedStyle(probe).backgroundColor }
    probe.remove();return values
  })()`)
  const prefix = theme === 'dark' ? '--color-app-' : `--color-app-${theme}-`
  const tokens: Token[] = Object.entries(resolved).map(([name, value]) => ({
    name: `${prefix}${name}`,
    value,
  }))
  if (theme === 'dark') {
    const radii = Object.fromEntries(
      [...css.matchAll(/--radius-([\w-]+): ([^;]+);/g)].map((match) => [match[1], match[2]])
    )
    const sizes = await page.evaluate<Record<string, string>>(`(() => {
      const probe=document.createElement('div');document.body.append(probe);const values={}
      for (const [name,value] of Object.entries(${JSON.stringify(radii)})) {probe.style.borderRadius=value;values['--radius-app-'+name]=getComputedStyle(probe).borderTopLeftRadius}
      probe.remove();return values
    })()`)
    tokens.push(...Object.entries(sizes).map(([name, value]) => ({ name, value })))
    tokens.push(
      { name: '--font-app-sans', value: 'Geist' },
      { name: '--font-app-mono', value: 'Geist Mono' },
      ...[12, 13, 14, 16, 18, 20, 24].map((size) => ({
        name: `--text-app-${size}`,
        value: `${size}px`,
      })),
      ...[400, 500, 600, 700].map((weight) => ({
        name: `--font-weight-app-${weight}`,
        value: String(weight),
      })),
      ...[4, 8, 12, 16, 24, 32].map((size) => ({
        name: `--spacing-app-${size}`,
        value: `${size}px`,
      })),
      { name: '--spacing-app-glyph', value: '18px' },
      { name: '--spacing-app-menu-item-compact', value: '26px' },
      { name: '--breakpoint-app-sm', value: '640px' },
      { name: '--container-app-settings', value: '708px' },
      { name: '--opacity-app-muted', value: '50%' },
      { name: '--tracking-app-normal', value: '0em' },
      { name: '--leading-app-body', value: '20px' },
      { name: '--leading-app-13', value: '18px' }
    )
  }
  const references: Record<string, string> = {}
  for (const entry of tokens)
    if (entry.name.startsWith('--color-') && !references[entry.value])
      references[entry.value] = entry.name
  return { tokens, references, colors: resolved }
}

export function foundationExpression(theme: Theme, colors: Record<string, string>) {
  return `(() => {
    const icons=[...document.querySelectorAll('svg')].slice(0,24).map(svg=>{const clone=svg.cloneNode(true);clone.removeAttribute('class');clone.setAttribute('width','20');clone.setAttribute('height','20');clone.style.color='var(--foreground)';return clone.outerHTML})
    const foundation=document.createElement('div');foundation.id='paper-foundations';foundation.style.cssText='position:fixed;inset:0;z-index:99999;width:1100px;height:1320px;background:var(--background);color:var(--foreground);padding:32px;display:flex;flex-direction:column;gap:28px;font-family:Geist Variable'
    foundation.innerHTML='<div style="font-size:24px;font-weight:600">Jetty foundations · ${theme}</div><div style="font-size:14px;color:var(--muted-foreground)">Generated from client/src/index.css · default accent and neutral tint</div>'
    const palette=document.createElement('div');palette.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:16px'
    for(const [name,value] of Object.entries(${JSON.stringify(colors)})){const swatch=document.createElement('div');swatch.style.cssText='display:flex;flex-direction:column;gap:6px';const color=document.createElement('div');color.style.cssText='height:34px;border:1px solid var(--border);border-radius:6px';color.style.backgroundColor=value;const label=document.createElement('div');label.textContent=name;label.style.cssText='font-size:12px;font-family:Geist Mono Variable';swatch.append(color,label);palette.append(swatch)}
    foundation.append(palette)
    const type=document.createElement('div');type.style.cssText='display:flex;align-items:baseline;gap:24px';for(const size of [12,13,14,16,18,20,24]){const label=document.createElement('div');label.textContent='Geist '+size;label.style.fontSize=size+'px';type.append(label)}foundation.append(type)
    const mono=document.createElement('div');mono.textContent='Geist Mono · src/cache.ts · main · a7b4527 · 2m · 52k / 200k';mono.style.cssText='font-family:Geist Mono Variable;font-size:13px';foundation.append(mono)
    const radii=document.createElement('div');radii.style.cssText='display:flex;gap:16px';for(const name of ['menu-item','sm','md','lg','xl','2xl']){const shape=document.createElement('div');shape.textContent=name;shape.style.cssText='width:120px;height:56px;display:flex;align-items:center;justify-content:center;background:var(--card);border:1px solid var(--border);font-size:13px';shape.style.borderRadius=name==='menu-item'?'4px':'calc(var(--radius)*'+({sm:0.6,md:0.8,lg:1,xl:1.4,'2xl':1.8})[name]+')';radii.append(shape)}foundation.append(radii)
    const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:20px';row.innerHTML=icons.join('');foundation.append(row)
    document.body.append(foundation)
  })()`
}

export function iconCatalogExpression() {
  return `(async () => {
    const react=await import('/node_modules/.vite/deps/react.js');const {createElement}=react.default ?? react
    const client=await import('/node_modules/.vite/deps/react-dom_client.js');const {createRoot}=client.default ?? client
    const huge=await import('/src/components/custom/huge_icons.tsx')
    const lucide=await import('/src/components/custom/lucide_icons.tsx')
    const icons=[...Object.entries(huge).filter(([name])=>name.endsWith('Icon')),...Object.entries(lucide)]
    const height=Math.ceil(icons.length/4)*52+120
    const host=document.createElement('div');host.id='paper-icon-catalog';host.style.cssText='position:fixed;inset:0;z-index:99999;width:1100px;height:'+height+'px;background:var(--background);color:var(--foreground);padding:32px;display:flex;flex-direction:column;gap:24px;font-family:Geist Variable'
    document.body.append(host)
    createRoot(host).render(createElement('div',{style:{display:'flex',flexDirection:'column',gap:24}},[
      createElement('div',{key:'title',style:{fontSize:24,fontWeight:600}},'Jetty icon catalog'),
      createElement('div',{key:'grid',style:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16}},icons.map(([name,Icon],index)=>createElement('div',{key:name+index,style:{display:'flex',alignItems:'center',gap:12,height:36}},[createElement(Icon,{key:'icon',size:18}),createElement('div',{key:'label',style:{fontSize:12,fontFamily:'Geist Mono Variable'}},name)])))
    ]))
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    return height
  })()`
}
