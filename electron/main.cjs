// Electron main process — fully offline.
// Serves the Vite production build (dist/) over a privileged `app://` scheme
// so fetch()/modulepreload work exactly like on the web, with no network access.
// TTS is bridged to the macOS `say` command (offline, system voices).

const { app, BrowserWindow, ipcMain, protocol, net } = require('electron')
const { spawn } = require('child_process')
const { join, normalize, extname } = require('path')
const { pathToFileURL } = require('url')
const { existsSync } = require('fs')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

const distDir = join(__dirname, '..', 'dist')

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: '드라마로 배우는 외국어',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadURL('app://local/')
}

let currentSay = null

function registerIpc() {
  ipcMain.handle('cdt:speak', (_event, text, lang) => {
    if (typeof text !== 'string' || !text.trim()) return false
    const voice = lang === 'zh' ? 'Tingting' : 'Samantha'
    try {
      if (currentSay) {
        currentSay.kill()
        currentSay = null
      }
      const child = spawn('say', ['-v', voice, '-r', '170', text.trim()])
      currentSay = child
      const clear = () => {
        if (currentSay === child) currentSay = null
      }
      child.on('exit', clear)
      child.on('error', clear)
      return true
    } catch {
      return false
    }
  })
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    let p = decodeURIComponent(url.pathname)
    if (p === '/' || p === '') p = '/index.html'
    let filePath = normalize(join(distDir, p))
    if (!filePath.startsWith(distDir)) {
      return new Response('Forbidden', { status: 403 })
    }
    // SPA fallback: unknown extension-less paths serve the app shell.
    if (!existsSync(filePath) && !extname(filePath)) {
      filePath = join(distDir, 'index.html')
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
  else app.quit() // single-purpose learning app: quit on close even on macOS
})
