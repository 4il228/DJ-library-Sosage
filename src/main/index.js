const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AuthService = require('./services/auth.service');
const { DiffEngine } = require('./engine/diff');
const { LoggerService } = require('./services/logger.service');

const logger = new LoggerService({ level: 'INFO' });

let mainWindow;
let authService;
let activeEngine;

function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('sync:progress', {
        status: 'ERROR',
        currentFile: `Critical error: ${err.message}`
      });
    } catch (e) { /* ignore */ }
  }
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : '';
  logger.error('Unhandled rejection', { message: msg, stack });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'public', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('icon:rendered', (event, pngBase64) => {
  try {
    const icon = nativeImage.createFromBuffer(Buffer.from(pngBase64, 'base64'));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIcon(icon);
    }
  } catch (err) {
    logger.warn('Failed to set custom icon from renderer', { message: err.message });
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  logger.setLogDir(path.join(app.getPath('userData'), 'logs'));
  logger.info('Application starting');

  app.setAppUserModelId('com.nikita.electron-drive-sync');

  createWindow();

  const config = loadConfig();
  authService = new AuthService({
    clientId: process.env.GOOGLE_CLIENT_ID || config.googleClientId || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || config.googleClientSecret || '',
    tokenDir: app.getPath('userData')
  });

  authService.loadTokens().then((loaded) => {
    if (loaded && authService.isLoggedIn()) {
      const user = authService.getUser();
      logger.info('Tokens loaded, user authenticated', { name: user?.name });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:success', user);
      }
    } else {
      logger.info('No saved tokens found');
    }
  }).catch((err) => {
    logger.warn('Failed to load tokens', { message: err.message });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  logger.info('Folder selected', { path: result.filePaths[0] });
  return result.filePaths[0];
});

ipcMain.on('auth:login', async () => {
  logger.info('Auth:login requested');
  try {
    const tokens = await authService.startAuth(mainWindow);
    await authService.saveTokens();
    const user = authService.getUser();
    logger.info('Auth:login succeeded', { name: user?.name });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:success', user);
    }
  } catch (err) {
    logger.error('Auth:login failed', { message: err.message });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:error', err.message || 'Authentication failed');
    }
  }
});

const SYNC_FOLDER_NAME = 'DJ library Sosage';

async function findOrCreateSyncFolder(accessToken) {
  const searchUrl = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    q: `name='${SYNC_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: '1'
  });

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!searchRes.ok) {
    throw new Error('Failed to search for sync folder on Google Drive');
  }

  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    logger.info('Sync folder found on Google Drive', { id: searchData.files[0].id });
    return searchData.files[0].id;
  }

  const createUrl = 'https://www.googleapis.com/drive/v3/files';
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: SYNC_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });

  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => '');
    throw new Error(`Failed to create sync folder: ${createRes.status} ${errBody}`);
  }

  const createData = await createRes.json();
  logger.info('Sync folder created on Google Drive', { id: createData.id });
  return createData.id;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

function sendProgress(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync:progress', data);
  }
}

async function uploadFile(accessToken, parentFolderId, localPath, relativePath, sem) {
  const stat = fs.statSync(localPath);
  const content = fs.readFileSync(localPath);

  const metadata = {
    name: path.basename(relativePath),
    parents: [parentFolderId]
  };

  return sem.run(async () => {
    const url = `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name`;
    const boundary = '-------' + crypto.randomBytes(16).toString('hex');
    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Type: application/json; charset=UTF-8\r\n\r\n`;
    body += `${JSON.stringify(metadata)}\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Type: application/octet-stream\r\n\r\n`;
    const bodyBuffer = Buffer.concat([
      Buffer.from(body, 'utf-8'),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8')
    ]);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(bodyBuffer.length)
      },
      body: bodyBuffer
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Upload failed for ${relativePath}: ${res.status} ${errBody}`);
    }

    return res.json();
  });
}

async function downloadFile(accessToken, driveId, localPath, sem) {
  return sem.run(async () => {
    const url = `${DRIVE_API}/files/${driveId}?alt=media`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw new Error(`Download failed for ${driveId}: ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
  });
}

const _ensureRemoteDirPromises = new Map();

