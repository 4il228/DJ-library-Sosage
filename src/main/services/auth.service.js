const { safeStorage, shell } = require('electron');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'openid',
  'profile'
];

class AuthService {
  constructor(options = {}) {
    this.clientId = options.clientId || '';
    this.clientSecret = options.clientSecret || '';
    this.tokenDir = options.tokenDir || '';
    this.server = null;
    this.tokens = null;
  }

  getTokenPath() {
    return path.join(this.tokenDir, 'tokens.enc');
  }

  generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
  }

  generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  isLoggedIn() {
    return this.tokens !== null && !!this.tokens.access_token;
  }

  getUser() {
    if (!this.tokens) return null;
    return this.tokens.user || null;
  }

  getAccessToken() {
    if (!this.tokens) return null;
    return this.tokens.access_token;
  }

  async startAuth(mainWindow) {
    return new Promise((resolve, reject) => {
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(codeVerifier);
      let redirectUri = '';

      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url, `http://127.0.0.1`);

        if (reqUrl.pathname === '/callback') {
          const code = reqUrl.searchParams.get('code');
          const error = reqUrl.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h2>Authorization Denied</h2><p>You can close this window.</p></body></html>');
            this._cleanupServer();
            const errMsg = error === 'access_denied' ? 'Authorization denied by user' : error;
            reject(new Error(errMsg));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<html><body><h2>Error</h2><p>No authorization code received.</p></body></html>');
            this._cleanupServer();
            reject(new Error('No authorization code received'));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authorization Successful!</h2><p>You can close this window and return to the app.</p></body></html>');
          this._cleanupServer();

          this._exchangeCode(code, codeVerifier, redirectUri)
            .then((tokens) => {
              this.tokens = tokens;
              resolve(tokens);
            })
            .catch((err) => {
              reject(err);
            });
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        redirectUri = `http://127.0.0.1:${port}/callback`;

        const params = new URLSearchParams({
          client_id: this.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES.join(' '),
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent'
        });

        const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;
        shell.openExternal(authUrl);
      });

      server.on('error', (err) => {
        reject(err);
      });

      this.server = server;
    });
  }

  _cleanupServer() {
    if (this.server) {
      try { this.server.close(); } catch (e) { /* ignore */ }
      this.server = null;
    }
  }

  async _exchangeCode(code, codeVerifier, redirectUri) {
    const params = new URLSearchParams({
      code,
      client_id: this.clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    });
    if (this.clientSecret) {
      params.set('client_secret', this.clientSecret);
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorData}`);
    }

    const tokenData = await response.json();
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: Date.now() + (tokenData.expires_in || 3600) * 1000
    };

    if (tokenData.id_token) {
      try {
        const payload = tokenData.id_token.split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
        tokens.user = {
          name: decoded.name || 'User',
          picture: decoded.picture || ''
        };
      } catch (e) {
        tokens.user = { name: 'User', picture: '' };
      }
    }

    return tokens;
  }

  async saveTokens() {
    if (!this.tokens) return;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this system');
    }
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(this.tokens));
      fs.mkdirSync(path.dirname(this.getTokenPath()), { recursive: true });
      fs.writeFileSync(this.getTokenPath(), encrypted);
    } catch (err) {
      throw new Error(`Failed to save tokens: ${err.message}`);
    }
  }

  async loadTokens() {
    try {
      const tokenPath = this.getTokenPath();
      if (!fs.existsSync(tokenPath)) return false;
      if (!safeStorage.isEncryptionAvailable()) return false;

      const encrypted = fs.readFileSync(tokenPath);
      const decrypted = safeStorage.decryptString(encrypted);
      this.tokens = JSON.parse(decrypted);
      return true;
    } catch (err) {
      this.tokens = null;
      return false;
    }
  }

  async refreshAccessToken() {
    if (!this.tokens || !this.tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    const params = new URLSearchParams({
      refresh_token: this.tokens.refresh_token,
      client_id: this.clientId,
      grant_type: 'refresh_token'
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const tokenData = await response.json();
    this.tokens.access_token = tokenData.access_token;
    this.tokens.expiry_date = Date.now() + (tokenData.expires_in || 3600) * 1000;

    if (tokenData.refresh_token) {
      this.tokens.refresh_token = tokenData.refresh_token;
    }

    await this.saveTokens();
    return this.tokens.access_token;
  }

  async logout() {
    this.tokens = null;
    try {
      const tokenPath = this.getTokenPath();
      if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
      }
    } catch (err) {
      /* ignore */
    }
  }
}

module.exports = AuthService;
