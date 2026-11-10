// רגעים – desktop shell. The editor itself lives in app/ (the same app as the web version).
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const APP_DIR = path.join(__dirname, 'app');
const TMP_DIR = path.join(os.tmpdir(), 'regaim');
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');

// app:// behaves like a real https origin, so IndexedDB, fetch and workers all work
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function ffmpegPath() {
  let p = require('ffmpeg-static');
  // inside the installed app the binary sits next to the asar archive, not in it
  return p ? p.replace('app.asar', 'app.asar.unpacked') : 'ffmpeg';
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')); } catch { return {}; }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS()), { recursive: true });
  fs.writeFileSync(SETTINGS(), JSON.stringify(s, null, 2));
}
function getKey() {
  const s = readSettings();
  if (!s.key) return '';
  try { return s.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(s.key, 'base64')) : s.key; } catch { return ''; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0e0c12', title: 'רגעים', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL('app://regaim/index.html');
  // links open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F5') win.webContents.reload();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || !rel) rel = '/index.html';
    // converted videos are served from the temp folder
    const base = rel.startsWith('/__tmp/') ? TMP_DIR : APP_DIR;
    const file = path.normalize(path.join(base, rel.replace(/^\/__tmp\//, '/')));
    if (!file.startsWith(base)) return new Response('forbidden', { status: 403 });
    if (!fs.existsSync(file)) { if (!app.isPackaged) console.log('[app://] missing', rel); return new Response('not found', { status: 404 }); }
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  setupUpdates();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {} });

/* ---------- saving files to a folder ---------- */
ipcMain.handle('save-file', async (_e, { name, data }) => {
  const ext = path.extname(name).slice(1).toLowerCase();
  const filters = ext === 'zip' ? [{ name: 'פרויקט רגעים', extensions: ['zip'] }] : [{ name: 'וידאו', extensions: [ext || 'mp4'] }];
  const dir = ext === 'zip' ? app.getPath('documents') : app.getPath('videos');
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(dir, name), filters });
  if (r.canceled || !r.filePath) return { canceled: true };
  await fs.promises.writeFile(r.filePath, Buffer.from(data));
  return { ok: true, path: r.filePath };
});
ipcMain.handle('show-file', (_e, p) => { if (p) shell.showItemInFolder(p); });

/* ---------- video conversion with the full FFmpeg ---------- */
ipcMain.handle('convert', async (e, { input, name }) => {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const out = path.join(TMP_DIR, id + '.mp4');
  const args = ['-hide_banner', '-y', '-i', input,
    '-vf', "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out];
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { windowsHide: true });
    let dur = 0, err = '';
    p.stderr.on('data', (b) => {
      const s = b.toString(); err = (err + s).slice(-4000);
      const d = s.match(/Duration: (\d+):(\d+):([\d.]+)/); if (d) dur = +d[1] * 3600 + +d[2] * 60 + +d[3];
      const t = s.match(/time=(\d+):(\d+):([\d.]+)/);
      if (t && dur) e.sender.send('convert-progress', { input, p: Math.min(1, (+t[1] * 3600 + +t[2] * 60 + +t[3]) / dur) });
    });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve({ url: 'app://regaim/__tmp/' + id + '.mp4', name: name.replace(/\.[^.]+$/, '') + '.mp4' }) : reject(new Error('ffmpeg ' + code + ': ' + err.slice(-300))));
  });
});

/* ---------- Claude, with the user's own API key ---------- */
ipcMain.handle('key-status', () => ({ has: !!getKey() }));
ipcMain.handle('key-set', (_e, key) => {
  const s = readSettings();
  key = String(key || '').trim();
  if (!key) { delete s.key; delete s.enc; }
  else if (safeStorage.isEncryptionAvailable()) { s.key = safeStorage.encryptString(key).toString('base64'); s.enc = true; }
  else { s.key = key; s.enc = false; }
  writeSettings(s);
  return { has: !!key };
});
const MODELS = { default: 'claude-sonnet-5-5', quick: 'claude-haiku-5-5' };
ipcMain.handle('claude-json', async (_e, { prompt, images, tier }) => {
  const key = getKey();
  if (!key) throw new Error('[not_granted] no key');
  const content = [...(images || []).map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } })), { type: 'text', text: prompt }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELS[tier] || MODELS.default, max_tokens: 4000, messages: [{ role: 'user', content }] })
  });
  if (!res.ok) { const t = await res.text(); const code = res.status === 429 ? 'rate_limited' : res.status === 401 || res.status === 403 ? 'not_granted' : 'unavailable'; throw new Error('[' + code + '] api ' + res.status + ' ' + t.slice(0, 200)); }
  const j = await res.json();
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw new Error('no json');
  return JSON.parse(m[0]);
});

/* ---------- updates from GitHub Releases ---------- */
let updateState = { status: 'idle', version: null };
function sendUpdate() { if (win && !win.isDestroyed()) win.webContents.send('update-state', updateState); }
function setupUpdates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => { updateState = { status: 'checking' }; sendUpdate(); });
  autoUpdater.on('update-available', (i) => { updateState = { status: 'downloading', version: i.version, p: 0 }; sendUpdate(); });
  autoUpdater.on('download-progress', (p) => { updateState = { ...updateState, status: 'downloading', p: p.percent / 100 }; sendUpdate(); });
  autoUpdater.on('update-not-available', () => { updateState = { status: 'latest' }; sendUpdate(); });
  autoUpdater.on('error', (e) => { updateState = { status: 'error', message: String(e && e.message || e).slice(0, 200) }; sendUpdate(); });
  autoUpdater.on('update-downloaded', async (i) => {
    updateState = { status: 'ready', version: i.version }; sendUpdate();
    const r = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['להפעיל מחדש עכשיו', 'אחר כך'], defaultId: 0, cancelId: 1,
      title: 'עדכון מוכן', message: `גרסה ${i.version} של רגעים מוכנה`,
      detail: 'הפרויקט שלך נשמר. אחרי ההפעלה מחדש הוא ייפתח בדיוק איפה שעצרת. אם תבחר "אחר כך", העדכון יותקן כשתסגור את התוכנה.'
    });
    if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });
  ipcMain.handle('update-check', () => autoUpdater.checkForUpdates().catch(() => null));
  ipcMain.handle('update-install', () => { setImmediate(() => autoUpdater.quitAndInstall(false, true)); return true; });
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600 * 1000);
}
ipcMain.handle('update-state', () => updateState);
ipcMain.handle('app-info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
