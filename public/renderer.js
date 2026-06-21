function generateWindowIcon() {
  const api = window.electronAPI;
  if (!api) return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 64, 64);
    const pngBase64 = canvas.toDataURL('image/png').split(',')[1];
    api.setWindowIcon(pngBase64);
  };
  img.src = 'logo.svg';
}

const STATES = Object.freeze({
  IDLE: 'IDLE',
  AUTH_PENDING: 'AUTH_PENDING',
  AUTHORIZED: 'AUTHORIZED',
  SYNC_HASHING: 'SYNC_HASHING',
  SYNC_PROCESSING: 'SYNC_PROCESSING',
  SYNC_COMPLETED: 'SYNC_COMPLETED',
  ERROR: 'ERROR'
});

const STATE_LABELS = Object.freeze({
  IDLE: 'Idle',
  AUTH_PENDING: 'Authenticating...',
  AUTHORIZED: 'Authorized',
  SYNC_HASHING: 'Hashing files...',
  SYNC_PROCESSING: 'Syncing...',
  SYNC_COMPLETED: 'Completed',
  ERROR: 'Error'
});

const MAX_LOG_LINES = 200;

class SyncWidget {
  constructor() {
    this.state = STATES.IDLE;
    this.folderPath = '';
    this.user = null;
    this.logs = [];

    this.elements = {
      folderPath: document.getElementById('folder-path'),
      btnSelect: document.getElementById('btn-select-folder'),
      btnLogin: document.getElementById('btn-login'),
      btnSync: document.getElementById('btn-sync'),
      authPre: document.getElementById('auth-pre'),
      authPost: document.getElementById('auth-post'),
      userAvatar: document.getElementById('user-avatar'),
      userName: document.getElementById('user-name'),
      statusBadge: document.getElementById('status-badge'),
      statusDot: document.getElementById('status-dot'),
      statusText: document.getElementById('status-text'),
      authStatus: document.getElementById('auth-status'),
      progressFill: document.getElementById('progress-fill'),
      processedFiles: document.getElementById('processed-files'),
      totalFiles: document.getElementById('total-files'),
      syncSpeed: document.getElementById('sync-speed'),
      currentFile: document.getElementById('current-file'),
      syncDetails: document.getElementById('sync-details'),
      syncEmpty: document.getElementById('sync-empty'),
      logContainer: document.getElementById('log-container'),
      logEmpty: document.getElementById('log-empty')
    };
  }

  bindEvents() {
    this.elements.btnSelect.addEventListener('click', () => this.selectFolder());
    this.elements.btnLogin.addEventListener('click', () => this.login());
    this.elements.btnSync.addEventListener('click', () => this.startSync());
  }

  bindIPC() {
    const api = window.electronAPI;
    if (!api) return;
    api.onSyncProgress((data) => this.updateProgress(data));
    api.onAuthSuccess((profile) => this.handleAuthSuccess(profile));
    api.onAuthError((msg) => this.handleAuthError(msg));
  }

  async selectFolder() {
    const api = window.electronAPI;
    if (!api) return;
    const folder = await api.selectFolder();
    if (folder) {
      this.folderPath = folder;
      this.elements.folderPath.value = folder;
      this.updateSyncButton();
      this.addLog('info', `Folder selected: ${folder}`);
    }
  }

  login() {
    const api = window.electronAPI;
    if (!api) return;
    this.setState(STATES.AUTH_PENDING);
    api.loginGoogle();
    this.addLog('info', 'Starting Google authentication...');
  }

  startSync() {
    const api = window.electronAPI;
    if (!api || !this.folderPath) return;
    if (this.state === STATES.SYNC_HASHING || this.state === STATES.SYNC_PROCESSING) return;
    this.setState(STATES.SYNC_HASHING);
    api.startSync({ folderPath: this.folderPath });
  }

