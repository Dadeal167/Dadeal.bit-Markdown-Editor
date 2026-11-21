interface NativeWallpaperCapture {
  captureId: string
  nativeProjectId: string
  name: string
}

interface Window {
  dadealbitDesktop?: {
    armWallpaper(id?: string): Promise<void>
    wallpaperResult(): Promise<NativeWallpaperCapture | { error: string } | undefined>
    releaseWallpaper(id: string): Promise<void>
    startZhihuAssistant(): Promise<{ address: string; token: string; managed: boolean }>
    stopZhihuAssistant(): Promise<void>
  }
}
