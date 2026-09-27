# 🔐 2FA

Cloudflare Workers üzerinde çalışan bir iki faktörlü kimlik doğrulama anahtarı yönetim sistemi. Ücretsiz dağıtım, dünya genelinde hızlandırılmış erişim ve PWA ile çevrimdışı kullanım desteği sunar.

![Sürüm](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![Lisans](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](README.md) · [繁體中文](README_TC.md) · [English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md) ·
[Deutsch](README_DE.md) · [Français](README_FR.md) · [Español](README_ES.md) · [Português (Brasil)](README_PT_BR.md) · [Italiano](README_IT.md) ·
[Русский](README_RU.md) · **[Türkçe](README_TR.md)** · [Bahasa Indonesia](README_ID.md) · [Tiếng Việt](README_VI.md) · [ไทย](README_TH.md)

<!-- README_LANGUAGE_NAV_END -->

**Temel özellikler:** Otomatik TOTP/HOTP kodu üretimi · QR kod tarama, görsel tanıma, ekran görüntüsü yapıştırma ve görsel sürükleyip bırakarak anahtar ekleme · AES-GCM 256 bit şifreli depolama · Google Authenticator, Aegis, 2FAS, Bitwarden ve diğer uygulamalardan toplu içe aktarma · Birden fazla biçimde dışa aktarma (TXT/JSON/CSV/HTML/Google taşıma QR kodları) · Otomatik yedekleme ve geri yükleme · WebDAV/S3/OneDrive/Google Drive ile uzak yedek senkronizasyonu · Güvenlik, senkronizasyon ve tercih ayarları · Proje genelinde 15 dil (otomatik algılama / elle seçim) · Açık, koyu ve sistem temasını izleyen modlar · Fluent 2'den esinlenen, farklı ekranlara uyumlu arayüz

Web uygulaması, tarayıcı eklentileri, ilk kurulum, herkese açık OTP sayfaları, API iletileri ve yedek belgeleri; Basitleştirilmiş Çince, Geleneksel Çince, İngilizce, Japonca, Korece, Almanca, Fransızca, İspanyolca, Portekizce (Brezilya), İtalyanca, Rusça, Türkçe, Endonezce, Vietnamca ve Taycayı destekler. Arayüzler tarayıcının dilini veya elle yapılan seçimi izler; desteklenmeyen tarayıcı dillerinde İngilizce kullanılır. CSV/HTML yedekleri farklı arayüz dilleri arasında içe aktarılabilir.

## 🧩 Tarayıcı eklentisi

2FA Verification Assistant'ı yükleyin: **[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**.

Yükleme bağlantısını ilgili tarayıcıda açın. Yükledikten sonra eklenti ayarlarına kendi barındırdığınız 2FA kurulumunun URL'sini girin ve TOTP kodlarını görüntülemek, kopyalamak ve doldurmak için aynı tarayıcıda bu kuruluma giriş yapın. Otomatik doldurma, her doğrulama sayfası için ayrı izin gerektirir. Eklenti, bu projenin dağıtılmış bir kurulumunu gerektirir ve arayüzü yukarıda listelenen 15 dili destekler. Firefox için masaüstü sürümü 153 veya üzeri gerekir; varsayılan kapsayıcıyı kullanan normal bir sekmede çalışır. Kapsayıcı sekmeleri, özel pencereler ve Android desteklenmez.

[Yükleme ve kullanım kılavuzu](docs/BROWSER_EXTENSION.md) · [Chrome / Edge gizlilik politikası](extension/PRIVACY.md) · [Firefox gizlilik politikası](extension/PRIVACY_FIREFOX.md) (Çince)

## 📸 Ekran görüntüleri

|                    Masaüstü                     |                    Tablet                    |                    Mobil                    |
| :---------------------------------------------: | :------------------------------------------: | :-----------------------------------------: |
| ![Masaüstü](docs/images/screenshot-desktop.png) | ![Tablet](docs/images/screenshot-tablet.png) | ![Mobil](docs/images/screenshot-mobile.png) |

## 🚀 Hızlı dağıtım

### Canlı demo

Demo sitesini ziyaret edin (parola: `2fa-Demo.`): **[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### Tek tıkla dağıtım (önerilen)

[![Cloudflare Workers'a dağıt](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> Tek tıkla dağıtım önerilir. Tüm kullanıcılar **Sync Upstream** iş akışıyla mevcut kurulumlarını yerinde yükseltmelidir. Worker'ı veya depoyu silerek ya da yeniden kurarak yükseltme yapmayın.

1. Yukarıdaki düğmeye tıklayın, GitHub ile giriş yapın ve yetki verin
2. Cloudflare hesabınıza giriş yapın, **Deploy** düğmesine tıklayın ve dağıtımın tamamlanmasını bekleyin (KV depolaması otomatik oluşturulur)
3. Cloudflare'ın sağladığı Workers URL'sini açın, **yönetici parolanızı belirleyin** ve kullanmaya başlayın

> Git üzerinden otomatik derleme, doğrudan depodaki `wrangler.toml` dosyasını kullanır. Mevcut yapılandırma `SECRETS_KV` bağlamasını açıkça tanımlar; Wrangler ilk dağıtımda gerekli KV'yi otomatik oluşturur ve sonraki dağıtımlarda mevcut Worker'a bağlı kaynağı kullanmaya devam eder.
> Cloudflare Dashboard'da Git derleme komutlarını elle yapılandırıyorsanız, sürüm bilgisinin eklenmesi sürecini korumak ve deponun varsayılan dağıtım giriş noktasıyla tutarlı kalmak için **dağıtım komutu olarak doğrudan `npx wrangler deploy` yerine `npm run deploy` kullanın**.

#### Öneri: Veri şifrelemeyi etkinleştirin

Dağıtımdan sonra **Cloudflare Dashboard → Worker → Settings → Variables** altında `ENCRYPTION_KEY` adlı bir Secret ekleyin:

```bash
# Şifreleme anahtarı üretin (birini seçin)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY`, mevcut verilerin şifresini çözmek için kullanılan ana anahtardır. Özgün değeri hemen bir parola yöneticisine, çevrimdışı yedeğe veya başka bir güvenli yere kaydetmek koşuluyla **yapılandırılması önerilir**.
>
> Özgün değerin saklandığından emin olamıyorsanız, **anahtarı ayarlayıp kaybetmektense hiç ayarlamamak daha iyidir**:
>
> - Ayarlandığında: Gizli anahtar listesi, otomatik yedekler ve WebDAV/S3/OneDrive/Google Drive kimlik bilgileri şifrelenir
> - Kaybedildiğinde: Cloudflare özgün değeri tekrar göstermez; mevcut şifreli veriler ve şifreli yedekler okunamaz veya geri yüklenemez
> - Mevcut davranış: Şifreli veri algılandığında ancak `ENCRYPTION_KEY` eksik olduğunda, eski verilerin yanlışlıkla üzerine yazılmasını önlemek için sistem okuma ve yazma işlemlerini kilitler

#### Sürüm güncellemeleri

Tek tıkla dağıtım bağımsız bir depo oluşturur (Fork değildir). Yükseltmeler **Sync Upstream** iş akışı kullanılarak mevcut kurulum üzerinde yapılır.

> ⚠️ **Yükseltmeden önce her zaman verilerinizi yedekleyin**: Sürüm güncellemesi yapmadan önce, olası bir hatada veri kaybını önlemek için **Toplu dışa aktarma** veya **Yapılandırmayı geri yükle → Yedeği dışa aktar** üzerinden mevcut verilerinizi dışa aktarın.

1. Tek tıkla dağıtım sırasında GitHub hesabınızda oluşturulan 2fa deposunu açın
2. **Actions** → **Sync Upstream** bölümüne gidin
3. **Run workflow** düğmesine tıklayın, kaynak dalı varsayılan `main` olarak bırakın ve yeni bir çalıştırma başlatın
4. Senkronizasyonun ve Cloudflare'ın otomatik dağıtımının tamamlanmasını bekleyin, ardından uygulamayı yenileyin

İş akışı, deponuzun Worker adını, KV bağlamalarını ve yaygın dağıtım ayarlarını otomatik olarak korur ve **aynı Worker'ı** yeniden dağıtır. Deponuzdaki mevcut iş akışı dosyaları da korunur.

> **Sync Upstream yoksa**: Tek tıkla dağıtımla oluşturulan depo iş akışlarını içermeyebilir. Yalnızca bu durumda deponuza `.github/workflows/sync-upstream.yml` dosyasını ekleyin, içeriğini <https://github.com/wuzf/2fa/blob/main/.github/workflows/sync-upstream.yml> adresinden kopyalayın ve bir kez commit yapın. Ardından yukarıdaki yükseltme adımlarını izleyin.

> **Önceki bir yükseltme `without workflows permission` hatasıyla başarısız olduysa**: Düzeltme kaynak deponun `main` dalında yayımlandığında, otomatik dağıtım yapılandırması birleştirme adımına sahip mevcut **Sync Upstream** iş akışları, YAML düzenlemeden veya PAT yapılandırmadan yukarıdaki adımlarla yükseltme yapabilir. `main` ile yeni bir çalıştırma başlatın; eski sürüm etiketleri düzeltmeyi içermez. Diğer durumlar için [yükseltme sorunlarını giderme](docs/DEPLOYMENT.md#升级故障排查) bölümüne bakın (Çince).

Bu yöntem mevcut Workers, KV bağlamaları veya Secrets üzerinde değişiklik yapmaz. **`ENCRYPTION_KEY` daha önce ayarlandıysa yükseltme sırasında yeniden girmeniz gerekmez; ayarlamadıysanız da bu yükseltme yöntemini kullanabilirsiniz.**

> ⚠️ `ENCRYPTION_KEY`, mevcut verilerin şifresini çözmek için kullanılan ana anahtardır. İlk oluşturulduğunda bir parola yöneticisine kaydettiğinizden emin olun. Cloudflare Secrets kaydedildikten sonra görüntülenemez; normal yükseltmelerde tekrar girilmeleri gerekmez, ancak özgün değeri kaydetmeden anahtarı silerseniz mevcut şifreli veriler kurtarılamaz.

> ⚠️ **1.8.0 öncesi bir sürüme geri dönme**: 1.8.0'dan itibaren HOTP sayaç artışları ana veriden ayrı saklanır. Geri dönmeden önce sayaçları ana veriye geri yazmak için sıkıştırma uç noktasını bir kez çağırın; aksi halde HOTP sayaçları yükseltme anındaki değerlerine döner. [Geri dönüş adımları](docs/DEPLOYMENT.md#回滚到-180-之前的版本) bölümüne bakın (Çince). Yalnızca TOTP kullanan kurulumlar etkilenmez.

#### Birleştirme sonucunu kontrol etme

`Sync Upstream` iş akışı, yükseltmeleri her zaman **aynı depoda ve aynı Worker üzerinde** tamamlamak için tasarlanmıştır. İş akışı artık `wrangler.toml` dosyasını otomatik birleştirir ve özette kaynak depoyla olan farkları gösterir; böylece hangi değerlerin yerel dağıtım yapılandırmanızdan geldiğini doğrulayabilirsiniz:

1. GitHub Actions çalıştırma özetinde `wrangler.toml` farklarını kontrol edin
2. Deponuzdaki `wrangler.toml` dosyasını açın
3. Worker adı, KV bağlamaları, rotalar ve mevcut dağıtım ayarlarının hâlâ doğru olduğunu doğrulayın
4. `wrangler.toml` içinde çok özel yapılandırmalar kullanıyorsanız gereken ek commit'leri yapın

> Cloudflare yeniden dağıtımı otomatik başlatmazsa **Deployments** sayfasına gidin ve mevcut deponuzun en son commit'ini yeniden dağıtın; silip yeniden kurmayın.

## 📖 Kullanım kılavuzu

### Anahtar ekleme

Sağ alt köşedeki **➕** kayan düğmeye tıklayın:

- **QR kod tara** — Kamerayla 2FA QR kodlarını tarar ve alanları otomatik doldurur
- **Görsel seç** — QR kod ekran görüntüsü yükleyerek otomatik tanıma sağlar
- **Ekran görüntüsü yapıştır** — Panodaki QR kod ekran görüntülerini Ctrl+V ile yapıştırın (kamerası olmayan bilgisayar kullanıcıları için uygundur)
- **Görsel sürükleyip bırak** — QR kod görsellerini doğrudan iletişim kutusuna sürükleyerek otomatik tanıma sağlar
- **Elle ekle** — Hizmet adını ve Base32 gizli anahtarını girin (basamak sayısı, süre ve algoritmayı ayarlamak için gelişmiş ayarları açın)

### Günlük kullanım

- **Kodu kopyala**: Doğrudan kodun rakamlarına tıklayın
- **Anahtarları yönet**: Kartın sağ üstündeki **⋯** simgesine tıklayın → QR kodu görüntüle / URI'yi kopyala / Sayfa bağlantısını kopyala / Düzenle / Sil
- **Ara**: Üstteki arama çubuğunda hizmet veya hesap adına göre anlık arama yapın
- **Akıllı gruplama**: İlgili hizmetler ve birden fazla hesap otomatik gruplanır; düz liste görünümüne dönme seçeneği vardır
- **Sırala**: Eklenme zamanına veya ada göre sıralayın
- **Tema**: Kayan işlem düğmesi → **Ayarlar → Tercihler → Tema modu**, ardından açık, koyu veya sistemi izle seçeneğini belirleyin

### Toplu içe aktarma

Kayan düğmeye → **📥 Toplu içe aktarma** seçeneğine tıklayın; dosya içe aktarma ve metin yapıştırma desteklenir.

**Uyumlu biçimler:**

| Kaynak                 | Biçim                                     |
| ---------------------- | ----------------------------------------- |
| Genel                  | `otpauth://` URI metni (TXT), CSV, HTML   |
| Google Authenticator   | Taşıma QR kodu (`otpauth-migration://`)   |
| Aegis                  | JSON dışa aktarma dosyası                 |
| 2FAS                   | `.2fas` dışa aktarma dosyası              |
| Bitwarden              | JSON veya Authenticator CSV dışa aktarımı |
| LastPass Authenticator | JSON dışa aktarma dosyası                 |
| andOTP                 | JSON dışa aktarma dosyası                 |
| Ente Auth              | Dışa aktarma dosyası                      |

### Toplu dışa aktarma

Kayan düğmeye → **📤 Toplu dışa aktarma** seçeneğine tıklayın; TXT, JSON, CSV ve HTML biçimleri ile **Google Authenticator taşıma QR kodları** oluşturma desteklenir (doğrudan içe aktarmak için taranabilir).
Standart TXT / JSON / CSV / HTML dışa aktarımları çevrimiçiyken sunucunun birleşik biçimini tercih eder; çevrimdışıyken veya istek gövdesi çok büyük olduğunda otomatik olarak uyumlu yerel dışa aktarıma geçer.

### Yedekleme ve geri yükleme

Sistem otomatik yedekleme yapar (veri değişikliklerinde ve günlük zamanlanmış kontrolde tetiklenir); en son 100 yedeği tutar (ayarlardan değiştirilebilir).
Yeni yedek dosyaları **Ayarlar → Varsayılan dışa aktarma biçimi** seçimini izler. Uzak otomatik yedekler de aynı uzantıyı (`txt`, `json`, `csv` veya `html`) kullanır.

Yedek listesini görüntülemek, içeriği önizlemek, geri yüklemek veya dışa aktarmak için kayan düğmeye → **🔄 Yapılandırmayı geri yükle** seçeneğine tıklayın. WebDAV/S3/OneDrive/Google Drive'dan indirdiğiniz bir `backup_*.(txt|json|csv|html)` dosyasını da yükleyerek önizleyebilir ve geri yükleyebilirsiniz.

#### Uzak yedekleme

Yedeklerin uzak depolamayla senkronizasyonu desteklenir. Veri değişikliklerinde yedekler otomatik gönderilir ve birden fazla yedek hedefi yapılandırılabilir:

- **WebDAV** — Standart WebDAV protokolünü kullanan bulut sürücülerini veya kendi barındırdığınız hizmetleri destekler (⚠️ Nutstore/jianguoyun gibi Cloudflare vekili üzerinden çalışan hizmetler desteklenmez; 520 döngü hatalarına yol açarlar)
- **S3 uyumlu depolama** — AWS S3, Cloudflare R2, MinIO, Alibaba Cloud OSS ve diğer S3 uyumlu hizmetleri destekler
- **OneDrive** — Microsoft OAuth yetkilendirmesinden sonra yedekler, OneDrive'da uygulamaya ayrılmış klasörün içindeki bir alt klasöre yazılır
- **Google Drive** — Google OAuth yetkilendirmesinden sonra yedekler yapılandırılan Google Drive klasörüne yazılır

Uzak yedek hedeflerini **Ayarlar → Senkronizasyon ayarları** bölümünden ekleyip yönetin.

Uzak yedekler, uygulamanın oluşturduğu yedek içeriğinin aynısını saklar. Yedek oluşturulurken `ENCRYPTION_KEY` yapılandırılmışsa uzak dosya da şifreli metindir; geri yüklemek için Worker'da aynı `ENCRYPTION_KEY` değerinin korunması gerekir.

Ayrıntılı kurulum adımları: [Bulut sürücüsü kurulumu](docs/CLOUD_DRIVE_SETUP.md) (şu anda Çince).

### Ayarlar

Kayan düğmeye → **⚙️ Ayarlar** seçeneğine tıklayın:

- **Parolayı değiştir** — Yönetici parolasını değiştirin
- **Tema modu** — Açık, koyu veya sistemi izle seçeneğini belirleyin
- **Kod geçiş animasyonu** — Animasyonları kapatın ya da akış, çevirme veya spot ışığı seçin
- **Oturum geçerliliği** — JWT geçerlilik süresini özelleştirin
- **Varsayılan dışa aktarma biçimi** — Varsayılan dışa aktarma seçimini ve yeni oluşturulan yedeklerle uzak otomatik yedeklerin uzantısını belirler
- **Saklanacak yedek sayısı** — Otomatik yedeklerin saklanma sayısını ayarlayın
- **Uzak yedekleme** — WebDAV/S3/OneDrive/Google Drive yedek hedeflerini yapılandırın
- **Çıkış yap** — Geçerli oturum çerezini ve yerel önbelleği tek tıkla temizler; sunucuya ulaşılamadığında da yerel olarak çalışır

### Mobil uygulama olarak yükleme (PWA)

- **iOS**: Safari'de açın → Paylaş düğmesi → Ana Ekrana Ekle
- **Android**: Chrome'da açın → Menü (⋮) → Ana ekrana ekle

Yükledikten sonra çevrimdışı erişim desteğiyle, yerel bir uygulama gibi tam ekranda kullanabilirsiniz.

### Chrome / Edge / Firefox ile TOTP doldurma

Bir hesap seçmek için eklentiye tıklayın veya önceden bağlanmış bir hesabın geçerli TOTP kodunu doldurmak için `Ctrl+Shift+U` tuşlarına basın. Her doğrulama sayfası için izin verildiğinde eklenti doğrulama alanlarını otomatik algılayıp doldurabilir; birden fazla eşleşme olduğunda hesap seçici gösterilir. Tek alanı veya 6/8 ayrı rakam alanını destekler ve formu göndermez.

Aynı tarayıcı profilinde 2FA kurulumuna giriş yaptıktan ve kurulum erişimine izin verdikten sonra kurulum sekmesini kapatabilirsiniz. Varsayılan olarak eklenti, geçerli oturum üzerinden gizli anahtarları okur ve her görev için kodları arka plan belleğinde hesaplar; oturum süresi dolduğunda yeniden giriş yapın. Çevrimdışı kullanımı açıkça etkinleştirmek, bağımsız bir yerel gizli anahtar önbelleği kaydeder; böylece ağ bağlantısı veya açık bir kurulum sekmesi olmadan kodlar kullanılabilir. Bu önbellek ek bir parolayla şifrelenmez. Yetkili eklenti kodu gizli anahtar listesinin tamamını okuyabilir, ancak gizli anahtarlar hiçbir zaman eklentinin açılır penceresine veya hedef siteye gönderilmez. Açık Shadow DOM ve aynı kökenli iframe alanları desteklenir; HOTP, farklı kökenli iframe'ler, kapalı Shadow DOM ve özel gezinme desteklenmez.

[Yükleme ve kullanım kılavuzuna](docs/BROWSER_EXTENSION.md), [Chrome / Edge gizlilik bildirimine](extension/PRIVACY.md) ve [Firefox gizlilik bildirimine](extension/PRIVACY_FIREFOX.md) bakın (şu anda Çince).

## 🔒 Güvenlik

- **Parola**: PBKDF2-SHA256 (100.000 yineleme) ile tuzlanmış özet; JWT, HttpOnly + Secure + SameSite=Strict çerezlerinde saklanır
- **Veri şifreleme**: `ENCRYPTION_KEY` yapılandırıldığında tüm gizli anahtarlar, yedekler ve WebDAV/S3/OneDrive/Google Drive kimlik bilgileri AES-GCM 256 bit ile şifrelenir; özgün anahtarı mutlaka saklayın — kaybedilirse şifreli veriler çözülemez
- **İletim**: Baştan sona HTTPS, TLS 1.2+
- **Gizlilik**: OTP istemci tarafında üretilir, kullanım verisi toplanmaz, tamamen açık kaynaklıdır
- **Oturum geçerliliği**: Varsayılan 30 gündür, ayarlardan özelleştirilebilir; etkin kullanımda otomatik yenilenir (7 günden az süre kaldığında otomatik uzatılır)

## 🔗 Herkese açık OTP API'si

Giriş yapmadan doğrudan URL üzerinden doğrulama kodları üretin:

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

Parametreler: `type` (totp/hotp), `digits` (6/8), `period` (30/60/120), `algorithm` (sha1/sha256/sha512), `counter` (HOTP için)

TOTP sayfaları hem geçerli hem de sonraki kodu gösterir; her ikisi de kopyalanabilir ve süre bittiğinde sayfa yenilenmeden güncellenir. HOTP sayfaları bağlantıda belirtilen sayacı kullanır; kopyalama sayacı artırmaz.

## 📚 Diğer belgeler

| Belge                                                | Açıklama                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| [Dağıtım kılavuzu](docs/DEPLOYMENT.md)               | Elle dağıtım, KV yapılandırması, Secrets                     |
| [Bulut sürücüsü kurulumu](docs/CLOUD_DRIVE_SETUP.md) | OneDrive / Google Drive kurulum adımları (Çince)             |
| [API başvuru belgesi](docs/API_REFERENCE.md)         | Tüm API uç noktalarının belgeleri                            |
| [Mimari](docs/ARCHITECTURE.md)                       | Sistem mimarisi ve teknik tasarım                            |
| [Geliştirme kılavuzu](docs/DEVELOPMENT.md)           | Yerel geliştirme, testler, kod biçemi                        |
| [PWA kılavuzu](docs/PWA_GUIDE.md)                    | PWA kurulumu ve çevrimdışı özellikler                        |
| [Tarayıcı eklentisi](docs/BROWSER_EXTENSION.md)      | Chrome / Edge / Firefox yükleme, kullanım ve izinler (Çince) |

## 🤝 Katkıda bulunma

[Issue](https://github.com/wuzf/2fa/issues) ve [Pull Request](https://github.com/wuzf/2fa/pulls) gönderebilirsiniz. Geliştirme ayrıntıları için [Geliştirme kılavuzuna](docs/DEVELOPMENT.md) bakın.

## 📄 Lisans

[MIT Lisansı](LICENSE)

## 🌟 Yıldız geçmişi

<p align="center">
  <a href="https://github.com/wuzf/2fa/tree/star-history">
    <img alt="Yıldız geçmişi grafiği" src="https://raw.githubusercontent.com/wuzf/2fa/refs/heads/star-history/star-history.svg" />
  </a>
</p>

---

<div align="center">

**Bu proje işinize yaradıysa lütfen bir ⭐ verin**

[wuzf](https://github.com/wuzf) tarafından ❤️ ile geliştirildi

</div>
