import type { LobbyScene } from './lobbyAssets'

export const hasBuiltInLobby = false

export async function loadLobby(_files: File[] | null): Promise<LobbyScene> {
  throw new Error('当前构建未启用 Spine 播放。')
}
