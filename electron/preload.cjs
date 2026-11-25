const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('claudePanel', {
  platform: process.platform,
  isElectron: true,
  /**
   * Native folder picker.
   * Default: multi-select (⌘/Ctrl). Returns string[] (empty if cancelled).
   * Pass { multi: false } to get a single path string | null.
   */
  selectFolder: (opts) => ipcRenderer.invoke('dialog:openDirectory', opts || {}),
  /** Copy image bytes (ArrayBuffer / number[]) to system clipboard. */
  copyImage: (payload) => ipcRenderer.invoke('clipboard:copyImage', payload || {}),
})
