const fs = require('fs');
const path = require('path');

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

class LoggerService {
  constructor(options = {}) {
    this.logDir = options.logDir || '';
    this.minLevel = LOG_LEVELS[options.level] || LOG_LEVELS.INFO;
    this.consoleOutput = options.consoleOutput !== false;
    this.logQueue = [];
    this._writeLock = false;
  }

  setLogDir(dir) {
    this.logDir = dir;
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  }

  _formatMessage(level, message, meta) {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
  }

  _write(level, message, meta) {
    if (LOG_LEVELS[level] < this.minLevel) return;

    const formatted = this._formatMessage(level, message, meta);

    if (this.consoleOutput) {
      if (level === 'ERROR') console.error(formatted);
      else if (level === 'WARN') console.warn(formatted);
      else console.log(formatted);
    }

    if (this.logDir) {
      this.logQueue.push(formatted + '\n');
      this._flush();
    }
  }

  _flush() {
    if (this._writeLock || this.logQueue.length === 0) return;
    this._writeLock = true;

    const logPath = path.join(this.logDir, 'app.log');
    const batch = this.logQueue.splice(0, 50);

    try {
      fs.appendFileSync(logPath, batch.join(''));
    } catch (e) { /* ignore */ }

    this._writeLock = false;

    if (this.logQueue.length > 0) {
      this._flush();
    }
  }

  debug(message, meta) { this._write('DEBUG', message, meta); }
  info(message, meta) { this._write('INFO', message, meta); }
  warn(message, meta) { this._write('WARN', message, meta); }
  error(message, meta) { this._write('ERROR', message, meta); }
}

module.exports = { LoggerService, LOG_LEVELS };