  setState(newState) {
    const valid = Object.values(STATES);
    if (!valid.includes(newState)) return;
    this.state = newState;

    const cls = newState.toLowerCase().replace(/_/g, '-');
    this.elements.statusBadge.className = 'status-badge ' + cls;
    this.elements.statusText.textContent = STATE_LABELS[newState];

    this.updateSyncButton();

    const isActive = newState === STATES.SYNC_HASHING || newState === STATES.SYNC_PROCESSING || newState === STATES.SYNC_COMPLETED;
    this.elements.syncDetails.classList.toggle('hidden', !isActive);
    this.elements.syncEmpty.classList.toggle('hidden', isActive);

    if (newState === STATES.SYNC_COMPLETED || newState === STATES.ERROR) {
      this.addLog(newState === STATES.SYNC_COMPLETED ? 'success' : 'error',
        newState === STATES.SYNC_COMPLETED ? 'Sync completed successfully' : 'Sync encountered an error');
    }
  }

  updateSyncButton() {
    const canSync = this.folderPath && (
      this.state === STATES.AUTHORIZED ||
      this.state === STATES.SYNC_COMPLETED ||
      this.state === STATES.ERROR
    );
    this.elements.btnSync.disabled = !canSync;
  }

  handleAuthSuccess(profile) {
    this.user = profile;
    this.elements.authPre.classList.add('hidden');
    this.elements.authPost.classList.remove('hidden');
    if (profile.picture) this.elements.userAvatar.src = profile.picture;
    this.elements.userName.textContent = profile.name || 'User';
    if (this.elements.authStatus) {
      this.elements.authStatus.textContent = 'CONNECTED';
      this.elements.authStatus.className = 'card-badge card-badge-green';
    }
    this.setState(STATES.AUTHORIZED);
    this.addLog('success', `Authenticated as ${profile.name}`);
  }

  handleAuthError(msg) {
    this.user = null;
    this.elements.authPre.classList.remove('hidden');
    this.elements.authPost.classList.add('hidden');
    if (this.elements.authStatus) {
      this.elements.authStatus.textContent = 'DISCONNECTED';
      this.elements.authStatus.className = 'card-badge card-badge-red';
    }
    this.setState(STATES.ERROR);
    this.addLog('error', msg || 'Authentication failed or was cancelled');
  }

  updateProgress(data) {
    if (data.status && Object.values(STATES).includes(data.status)) {
      this.setState(data.status);
    }

    if (data.processedFiles != null) {
      this.elements.processedFiles.textContent = data.processedFiles;
    }
    if (data.totalFiles != null) {
      this.elements.totalFiles.textContent = data.totalFiles;
    }
    if (data.speed != null) {
      this.elements.syncSpeed.textContent = data.speed;
    }
    if (data.currentFile != null) {
      this.elements.currentFile.textContent = data.currentFile;
      this.elements.currentFile.title = data.currentFile;
    }
    if (data.percentage != null) {
      this.elements.progressFill.style.width = Math.min(data.percentage, 100) + '%';
    }

    if (data.currentFile && this.state !== STATES.SYNC_HASHING) {
      this.addLog('info', data.currentFile);
    }
  }

  addLog(level, message) {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });
    this.logs.push({ time, level, message });

    if (this.logs.length > MAX_LOG_LINES) {
      this.logs.shift();
    }

    this.renderLogs();
  }

  renderLogs() {
    const container = this.elements.logContainer;
    container.innerHTML = '';

    if (this.logs.length === 0) {
      container.appendChild(this.elements.logEmpty);
      return;
    }

    this.elements.logEmpty.remove();

    const levelLabels = { info: 'INFO', warn: 'WARN', error: 'ERROR', success: 'SUCCESS' };

    for (const entry of this.logs) {
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.innerHTML = `<span class="time">${entry.time}</span><span class="level level-${entry.level}">${levelLabels[entry.level] || entry.level}</span><span class="message">${this.escapeHtml(entry.message)}</span>`;
      container.appendChild(div);
    }

    container.scrollTop = container.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const widget = new SyncWidget();
  widget.bindEvents();
  widget.bindIPC();

  window.__syncWidget = widget;

  widget.addLog('info', 'Application initialized');
  generateWindowIcon();
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STATES, STATE_LABELS, MAX_LOG_LINES, SyncWidget };
}
