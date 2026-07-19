// Preload: expose a minimal, safe bridge for offline TTS.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nativeSpeak', (text, lang) =>
  ipcRenderer.invoke('cdt:speak', text, lang),
)
