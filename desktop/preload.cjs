const { contextBridge, ipcRenderer } = require('electron')

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('dadealbitDesktop', {
    armWallpaper: (id) => ipcRenderer.invoke('wallpaper:arm', id),
    wallpaperResult: () => ipcRenderer.invoke('wallpaper:result'),
    releaseWallpaper: (id) => ipcRenderer.invoke('wallpaper:release', id),
  })
}
