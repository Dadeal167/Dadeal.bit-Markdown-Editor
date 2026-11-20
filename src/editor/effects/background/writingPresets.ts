import type { LobbyLayout, LobbyOptions } from './lobbySettings'

const key = 'dadealbit-writing-presets-v1'

export interface WritingPreset {
  id: string
  name: string
  historyId?: string
  layout: LobbyLayout
  options: LobbyOptions
}

export interface WritingPresets {
  presets: WritingPreset[]
  bindings: Record<string, string>
}

export function loadWritingPresets(): WritingPresets {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (value && Array.isArray(value.presets) && value.bindings && typeof value.bindings === 'object') {
      return {
        presets: value.presets.filter((preset: WritingPreset) => typeof preset?.id === 'string' &&
          typeof preset.name === 'string' && preset.layout && typeof preset.options?.enabled === 'boolean'),
        bindings: value.bindings,
      }
    }
  } catch { /* 首次加载或存储不可用。 */ }
  return { presets: [], bindings: {} }
}

export function saveWritingPresets(value: WritingPresets) {
  localStorage.setItem(key, JSON.stringify(value))
}