async function ensureRemoteDir(accessToken, parentFolderId, relativeDir, sem) {
  if (!relativeDir) return parentFolderId;

  const cacheKey = `${parentFolderId}:${relativeDir}`;

  if (_ensureRemoteDirPromises.has(cacheKey)) {
    return _ensureRemoteDirPromises.get(cacheKey);
  }

  const promise = (async () => {
    const parts = relativeDir.split(path.sep).filter(Boolean);
    let currentParent = parentFolderId;

    for (const part of parts) {
      const searchUrl = `${DRIVE_API}/files?` + new URLSearchParams({
        q: `name='${part}' and '${currentParent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)',
        pageSize: '1'
      });

      const existing = await sem.run(async () => {
        const res = await fetch(searchUrl, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.files?.[0]?.id || null;
      });

      if (existing) {
        currentParent = existing;
      } else {
        currentParent = await sem.run(async () => {
          const res = await fetch(`${DRIVE_API}/files`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: part,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [currentParent]
            })
          });
          if (!res.ok) throw new Error(`Failed to create subfolder ${part}`);
          const data = await res.json();
          return data.id;
        });
      }
    }

    return currentParent;
  })();

  _ensureRemoteDirPromises.set(cacheKey, promise);
  promise.finally(() => _ensureRemoteDirPromises.delete(cacheKey));

  return promise;
}

ipcMain.on('sync:start', async (event, config) => {
  logger.info('Sync:start requested', { folderPath: config.folderPath });

  try {
    if (!authService || !authService.isLoggedIn()) {
      throw new Error('Not authenticated');
    }

    if (activeEngine) {
      logger.warn('Aborting previous sync engine');
      activeEngine.abort();
    }

    const accessToken = authService.getAccessToken();

    sendProgress({
      status: 'SYNC_HASHING',
      currentFile: 'Setting up Google Drive sync folder...',
      processedFiles: 0,
      totalFiles: 0,
      percentage: 0,
      speed: ''
    });

    const parentFolderId = await findOrCreateSyncFolder(accessToken);

    const engine = new DiffEngine({
      localPath: config.folderPath,
      accessToken,
      parentFolderId,
      maxConcurrentRequests: 3,
      onProgress: (data) => sendProgress(data)
    });

    activeEngine = engine;

    const result = await engine.run();

    const totalOps = result.toUpload.length + result.toDownload.length;

    if (totalOps === 0) {
      activeEngine = null;
      logger.info('Everything up to date');
      sendProgress({
        status: 'SYNC_COMPLETED',
        currentFile: 'All files are up to date',
        processedFiles: 0,
        totalFiles: 0,
        percentage: 100,
        speed: ''
      });
      return;
    }

    const Semaphore = require('./engine/diff').Semaphore;
    const sem = new Semaphore(3);
    let completedOps = 0;
    const startTime = Date.now();

    sendProgress({
      status: 'SYNC_PROCESSING',
      currentFile: `Uploading ${result.toUpload.length} files...`,
      processedFiles: 0,
      totalFiles: totalOps,
      percentage: 0,
      speed: ''
    });

    const uploadTasks = result.toUpload.map(async (file) => {
      if (activeEngine?.aborted) throw new Error('Aborted');

      const dir = path.dirname(file.relativePath);
      const targetFolderId = dir && dir !== '.'
        ? await ensureRemoteDir(accessToken, parentFolderId, dir, sem)
        : parentFolderId;

      await uploadFile(accessToken, targetFolderId, file.localPath, file.relativePath, sem);

      completedOps++;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? `${(completedOps / elapsed).toFixed(1)} files/s` : '';

      sendProgress({
        status: 'SYNC_PROCESSING',
        currentFile: `Uploaded: ${file.relativePath}`,
        processedFiles: completedOps,
        totalFiles: totalOps,
        percentage: Math.round((completedOps / totalOps) * 100),
        speed
      });
    });

    const downloadTasks = result.toDownload.map(async (file) => {
      if (activeEngine?.aborted) throw new Error('Aborted');

      const localPath = path.join(config.folderPath, file.relativePath);
      await downloadFile(accessToken, file.driveId, localPath, sem);

      completedOps++;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? `${(completedOps / elapsed).toFixed(1)} files/s` : '';

      sendProgress({
        status: 'SYNC_PROCESSING',
        currentFile: `Downloaded: ${file.relativePath}`,
        processedFiles: completedOps,
        totalFiles: totalOps,
        percentage: Math.round((completedOps / totalOps) * 100),
        speed
      });
    });

    await Promise.all([...uploadTasks, ...downloadTasks]);

    activeEngine = null;

    logger.info('Sync completed', {
      upload: result.toUpload.length,
      download: result.toDownload.length,
      conflicts: result.conflicts.length
    });

    sendProgress({
      status: 'SYNC_COMPLETED',
      currentFile: `Upload: ${result.toUpload.length}, Download: ${result.toDownload.length}`,
      processedFiles: totalOps,
      totalFiles: totalOps,
      percentage: 100,
      speed: ''
    });
  } catch (err) {
    activeEngine = null;
    if (err.message === 'Aborted') {
      logger.info('Sync aborted by user');
      return;
    }
    logger.error('Sync failed', { message: err.message });
    sendProgress({
      status: 'ERROR',
      currentFile: err.message
    });
  }
});
