[![Electron](https://img.shields.io/badge/electron-31.x-47848F?logo=electron&style=flat-square)](https://www.electronjs.org/)
[![Google Drive](https://img.shields.io/badge/Google_Drive_API-v3-4285F4?logo=google-drive&style=flat-square)](https://developers.google.com/drive/api)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](https://opensource.org/license/mit)

<br>
<p align="center">
  <img src="public/logo.svg" alt="Sosage" width="96" height="96">
  <br>
  <h1 align="center">DJ Library Sosage</h1>
  <p align="center">
    Бекап и синхронизация DJ-библиотеки с Google Drive
    <br>
    <em>Резервное копирование музыки и метаданных — надёжно, быстро, прозрачно</em>
  </p>
</p>
<br>

### Готовые сборки

[![Download Portable](https://img.shields.io/badge/Скачать-Portable-34A853?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cGF0aCBkPSJNMTYgNDAgQzE2IDI4IDI0IDI0IDMyIDI0IEM0MCAyNCA0OCAyOCA0OCA0MCBDNTIgNDAgNTYgNDQgNTYgNDggQzU2IDUyIDUyIDU2IDQ4IDU2IEwxNiA1NiBDMTIgNTYgOCA1MiA4IDQ4IEM4IDQ0IDEyIDQwIDE2IDQwIFoiIGZpbGw9IiNlOTQ1NjAiLz4KICA8cGF0aCBkPSJNMjggMzIgTDM2IDMyIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDxjaXJjbGUgY3g9IjI0IiBjeT0iNDQiIHI9IjQiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPgogIDxjaXJjbGUgY3g9IjQwIiBjeT0iNDQiIHI9IjQiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPgo8L3N2Zz4%3D)](https://drive.google.com/uc?export=download&id=1gidH56EegXFN1XIiw3gN6fBUAECzkSxP&confirm=t)
[![Download Installer](https://img.shields.io/badge/Скачать-Installer-4285F4?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cGF0aCBkPSJNMTYgNDAgQzE2IDI4IDI0IDI0IDMyIDI0IEM0MCAyNCA0OCAyOCA0OCA0MCBDNTIgNDAgNTYgNDQgNTYgNDggQzU2IDUyIDUyIDU2IDQ4IDU2IEwxNiA1NiBDMTIgNTYgOCA1MiA4IDQ4IEM4IDQ0IDEyIDQwIDE2IDQwIFoiIGZpbGw9IiNlOTQ1NjAiLz4KICA8cGF0aCBkPSJNMjggMzIgTDM2IDMyIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDxjaXJjbGUgY3g9IjI0IiBjeT0iNDQiIHI9IjQiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPgogIDxjaXJjbGUgY3g9IjQwIiBjeT0iNDQiIHI9IjQiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPgo8L3N2Zz4%3D)](https://drive.google.com/uc?export=download&id=1nkK07lkAj46RwtGbx5Z7xaVdqegEPtDb&confirm=t)

## О проекте

**DJ Library Sosage** — десктопное приложение на Electron для безопасной синхронизации DJ-библиотеки (Rekordbox, Serato, Traktor) с Google Drive. Авторизация через OAuth 2.0 с PKCE, дифф-анализ по MD5, шифрование токенов через `safeStorage` — никаких данных на сторонних серверах.

### Возможности

- **Безопасная авторизация** — Google OAuth 2.0 + PKCE, токены хранятся в зашифрованном виде (OS-level safeStorage)
- **Умный дифф-анализ** — сравнивает MD5-хэши и таймстемпы с эпсилон-буфером (2 с), исключая ложные перезаписи
- **Конкурентная загрузка** — пул из 3 параллельных запросов, Exponential Backoff при лимитах API
- **Real-time UI** — до 100 обновлений в секунду, прогресс-бар, скорость, текущий файл
- **Activity Log** — лента последних 200 событий синхронизации
- **Case-insensitive** — корректная обработка регистрозависимости Windows
- **Portable & Installer** — готовые сборки для Windows (NSIS / portable)

## Установка и запуск

### Запуск в режиме разработки

```bash
git clone <url-репозитория>
cd "DJ library Sosage"
npm install
npm start
```

### Сборка из исходников

```bash
git clone <url-репозитория>
cd "DJ library Sosage"
npm install
npm run build
```

## Конфигурация

Скопируй `src/config.example.json` в `src/config.json` и укажи свои OAuth-ключи Google:

```json
{
  "googleClientId": "твой_client_id.apps.googleusercontent.com",
  "googleClientSecret": "твой_client_secret"
}
```

> `config.json` добавлен в `.gitignore` — секреты не попадут в репозиторий.

## Архитектура

```
src/
  main/                    # Main Process (Electron)
    index.js               # Точка входа, оркестрация
    engine/
      diff.js              # Diff Engine — MD5, сравнение, загрузка
    services/
      auth.service.js      # OAuth 2.0 + PKCE + safeStorage
      logger.service.js    # Централизованное логирование
  preload/
    index.js               # IPC Bridge (contextBridge)
public/
  index.html               # UI Renderer
  renderer.js              # SyncWidget, состояния, логи
  styles.css               # Тёмная тема, анимации
  logo.svg                 # Логотип
```

### Безопасность

- `contextIsolation: true`, `nodeIntegration: false`
- Единственный шлюз — `preload.js` через `contextBridge.exposeInMainWorld`
- Токены — только в `safeStorage`, никакого localStorage или IndexedDB
- OAuth-флоу с PKCE (`code_verifier` / `code_challenge`)

### Diff Engine

- Потоковое вычисление MD5 (crypto.createHash)
- Epsilon-буфер 2 с для сравнения таймстемпов (RFC 3339 vs mtimeMs)
- Пул конкурентности: 3 параллельных запроса
- Exponential Backoff при ошибках 429/403
- Фильтрация Google Drive: `'<parent_id>' in parents and trashed = false`

## Тестирование

```bash
npm run test              # Изоляция контекста (Playwright)
npm run test:widget       # UI-компонент SyncWidget
npm run test:auth         # Auth-модуль (Jest)
npm run test:diff         # Diff Engine (Jest)
npm run test:network-stress  # Стресс-тест сети (403, задержки)
npm run test:e2e          # E2E (полный цикл)
npm run test:all          # Всё сразу
```

## Состояния приложения

```
IDLE → AUTH_PENDING → AUTHORIZED → SYNC_HASHING → SYNC_PROCESSING → SYNC_COMPLETED
                                        ↓                  ↓
                                      ERROR              ERROR
```

## Технологии

| | |
|---|---|
| **Desktop Framework** | Electron 31 |
| **Auth** | Google OAuth 2.0 + PKCE |
| **API** | Google Drive API v3 |
| **Storage** | OS-level safeStorage |
| **Build** | electron-builder 24 (NSIS / DMG / Portable) |

## Лицензия

MIT
