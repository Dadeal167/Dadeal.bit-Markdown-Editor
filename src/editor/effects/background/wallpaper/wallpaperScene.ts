import type { PropertyValue } from 'webwallgl'

export interface WallpaperSceneProperty {
  type: 'combo' | 'bool' | 'slider' | 'color' | 'textinput'
  text: string
  value: PropertyValue
  options?: { label: string; value: string }[]
  min?: number
  max?: number
  step?: number
}

export interface WallpaperSceneSource {
  kind: 'scene'
  name: string
  files: { path: string; file: File }[]
  entry: string
  project: Record<string, unknown>
  properties: Record<string, WallpaperSceneProperty>
}

export interface WallpaperWebSource extends Omit<WallpaperSceneSource, 'kind'> {
  kind: 'web'
}

export type WallpaperSource = WallpaperSceneSource | WallpaperWebSource

export function scenePropertyDefinitions(project: Record<string, unknown>) {
  const general = project.general as { properties?: Record<string, unknown> } | undefined
  const definitions: Record<string, WallpaperSceneProperty> = {}
  for (const [key, value] of Object.entries(general?.properties ?? {})) {
    if (!value || typeof value !== 'object' || ['__proto__', 'constructor', 'prototype'].includes(key)) continue
    const property = value as WallpaperSceneProperty
    if (!['combo', 'bool', 'slider', 'color', 'textinput'].includes(property.type) ||
        !['string', 'boolean', 'number'].includes(typeof property.value)) continue
    if (property.type === 'combo' && !Array.isArray(property.options)) continue
    definitions[key] = {
      ...property,
      text: typeof property.text === 'string' ? property.text : key,
      value: property.type === 'combo' ? String(property.value) : property.value,
      options: Array.isArray(property.options) ? property.options
        .filter((option) => option && typeof option.label === 'string' && ['string', 'number'].includes(typeof option.value))
        .map((option) => ({ label: option.label, value: String(option.value) })) : undefined,
    }
  }
  return definitions
}

const propertyStorageKey = (id: string) => 'md-editor-wallpaper-properties-v1:' + id

function followsClock(label: string) {
  const text = label.replace(/<[^>]*>/g, ' ').trim()
  if (/不随|关闭|禁用|\b(?:disable|do not)\b/i.test(text)) return false
  return /随(?:本机|本地|电脑|系统|现实|真实|实际)时间(?:自动)?(?:变化|切换)|\b(?:follow|sync with|changes in)\s+(?:the\s+)?(?:local|system|real|actual)[ -](?:time|clock)\b/i.test(text)
}

function automaticPropertyDefault(definition: WallpaperSceneProperty): PropertyValue {
  if (definition.type === 'bool' && followsClock(definition.text)) return true
  if (definition.type === 'combo') {
    const options = definition.options?.filter(({ label }) => followsClock(label))
    if (options?.length === 1) return options[0].value
  }
  return definition.value
}

export function loadSceneProperties(id: string, definitions: WallpaperSceneSource['properties']) {
  let saved: Record<string, unknown> = {}
  try { saved = JSON.parse(localStorage.getItem(propertyStorageKey(id)) ?? '{}') ?? {} } catch { /* 使用项目默认属性。 */ }
  const properties: Record<string, PropertyValue> = {}
  for (const [key, definition] of Object.entries(definitions)) {
    const value = saved[key]
    const valid = typeof value === typeof definition.value &&
      (definition.type !== 'combo' || definition.options?.some((option) => option.value === value)) &&
      (definition.type !== 'slider' || typeof value === 'number' && Number.isFinite(value) &&
        value >= (definition.min ?? -Infinity) && value <= (definition.max ?? Infinity))
    properties[key] = valid ? value as PropertyValue : automaticPropertyDefault(definition)
  }
  return properties
}

export function saveSceneProperties(id: string, properties: Record<string, PropertyValue>) {
  localStorage.setItem(propertyStorageKey(id), JSON.stringify(properties))
}
