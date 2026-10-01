# 🔐 2FA

Cloudflare Workers 上で動作する二要素認証キー管理システムです。無料でデプロイでき、グローバルネットワークによる高速アクセスと PWA のオフライン利用に対応しています。

![Version](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](../../README.md) · [繁體中文](../zh-TW/README.md) · [English](../en/README.md) · **[日本語](README.md)** · [한국어](../ko/README.md) ·
[Deutsch](../de/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · [Português (Brasil)](../pt-BR/README.md) · [Italiano](../it/README.md) ·
[Русский](../ru/README.md) · [Türkçe](../tr/README.md) · [Bahasa Indonesia](../id/README.md) · [Tiếng Việt](../vi/README.md) · [ไทย](../th/README.md)

<!-- README_LANGUAGE_NAV_END -->

**主な機能：** TOTP/HOTP コードの自動生成 · QR コードのスキャン／画像認識／スクリーンショットの貼り付け／画像のドラッグ＆ドロップによるキー追加 · AES-GCM 256 ビット暗号化ストレージ · Google Authenticator、Aegis、2FAS、Bitwarden などからの一括インポート · 複数形式へのエクスポート（TXT/JSON/CSV/HTML/Google 移行用 QR コード） · 自動バックアップと復元 · WebDAV/S3/OneDrive/Google Drive へのリモートバックアップ同期 · セキュリティ／同期／環境設定 · プロジェクト全体で 15 言語に対応（自動検出／手動選択） · ライト／ダーク／システム設定に合わせたテーマ · Fluent 2 を参考にしたレスポンシブ UI

Web アプリ、ブラウザー拡張機能、初期設定、公開 OTP ページ、API メッセージ、バックアップ文書は、簡体字中国語、繁体字中国語、英語、日本語、韓国語、ドイツ語、フランス語、スペイン語、ポルトガル語（ブラジル）、イタリア語、ロシア語、トルコ語、インドネシア語、ベトナム語、タイ語に対応しています。表示言語はブラウザーの設定または手動選択に従い、ブラウザーの言語が未対応の場合は英語を使用します。CSV/HTML バックアップは、作成時と異なる表示言語でもインポートできます。

## 🧩 ブラウザー拡張機能

2FA Verification Assistant をインストール：**[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**。

対応するブラウザーでインストールリンクを開いてください。インストール後、拡張機能の設定にセルフホストした 2FA インスタンスの URL を入力し、同じブラウザーでそのインスタンスにログインすると、TOTP コードの表示、コピー、入力ができます。自動入力にはサイトごとの許可が必要で、そのサイトで初めてコードを入力するときに許可できます。この拡張機能を使用するには本プロジェクトのデプロイ済みインスタンスが必要で、インターフェースは上記の 15 言語に対応しています。Firefox はデスクトップ版・Android 版ともに 153 以降と通常タブが必要です。デスクトップ版のコンテナータブと両環境のプライベートタブには対応していません。Firefox Android にはストア版 1.2.0 から対応していますが、実機検証はまだ行っていません。Firefox Android では拡張機能のキーボードショートカットを利用できません。

[インストールと使用方法](../BROWSER_EXTENSION.md) · [Chrome / Edge プライバシーポリシー](../../extension/PRIVACY.md) · [Firefox プライバシーポリシー](../../extension/PRIVACY_FIREFOX.md)（中国語）

## 📸 スクリーンショット

|                   デスクトップ                    |                   タブレット                   |                   モバイル                   |
| :-----------------------------------------------: | :--------------------------------------------: | :------------------------------------------: |
| ![デスクトップ](../images/screenshot-desktop.png) | ![タブレット](../images/screenshot-tablet.png) | ![モバイル](../images/screenshot-mobile.png) |

## 🚀 クイックデプロイ

### ライブデモ

デモサイトにアクセス（パスワード：`2fa-Demo.`）：**[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### ワンクリックデプロイ（推奨）

[![Cloudflare Workers にデプロイ](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> ワンクリックデプロイを推奨します。アップグレードは、すべてのユーザーが **Sync Upstream** ワークフローで既存環境に適用してください。Worker やリポジトリの削除、再インストールによるアップグレードは行わないでください。

1. 上のボタンをクリックし、GitHub でログインして連携を許可します
2. Cloudflare アカウントにログインし、**Deploy** をクリックしてデプロイの完了を待ちます（KV ストレージは自動作成されます）
3. Cloudflare が提供する Workers URL を開き、**管理者パスワードを設定**して利用を開始します

> Git の自動ビルドでは、リポジトリ内の `wrangler.toml` をそのまま使用します。現在の設定は `SECRETS_KV` を明示的に宣言しており、Wrangler は初回デプロイ時に必要な KV を自動作成し、以後のデプロイでは現在の Worker にバインドされたリソースを引き続き使用します。
> Cloudflare Dashboard で Git ビルドコマンドを手動設定する場合は、バージョン情報の挿入処理を維持し、リポジトリの標準デプロイ方法に合わせるため、**デプロイコマンドに `npm run deploy` を使用し、`npx wrangler deploy` を直接使用しないでください**。

#### 推奨：データ暗号化を有効にする

デプロイ後、**Cloudflare Dashboard → Worker → Settings → Variables** で Secret `ENCRYPTION_KEY` を追加します。

```bash
# Generate encryption key (choose one)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY` は既存データを復号するためのマスターキーです。**設定を推奨します**が、設定後すぐに元の値をパスワードマネージャー、オフラインバックアップなどの安全な場所に保存してください。
>
> 元の値を確実に保管できない場合は、**設定して紛失するより、設定しない方が安全です**。
>
> - 設定後：認証キー一覧、自動バックアップ、WebDAV/S3/OneDrive/Google Drive の認証情報がすべて暗号化されます
> - 紛失時：Cloudflare で元の値を再表示することはできず、既存の暗号化データと暗号化バックアップを読み出したり復元したりできなくなります
> - 現在の動作：暗号化データが検出された状態で `ENCRYPTION_KEY` が存在しない場合、既存データの誤上書きを防ぐために読み書きをロックします

#### バージョンの更新

ワンクリックデプロイでは、Fork ではなく独立したリポジトリが作成されます。アップグレードは **Sync Upstream** ワークフローを使い、既存環境に適用します。

> ⚠️ **アップグレード前に必ずデータをバックアップしてください**：バージョン更新の前に、**一括エクスポート**または**設定の復元 → バックアップをエクスポート**で現在のデータをエクスポートし、更新に失敗した場合のデータ損失に備えてください。

1. ワンクリックデプロイ時に自分の GitHub アカウントに作成された 2fa リポジトリを開きます
2. **Actions** → **Sync Upstream** に移動します
3. **Run workflow** をクリックし、アップストリームブランチを既定の `main` のままにして新しい実行を開始します
4. 同期と Cloudflare の自動デプロイが完了するのを待ち、アプリを再読み込みします

ワークフローはリポジトリの Worker 名、KV バインディング、一般的なデプロイ設定を自動で保持し、**同じ Worker** に再デプロイします。リポジトリに既存のワークフローファイルも保持されます。

> **Sync Upstream が見つからない場合**：ワンクリックデプロイはリポジトリを取り込む際に `.github/workflows` をコピーしないため、新しく作成したリポジトリにはワークフローがなく、最初のアップグレードの前にこのエントリーを追加する必要があります。下のリンクの `OWNER/REPO` を自分のリポジトリ（例：`alice/2fa`）に置き換えてブラウザーで開くと、GitHub がファイル名と内容を入力します。**Commit changes** をクリックしてください：
>
> ```text
> https://github.com/OWNER/REPO/new/main?filename=.github/workflows/sync-upstream.yml&value=%23%20Save%20as%20.github%2Fworkflows%2Fsync-upstream.yml%20in%20your%20repository.%0A%23%20The%20upgrade%20steps%20come%20from%20wuzf%2F2fa%2C%20so%20this%20file%20never%20needs%20updating.%0Aname%3A%20Sync%20Upstream%0A%0Aon%3A%0A%20%20workflow_dispatch%3A%0A%20%20%20%20inputs%3A%0A%20%20%20%20%20%20upstream_ref%3A%0A%20%20%20%20%20%20%20%20description%3A%20Upstream%20branch%20or%20tag%20to%20sync%0A%20%20%20%20%20%20%20%20required%3A%20false%0A%20%20%20%20%20%20%20%20default%3A%20main%0A%0Apermissions%3A%0A%20%20contents%3A%20write%0A%0Ajobs%3A%0A%20%20sync%3A%0A%20%20%20%20uses%3A%20wuzf%2F2fa%2F.github%2Fworkflows%2Fsync-upstream.yml%40main%0A%20%20%20%20with%3A%0A%20%20%20%20%20%20upstream_ref%3A%20%24%7B%7B%20inputs.upstream_ref%20%7D%7D%0A
> ```
>
> `.github/workflows/sync-upstream.yml` を自分で作成し、<https://github.com/wuzf/2fa/blob/main/.github/sync-upstream-entry.yml> から内容をコピーしてもかまいません。このエントリーは十数行だけで、アップグレードの手順はアップストリームから読み込まれるため、今後更新する必要はありません。その後、上記の手順でアップグレードできます。

> **以前のアップグレードが `without workflows permission` で失敗した場合**：修正がアップストリームの `main` に公開された後は、デプロイ設定の自動マージ処理を含む既存の **Sync Upstream** ワークフローで、上記の手順によるアップグレードが可能です。YAML の編集や PAT の設定は不要です。`main` を指定して新しい実行を開始してください。古いリリースタグにはこの修正は含まれません。それ以外の場合は[アップグレードのトラブルシューティング](../DEPLOYMENT.md#升级故障排查)（中国語）を参照してください。

この方法は、既存の Worker、KV バインディング、Secrets に影響しません。**すでに `ENCRYPTION_KEY` を設定している場合、アップグレード時の再入力は不要です。未設定の場合でも、この方法でアップグレードできます。**

> ⚠️ `ENCRYPTION_KEY` は既存データを復号するためのマスターキーです。初回作成時に必ずパスワードマネージャーに保存してください。Cloudflare Secrets は保存後に表示できません。通常のアップグレードで再入力は必要ありませんが、元の値を保存せずに削除した場合、既存の暗号化データを復元できなくなります。

> ⚠️ **1.8.0 より前のバージョンへのロールバック**：1.8.0 以降では、HOTP カウンターの増分をメインデータとは別に保存しています。ロールバック前に compaction エンドポイントを一度呼び出してカウンターを書き戻してください。そうしないと HOTP カウンターがアップグレード時点の値に戻ります。[ロールバック手順](../DEPLOYMENT.md#回滚到-180-之前的版本)（中国語）を参照してください。TOTP のみを使用する環境には影響しません。

#### マージ結果の確認

`Sync Upstream` ワークフローは、常に**同じリポジトリと同じ Worker** でアップグレードを完了するよう設計されています。現在のワークフローは `wrangler.toml` を自動マージし、アップストリームとの差分を実行サマリーに表示するため、ローカルのデプロイ設定から保持された値を確認できます。

1. GitHub Actions の実行サマリーで `wrangler.toml` の差分を確認します
2. リポジトリ内の `wrangler.toml` を開きます
3. Worker 名、KV バインディング、ルート、既存のデプロイ設定が引き続き正しいことを確認します
4. `wrangler.toml` に独自の詳細設定を加えている場合は、必要に応じて追加のコミットを行います

> Cloudflare が自動的に再デプロイを開始しない場合は、**Deployments** ページで現在のリポジトリの最新コミットを再デプロイしてください。削除や再インストールは行わないでください。

## 📖 ユーザーガイド

### キーの追加

右下のフローティングボタン **➕** をクリックします。

- **QR コードをスキャン** — カメラで 2FA の QR コードを読み取り、自動入力します
- **画像を選択** — QR コードのスクリーンショットをアップロードして自動認識します
- **スクリーンショットを貼り付け** — Ctrl+V でクリップボードの QR コード画像を貼り付けます（カメラのない PC に便利です）
- **画像をドラッグ＆ドロップ** — QR コード画像をダイアログに直接ドラッグして自動認識します
- **手動で追加** — サービス名と Base32 シークレットを入力します（詳細設定を開くと桁数／期間／アルゴリズムを調整できます）

### 日常の操作

- **コードをコピー**：コードの数字を直接クリックします
- **キーを管理**：カード右上の **⋯** → QR コードを表示／URI をコピー／ページリンクをコピー／編集／削除
- **検索**：上部の検索バーでサービス名やアカウント名をリアルタイム検索します
- **スマートグループ化**：関連するサービスや複数アカウントを自動でグループ化します。通常の一覧表示に戻すこともできます
- **並べ替え**：追加日時または名前で並べ替えます
- **テーマ**：フローティングボタン → **設定 → 環境設定 → テーマモード**で、ライト、ダーク、システムに合わせる、から選択します

### 一括インポート

フローティングボタン → **📥 一括インポート**をクリックします。ファイルのインポートとテキストの貼り付けに対応しています。

**対応形式：**

| インポート元           | 形式                                        |
| ---------------------- | ------------------------------------------- |
| 汎用                   | `otpauth://` URI テキスト（TXT）、CSV、HTML |
| Google Authenticator   | 移行用 QR コード（`otpauth-migration://`）  |
| Aegis                  | JSON エクスポートファイル                   |
| 2FAS                   | `.2fas` エクスポートファイル                |
| Bitwarden              | JSON または Authenticator CSV エクスポート  |
| LastPass Authenticator | JSON エクスポートファイル                   |
| andOTP                 | JSON エクスポートファイル                   |
| Ente Auth              | エクスポートファイル                        |

### 一括エクスポート

フローティングボタン → **📤 一括エクスポート**をクリックします。TXT、JSON、CSV、HTML 形式への出力に加え、**Google Authenticator 移行用 QR コード**の生成に対応しています（スキャンして直接インポートできます）。
標準の TXT / JSON / CSV / HTML エクスポートは、オンライン時にはバックエンドの統一形式を優先し、オフライン時やリクエスト本文が大きすぎる場合は互換性のあるローカルエクスポートに自動で切り替わります。

### バックアップと復元

データ変更時と毎日の定期チェック時に自動バックアップを行い、最新の 100 件を保持します（保持数は設定で変更できます）。
新しいバックアップファイルは**設定 → 既定のエクスポート形式**に従います。リモート自動バックアップも同じ拡張子（`txt`、`json`、`csv`、`html`）を使用します。

フローティングボタン → **🔄 設定の復元**で、バックアップ一覧の表示、内容のプレビュー、復元、エクスポートができます。WebDAV/S3/OneDrive/Google Drive からダウンロードした `backup_*.(txt|json|csv|html)` ファイルをアップロードし、プレビューして復元することもできます。

#### リモートバックアップ

リモートストレージへのバックアップ同期に対応し、データ変更時に自動送信します。複数のバックアップ先を設定できます。

- **WebDAV** — 標準 WebDAV プロトコルを使用するクラウドドライブやセルフホストサービスに対応します（⚠️ Nutstore/jianguoyun などの Cloudflare プロキシ経由のサービスは、520 ループエラーが発生するため対応していません）
- **S3 互換ストレージ** — AWS S3、Cloudflare R2、MinIO、Alibaba Cloud OSS などの S3 互換サービスに対応します
- **OneDrive** — Microsoft OAuth 認証後、OneDrive のアプリ専用フォルダー内のサブフォルダーにバックアップを書き込みます
- **Google Drive** — Google OAuth 認証後、設定した Google Drive フォルダーにバックアップを書き込みます

**設定 → 同期設定**でリモートバックアップ先を追加、管理できます。

リモートバックアップには、アプリが生成するバックアップと同じ内容が保存されます。バックアップ作成時に `ENCRYPTION_KEY` が設定されていた場合、リモートファイルも暗号化されます。復元するには、Worker に同じ `ENCRYPTION_KEY` を保持している必要があります。

詳しい設定手順：[クラウドドライブの設定](../CLOUD_DRIVE_SETUP.md)（現在は中国語）。

### 設定

フローティングボタン → **⚙️ 設定**をクリックします。

- **パスワードを変更** — 管理者パスワードを変更します
- **テーマモード** — ライト、ダーク、システムに合わせる、から選択します
- **コード切り替えアニメーション** — アニメーションを無効にするか、フロー、フリップ、スポットライトから選択します
- **ログイン有効期間** — JWT の有効期間を設定します
- **既定のエクスポート形式** — エクスポート時の既定の選択肢と、新しいバックアップおよびリモート自動バックアップの拡張子を設定します
- **バックアップ保持数** — 自動バックアップの保持数を調整します
- **リモートバックアップ** — WebDAV/S3/OneDrive/Google Drive のバックアップ先を設定します
- **ログアウト** — 現在のセッション Cookie とローカルキャッシュをワンクリックで消去します。サーバーに接続できない場合でも、ローカルの消去は実行できます

### モバイルアプリとしてインストール（PWA）

- **iOS**：Safari で開く → 共有ボタン → ホーム画面に追加
- **Android**：Chrome で開く → メニュー（⋮）→ ホーム画面に追加

インストール後は、ネイティブアプリのように全画面で利用でき、オフラインアクセスにも対応します。

### Chrome / Edge / Firefox での TOTP 入力

拡張機能をクリックしてアカウントを選択するか、`Ctrl+Shift+U` を押すと、事前に関連付けたアカウントの現在の TOTP を入力できます。サイトを許可すると、拡張機能がそのサイトの認証入力欄を検出し、自動入力できます。複数のアカウントが一致するとアカウント選択画面を表示します。単一の入力欄と 6 桁／8 桁の分割入力欄に対応し、フォームの送信は行いません。

同じブラウザープロファイルで 2FA インスタンスにログインし、インスタンスへのアクセスを許可した後は、インスタンスのタブを閉じても構いません。既定では、有効なセッションを通じてシークレットを読み取り、処理ごとにバックグラウンドメモリーでコードを計算します。セッションの有効期限が切れた場合は再ログインしてください。オフライン利用を明示的に有効にすると、独立したローカルのシークレットキャッシュが保存され、ネットワーク接続や開いているインスタンスタブがなくてもコードを利用できます。このキャッシュには、追加のパスワード暗号化はありません。許可された拡張機能のコードはシークレット一覧全体を読み取れますが、シークレット自体がポップアップや入力先のサイトに送信されることはありません。開いた Shadow DOM と同一オリジンの iframe 内の入力欄に対応しています。HOTP、異なるオリジンの iframe、閉じた Shadow DOM、プライベートブラウジングには対応していません。

[インストールと使用方法](../BROWSER_EXTENSION.md)、[Chrome / Edge プライバシーに関する説明](../../extension/PRIVACY.md)、[Firefox プライバシーに関する説明](../../extension/PRIVACY_FIREFOX.md)（現在は中国語）を参照してください。

## 🔒 セキュリティ

- **パスワード**：ソルト付き PBKDF2-SHA256 ハッシュ（100,000 回反復）を使用し、JWT は HttpOnly + Secure + SameSite=Strict の Cookie に保存します
- **データ暗号化**：`ENCRYPTION_KEY` を設定すると、すべてのシークレット、バックアップ、WebDAV/S3/OneDrive/Google Drive の認証情報を AES-GCM 256 ビットで暗号化します。元のキーを必ず保管してください。紛失した場合、暗号化データは復号できません
- **通信**：すべて HTTPS、TLS 1.2+ を使用します
- **プライバシー**：OTP はクライアント側で生成し、利用データは収集しません。完全なオープンソースです
- **ログイン有効期間**：既定は 30 日で、設定で変更できます。利用中は自動更新されます（残り 7 日未満になると自動延長）

## 🔗 公開 OTP API

ログインせずに、URL から直接認証コードを生成できます。

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

パラメーター：`type`（totp/hotp）、`digits`（6/8）、`period`（30/60/120）、`algorithm`（sha1/sha256/sha512）、`counter`（HOTP 用）

TOTP ページは現在と次のコードを表示し、どちらもコピーできます。期間の終了時にはページ内で更新されます。HOTP ページはリンクで指定されたカウンターを使用し、コピーしてもカウンターは進みません。

## 📚 その他のドキュメント

| ドキュメント                                      | 内容                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| [デプロイガイド](../DEPLOYMENT.md)                | 手動デプロイ、KV 設定、Secrets（中国語）                         |
| [クラウドドライブの設定](../CLOUD_DRIVE_SETUP.md) | OneDrive / Google Drive の設定手順（中国語）                     |
| [API リファレンス](../API_REFERENCE.md)           | API エンドポイントの完全なドキュメント（中国語）                 |
| [アーキテクチャ](../ARCHITECTURE.md)              | システム構成と技術設計（中国語）                                 |
| [開発ガイド](../DEVELOPMENT.md)                   | ローカル開発、テスト、コードスタイル（中国語）                   |
| [PWA ガイド](../PWA_GUIDE.md)                     | PWA のインストールとオフライン機能（中国語）                     |
| [ブラウザー拡張機能](../BROWSER_EXTENSION.md)     | Chrome / Edge / Firefox のインストール、使用方法、権限（中国語） |

## 🤝 コントリビューション

[Issue](https://github.com/wuzf/2fa/issues) や [Pull Request](https://github.com/wuzf/2fa/pulls) を歓迎します。開発については[開発ガイド](../DEVELOPMENT.md)（中国語）を参照してください。

## 📄 ライセンス

[MIT License](../../LICENSE)

## 🌟 スターの履歴

<p align="center">
  <a href="https://github.com/wuzf/2fa/tree/star-history">
    <img alt="スター数の推移" src="https://raw.githubusercontent.com/wuzf/2fa/refs/heads/star-history/star-history.svg" />
  </a>
</p>

---

<div align="center">

**このプロジェクトが役に立ったら、⭐ をお願いします**

[wuzf](https://github.com/wuzf) が ❤️ を込めて制作

</div>
