# 🔐 2FA

A two-factor authentication key management system built on Cloudflare Workers. Free to deploy, globally accelerated, with PWA offline support.

![Version](https://img.shields.io/badge/version-1.3.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

**[中文文档](README.md)**

**Key Features:** TOTP/HOTP code auto-generation · QR code scanning/image recognition/paste screenshot/drag & drop image to add keys · AES-GCM 256-bit encrypted storage · Bulk import from Google Authenticator, Aegis, 2FAS, Bitwarden, etc. · Multi-format export (TXT/JSON/CSV/HTML/Google migration QR codes) · Auto backup & restore · WebDAV/S3 remote backup sync · Settings panel (password change/backup config) · Dark/Light theme · Responsive design for mobile/tablet/desktop

## 📸 Screenshots

|                    Desktop                     |                    Tablet                    |                    Mobile                    |
| :--------------------------------------------: | :------------------------------------------: | :------------------------------------------: |
| ![Desktop](docs/images/screenshot-desktop.png) | ![Tablet](docs/images/screenshot-tablet.png) | ![Mobile](docs/images/screenshot-mobile.png) |

## 🚀 Quick Deployment

### Live Demo

Visit the demo site (password `2fa-Demo.`): **[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### One-Click Deploy (Recommended)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> One-click deploy is recommended. All users should upgrade in-place via the **Sync Upstream** workflow. Do not upgrade by deleting the Worker, deleting the repository, or reinstalling.

1. Click the button above, log in with GitHub and authorize
2. Log in to your Cloudflare account, click **Deploy** and wait for deployment to complete (KV storage is created automatically)
3. Open the Workers URL provided by Cloudflare, **set your admin password** and start using

> Git auto-build uses the `wrangler.toml` from the repository directly. The current config explicitly declares `SECRETS_KV`, and Wrangler will automatically create the required KV on first deploy and continue reusing the resource bound to the current Worker on subsequent deploys.
> If you manually configure Git build commands in the Cloudflare Dashboard, **use `npm run deploy` as the deploy command, not `npx wrangler deploy` directly**, to preserve the version injection flow and stay consistent with the repository's default deploy entry.

#### Recommended: Enable Data Encryption

After deployment, add a Secret `ENCRYPTION_KEY` in **Cloudflare Dashboard → Worker → Settings → Variables**:

```bash
# Generate encryption key (choose one)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY` is the master key for decrypting existing data. **Recommended to set up**, provided you immediately save the original value to a password manager, offline backup, or other secure location.
>
> If you cannot ensure the original value is saved, **it's better to not set it at all than to set it and lose it**:
>
> - Once set: Secret list, auto backups, and WebDAV/S3 credentials are all encrypted
> - If lost: Cloudflare will not show the original value again; existing encrypted data and encrypted backups cannot be read or restored
> - Current behavior: When encrypted data is detected but `ENCRYPTION_KEY` is missing, the system locks reads and writes to prevent accidental overwriting of old data

#### Version Updates

One-click deploy creates an independent repository (not a Fork). Upgrades are done in-place using the **Sync Upstream** workflow.

> ⚠️ **Always back up your data before upgrading**: Before performing a version update, export your current data via **Bulk Export** or **Restore Config → Export Backup** to prevent data loss in case of failure.

> ⚠️ **First-time upgrade requires adding the workflow file**: The repository created by one-click deploy may not include the `.github/workflows/` directory. Please first add the file `.github/workflows/sync-upstream.yml` to your repository, copying the content from the upstream repository file: <https://github.com/wuzf/2fa/blob/main/.github/workflows/sync-upstream.yml>, and commit it once. After that, follow the steps below for in-place upgrades.

1. Open the 2fa repository generated on your GitHub account during one-click deploy
2. Go to **Actions** → **Sync Upstream**
3. Click **Run workflow**
4. Wait for the workflow to sync the latest upstream code to your repository
5. The workflow will automatically merge your current repository's Worker name, KV bindings, and common deployment config based on the latest upstream configuration
6. Cloudflare will redeploy **the same Worker** based on your current repository

This approach does not affect existing Workers, KV bindings, or Secrets. **If you've already set `ENCRYPTION_KEY`, you don't need to re-enter it during upgrades; if you haven't set it, you can still use this upgrade process.**

> ⚠️ `ENCRYPTION_KEY` is the master key for decrypting existing data. Please make sure to save it to a password manager when first created. Cloudflare Secrets cannot be viewed after saving; normal upgrades don't require re-entry, but if you delete it without saving the original value, existing encrypted data cannot be recovered.

#### Checking the Merge Result

The `Sync Upstream` workflow is designed to always complete upgrades on **the same repository and the same Worker**. The workflow now automatically merges `wrangler.toml` and shows the diff with upstream in the summary, so you can confirm which values come from your local deployment config:

1. Check the `wrangler.toml` diff in the GitHub Actions run summary
2. Open `wrangler.toml` in your repository
3. Confirm that the Worker name, KV bindings, routes, and existing deployment settings are still correct
4. If you maintain very specific `wrangler.toml` configurations, make additional commits as needed

> If Cloudflare doesn't automatically start redeployment, go to the **Deployments** page and redeploy the latest commit of your current repository — do not delete and reinstall.

## 📖 User Guide

### Adding Keys

Click the **➕** floating button in the bottom right:

- **Scan QR Code** — Camera scan of 2FA QR codes, auto-fill
- **Select Image** — Upload a QR code screenshot, auto-recognize
- **Paste Screenshot** — Ctrl+V to paste QR code screenshots from clipboard (great for PC users without cameras)
- **Drag & Drop Image** — Drag QR code images directly into the dialog, auto-recognize
- **Manual Add** — Enter service name and Base32 secret (expand advanced settings to adjust digits/period/algorithm)

### Daily Use

- **Copy Code**: Click the code digits directly
- **Manage Keys**: Click **⋯** on the top right of a card → Edit / Delete / View QR Code
- **Search**: Real-time search by service name or account name in the top search bar
- **Sort**: Sort by add time or name
- **Theme**: Toggle light/dark/follow system with 🌓 in the bottom right

### Bulk Import

Click the floating button → **📥 Bulk Import**, supports file import or text paste.

**Compatible Formats:**

| Source                 | Format                                     |
| ---------------------- | ------------------------------------------ |
| Universal              | `otpauth://` URI text (TXT), CSV, HTML     |
| Google Authenticator   | Migration QR code (`otpauth-migration://`) |
| Aegis                  | JSON export file                           |
| 2FAS                   | `.2fas` export file                        |
| Bitwarden              | JSON export file                           |
| LastPass Authenticator | JSON export file                           |
| andOTP                 | JSON export file                           |
| Ente Auth              | Export file                                |

### Bulk Export

Click the floating button → **📤 Bulk Export**, supports TXT, JSON, CSV, HTML formats, as well as generating **Google Authenticator migration QR codes** (can be scanned to import directly).

### Backup & Restore

The system backs up automatically (triggered on data changes + daily scheduled check), keeping the latest 100 backups (adjustable in settings).

Click the floating button → **🔄 Restore Config** to view backup list, preview content, restore, or export.

#### Remote Backup

Supports syncing backups to remote storage, automatically pushing on data changes, with multiple backup targets configurable:

- **WebDAV** — Supports standard WebDAV protocol cloud drives or self-hosted services (⚠️ Does not support Cloudflare-proxied services like Nutstore/jianguoyun, which trigger 520 loop errors)
- **S3-Compatible Storage** — Supports AWS S3, Cloudflare R2, MinIO, Alibaba Cloud OSS, and other S3-compatible services

Add and manage remote backup targets in **Settings → Backup Config**.

### Settings

Click the floating button → **⚙️ Settings**:

- **Change Password** — Change the admin password
- **Login Validity** — Customize JWT expiration time
- **Backup Retention Count** — Adjust auto backup retention count
- **Remote Backup** — Configure WebDAV/S3 backup targets

### Install as Mobile App (PWA)

- **iOS**: Open in Safari → Share button → Add to Home Screen
- **Android**: Open in Chrome → Menu (⋮) → Add to Home Screen

After installation, use it like a native app in full screen with offline access support.

## 🔒 Security

- **Password**: PBKDF2-SHA256 (100,000 iterations) salted hash, JWT stored in HttpOnly + Secure + SameSite=Strict cookies
- **Data Encryption**: With `ENCRYPTION_KEY` configured, all secrets, backups, and WebDAV/S3 credentials are encrypted with AES-GCM 256-bit; make sure to save the original key — encrypted data cannot be decrypted if lost
- **Transport**: HTTPS throughout, TLS 1.2+
- **Privacy**: OTP generated client-side, no usage data collected, fully open source
- **Login Validity**: Default 30 days, customizable in settings, auto-renewed on active use (auto-extended when < 7 days remaining)

## 🔗 Public OTP API

Generate verification codes directly via URL without logging in:

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

Parameters: `type` (totp/hotp), `digits` (6/8), `period` (30/60/120), `algorithm` (sha1/sha256/sha512), `counter` (for HOTP)

## 📚 More Documentation

| Document                                 | Description                            |
| ---------------------------------------- | -------------------------------------- |
| [Deployment Guide](docs/DEPLOYMENT.md)   | Manual deployment, KV config, Secrets  |
| [API Reference](docs/API_REFERENCE.md)   | Complete API endpoint documentation    |
| [Architecture](docs/ARCHITECTURE.md)     | System architecture & technical design |
| [Development Guide](docs/DEVELOPMENT.md) | Local development, testing, code style |
| [PWA Guide](docs/PWA_GUIDE.md)           | PWA installation & offline features    |

## 🤝 Contributing

Welcome to submit [Issues](https://github.com/wuzf/2fa/issues) and [Pull Requests](https://github.com/wuzf/2fa/pulls). For development details, see the [Development Guide](docs/DEVELOPMENT.md).

## 📄 License

[MIT License](LICENSE)

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=wuzf/2fa&type=date&legend=top-left)](https://www.star-history.com/#wuzf/2fa&type=date&legend=top-left)

---

<div align="center">

**If this project helps you, please give it a ⭐**

Made with ❤️ by [wuzf](https://github.com/wuzf)

</div>
