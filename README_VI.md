# 🔐 2FA

Hệ thống quản lý khóa xác thực hai yếu tố được xây dựng trên Cloudflare Workers. Triển khai miễn phí, tăng tốc trên toàn cầu và hỗ trợ sử dụng ngoại tuyến qua PWA.

![Phiên bản](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![Giấy phép](https://img.shields.io/badge/license-MIT-green)
![Nền tảng](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](README.md) · [繁體中文](README_TC.md) · [English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md) ·
[Deutsch](README_DE.md) · [Français](README_FR.md) · [Español](README_ES.md) · [Português (Brasil)](README_PT_BR.md) · [Italiano](README_IT.md) ·
[Русский](README_RU.md) · [Türkçe](README_TR.md) · [Bahasa Indonesia](README_ID.md) · **[Tiếng Việt](README_VI.md)** · [ไทย](README_TH.md)

<!-- README_LANGUAGE_NAV_END -->

**Tính năng chính:** Tự động tạo mã TOTP/HOTP · Thêm khóa bằng cách quét mã QR, nhận diện hình ảnh, dán ảnh chụp màn hình hoặc kéo thả ảnh · Lưu trữ mã hóa AES-GCM 256 bit · Nhập hàng loạt từ Google Authenticator, Aegis, 2FAS, Bitwarden và các ứng dụng khác · Xuất nhiều định dạng (TXT/JSON/CSV/HTML/mã QR di chuyển của Google) · Tự động sao lưu và khôi phục · Đồng bộ bản sao lưu từ xa qua WebDAV/S3/OneDrive/Google Drive · Cài đặt bảo mật, đồng bộ và tùy chọn · 15 ngôn ngữ trên toàn dự án (tự động nhận diện / chọn thủ công) · Giao diện sáng, tối hoặc theo hệ thống · Giao diện thích ứng lấy cảm hứng từ Fluent 2

Ứng dụng web, tiện ích trình duyệt, thiết lập ban đầu, trang OTP công khai, thông báo API và tài liệu sao lưu hỗ trợ tiếng Trung giản thể, tiếng Trung phồn thể, tiếng Anh, tiếng Nhật, tiếng Hàn, tiếng Đức, tiếng Pháp, tiếng Tây Ban Nha, tiếng Bồ Đào Nha (Brazil), tiếng Ý, tiếng Nga, tiếng Thổ Nhĩ Kỳ, tiếng Indonesia, tiếng Việt và tiếng Thái. Giao diện dùng ngôn ngữ của trình duyệt hoặc lựa chọn thủ công; nếu ngôn ngữ trình duyệt không được hỗ trợ thì dùng tiếng Anh. Có thể nhập bản sao lưu CSV/HTML giữa các ngôn ngữ giao diện khác nhau.

## 🧩 Tiện ích trình duyệt

Cài đặt 2FA Verification Assistant: **[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**.

Mở liên kết cài đặt trong trình duyệt tương ứng. Sau khi cài đặt, nhập URL của hệ thống 2FA do bạn tự triển khai vào phần cài đặt tiện ích và đăng nhập vào hệ thống đó trong cùng trình duyệt để xem, sao chép và điền mã TOTP. Tự động điền yêu cầu cấp quyền riêng cho từng trang xác minh. Tiện ích cần một hệ thống đã triển khai từ dự án này và giao diện hỗ trợ 15 ngôn ngữ nêu trên. Firefox yêu cầu phiên bản máy tính 153 trở lên, trong tab thông thường sử dụng vùng chứa mặc định; không hỗ trợ tab vùng chứa, cửa sổ riêng tư và Android.

[Hướng dẫn cài đặt và sử dụng](docs/BROWSER_EXTENSION.md) · [Chính sách quyền riêng tư Chrome / Edge](extension/PRIVACY.md) · [Chính sách quyền riêng tư Firefox](extension/PRIVACY_FIREFOX.md) (tiếng Trung)

## 📸 Ảnh chụp màn hình

|                    Máy tính                     |                    Máy tính bảng                    |                    Điện thoại                    |
| :---------------------------------------------: | :-------------------------------------------------: | :----------------------------------------------: |
| ![Máy tính](docs/images/screenshot-desktop.png) | ![Máy tính bảng](docs/images/screenshot-tablet.png) | ![Điện thoại](docs/images/screenshot-mobile.png) |

## 🚀 Triển khai nhanh

### Bản dùng thử trực tuyến

Truy cập trang dùng thử (mật khẩu `2fa-Demo.`): **[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### Triển khai bằng một lần nhấp (khuyến nghị)

[![Triển khai lên Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> Khuyến nghị triển khai bằng một lần nhấp. Tất cả người dùng nên nâng cấp tại chỗ bằng quy trình **Sync Upstream**. Không nâng cấp bằng cách xóa Worker, xóa kho mã hoặc cài đặt lại.

1. Nhấp vào nút bên trên, đăng nhập bằng GitHub và cấp quyền
2. Đăng nhập tài khoản Cloudflare, nhấp **Deploy** và chờ triển khai hoàn tất (bộ lưu trữ KV được tạo tự động)
3. Mở URL Workers do Cloudflare cung cấp, **đặt mật khẩu quản trị** và bắt đầu sử dụng

> Quá trình dựng tự động từ Git sử dụng trực tiếp `wrangler.toml` trong kho mã. Cấu hình hiện tại khai báo rõ `SECRETS_KV`; Wrangler sẽ tự động tạo KV cần thiết trong lần triển khai đầu tiên và tiếp tục dùng tài nguyên đã liên kết với Worker hiện tại trong những lần triển khai tiếp theo.
> Nếu bạn tự cấu hình lệnh dựng Git trong Cloudflare Dashboard, **hãy dùng `npm run deploy` làm lệnh triển khai thay vì chạy trực tiếp `npx wrangler deploy`**, để giữ nguyên quy trình chèn thông tin phiên bản và nhất quán với điểm vào triển khai mặc định của kho mã.

#### Khuyến nghị: Bật mã hóa dữ liệu

Sau khi triển khai, thêm Secret `ENCRYPTION_KEY` trong **Cloudflare Dashboard → Worker → Settings → Variables**:

```bash
# Tạo khóa mã hóa (chọn một cách)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY` là khóa chính để giải mã dữ liệu hiện có. **Khuyến nghị thiết lập**, với điều kiện bạn lưu ngay giá trị gốc vào trình quản lý mật khẩu, bản sao lưu ngoại tuyến hoặc một nơi an toàn khác.
>
> Nếu không thể bảo đảm đã lưu giá trị gốc, **thà không thiết lập còn hơn thiết lập rồi làm mất khóa**:
>
> - Sau khi thiết lập: Danh sách khóa bí mật, bản sao lưu tự động và thông tin xác thực WebDAV/S3/OneDrive/Google Drive đều được mã hóa
> - Nếu bị mất: Cloudflare sẽ không hiển thị lại giá trị gốc; không thể đọc hoặc khôi phục dữ liệu mã hóa và bản sao lưu mã hóa hiện có
> - Hành vi hiện tại: Khi phát hiện dữ liệu mã hóa nhưng thiếu `ENCRYPTION_KEY`, hệ thống khóa thao tác đọc và ghi để tránh vô tình ghi đè dữ liệu cũ

#### Cập nhật phiên bản

Triển khai bằng một lần nhấp tạo ra một kho mã độc lập (không phải Fork). Việc nâng cấp được thực hiện tại chỗ bằng quy trình **Sync Upstream**.

> ⚠️ **Luôn sao lưu dữ liệu trước khi nâng cấp**: Trước khi cập nhật phiên bản, hãy xuất dữ liệu hiện tại qua **Xuất hàng loạt** hoặc **Khôi phục cấu hình → Xuất bản sao lưu** để tránh mất dữ liệu nếu xảy ra lỗi.

1. Mở kho mã 2fa được tạo trong tài khoản GitHub của bạn khi triển khai bằng một lần nhấp
2. Vào **Actions** → **Sync Upstream**
3. Nhấp **Run workflow**, giữ nhánh nguồn ở giá trị mặc định `main` và bắt đầu một lượt chạy mới
4. Chờ đồng bộ và triển khai tự động của Cloudflare hoàn tất, sau đó tải lại ứng dụng

Quy trình tự động giữ nguyên tên Worker, liên kết KV và các cài đặt triển khai phổ biến trong kho mã của bạn, rồi triển khai lại **chính Worker đó**. Các tệp quy trình hiện có trong kho mã cũng được giữ nguyên.

> **Nếu không có Sync Upstream**: Kho mã được tạo bằng triển khai một lần nhấp có thể không chứa các quy trình. Chỉ trong trường hợp này, hãy thêm `.github/workflows/sync-upstream.yml` vào kho mã, sao chép nội dung từ <https://github.com/wuzf/2fa/blob/main/.github/workflows/sync-upstream.yml> và tạo một commit. Sau đó làm theo các bước nâng cấp bên trên.

> **Nếu lần nâng cấp trước thất bại với lỗi `without workflows permission`**: Sau khi bản sửa được đưa lên nhánh `main` của kho nguồn, các quy trình **Sync Upstream** hiện có bước tự động hợp nhất cấu hình triển khai có thể nâng cấp theo các bước bên trên mà không cần sửa YAML hoặc cấu hình PAT. Bắt đầu lượt chạy mới với `main`; các thẻ phát hành cũ không chứa bản sửa. Với trường hợp khác, xem [khắc phục sự cố nâng cấp](docs/DEPLOYMENT.md#升级故障排查) (tiếng Trung).

Cách này không ảnh hưởng đến Workers, liên kết KV hoặc Secrets hiện có. **Nếu đã thiết lập `ENCRYPTION_KEY`, bạn không cần nhập lại khi nâng cấp; nếu chưa thiết lập, bạn vẫn có thể dùng quy trình nâng cấp này.**

> ⚠️ `ENCRYPTION_KEY` là khóa chính để giải mã dữ liệu hiện có. Hãy lưu vào trình quản lý mật khẩu ngay khi tạo lần đầu. Không thể xem Cloudflare Secrets sau khi lưu; nâng cấp thông thường không cần nhập lại, nhưng nếu xóa khóa mà chưa lưu giá trị gốc, dữ liệu mã hóa hiện có sẽ không thể khôi phục.

> ⚠️ **Quay về phiên bản trước 1.8.0**: Từ 1.8.0, các lần tăng bộ đếm HOTP được lưu riêng với dữ liệu chính. Trước khi quay về phiên bản cũ, gọi điểm cuối hợp nhất dữ liệu một lần để ghi các bộ đếm trở lại dữ liệu chính; nếu không, bộ đếm HOTP sẽ trở về giá trị tại thời điểm nâng cấp. Xem [các bước quay về phiên bản cũ](docs/DEPLOYMENT.md#回滚到-180-之前的版本) (tiếng Trung). Các hệ thống chỉ dùng TOTP không bị ảnh hưởng.

#### Kiểm tra kết quả hợp nhất

Quy trình `Sync Upstream` được thiết kế để luôn hoàn tất nâng cấp trên **cùng một kho mã và cùng một Worker**. Quy trình hiện tự động hợp nhất `wrangler.toml` và hiển thị phần khác biệt với kho nguồn trong bản tóm tắt, để bạn xác nhận những giá trị nào đến từ cấu hình triển khai cục bộ:

1. Kiểm tra phần khác biệt của `wrangler.toml` trong bản tóm tắt lượt chạy GitHub Actions
2. Mở `wrangler.toml` trong kho mã của bạn
3. Xác nhận tên Worker, liên kết KV, tuyến đường và các cài đặt triển khai hiện có vẫn chính xác
4. Nếu duy trì các cấu hình `wrangler.toml` rất đặc thù, hãy tạo thêm commit khi cần

> Nếu Cloudflare không tự động bắt đầu triển khai lại, vào trang **Deployments** và triển khai lại commit mới nhất của kho mã hiện tại — không xóa rồi cài đặt lại.

## 📖 Hướng dẫn sử dụng

### Thêm khóa

Nhấp vào nút nổi **➕** ở góc dưới bên phải:

- **Quét mã QR** — Quét mã QR 2FA bằng camera để tự động điền thông tin
- **Chọn ảnh** — Tải lên ảnh chụp mã QR để tự động nhận diện
- **Dán ảnh chụp màn hình** — Dùng Ctrl+V để dán ảnh chụp mã QR từ bộ nhớ tạm (phù hợp với người dùng máy tính không có camera)
- **Kéo thả ảnh** — Kéo ảnh mã QR trực tiếp vào hộp thoại để tự động nhận diện
- **Thêm thủ công** — Nhập tên dịch vụ và khóa bí mật Base32 (mở cài đặt nâng cao để điều chỉnh số chữ số, chu kỳ và thuật toán)

### Sử dụng hằng ngày

- **Sao chép mã**: Nhấp trực tiếp vào các chữ số của mã
- **Quản lý khóa**: Nhấp **⋯** ở góc trên bên phải thẻ → Xem mã QR / Sao chép URI / Sao chép liên kết trang / Sửa / Xóa
- **Tìm kiếm**: Tìm theo tên dịch vụ hoặc tên tài khoản theo thời gian thực trên thanh tìm kiếm phía trên
- **Nhóm thông minh**: Tự động nhóm các dịch vụ liên quan và nhiều tài khoản, có tùy chọn chuyển về danh sách không phân nhóm
- **Sắp xếp**: Sắp xếp theo thời gian thêm hoặc tên
- **Giao diện**: Nút thao tác nổi → **Cài đặt → Tùy chọn → Chế độ giao diện**, sau đó chọn sáng, tối hoặc theo hệ thống

### Nhập hàng loạt

Nhấp nút nổi → **📥 Nhập hàng loạt**; hỗ trợ nhập tệp hoặc dán văn bản.

**Định dạng tương thích:**

| Nguồn                  | Định dạng                                 |
| ---------------------- | ----------------------------------------- |
| Chung                  | Văn bản URI `otpauth://` (TXT), CSV, HTML |
| Google Authenticator   | Mã QR di chuyển (`otpauth-migration://`)  |
| Aegis                  | Tệp xuất JSON                             |
| 2FAS                   | Tệp xuất `.2fas`                          |
| Bitwarden              | Bản xuất JSON hoặc CSV của Authenticator  |
| LastPass Authenticator | Tệp xuất JSON                             |
| andOTP                 | Tệp xuất JSON                             |
| Ente Auth              | Tệp xuất                                  |

### Xuất hàng loạt

Nhấp nút nổi → **📤 Xuất hàng loạt**; hỗ trợ các định dạng TXT, JSON, CSV, HTML và tạo **mã QR di chuyển Google Authenticator** (có thể quét để nhập trực tiếp).
Xuất TXT / JSON / CSV / HTML tiêu chuẩn ưu tiên định dạng thống nhất từ máy chủ khi trực tuyến, và tự động chuyển sang xuất cục bộ tương thích khi ngoại tuyến hoặc khi phần thân yêu cầu quá lớn.

### Sao lưu và khôi phục

Hệ thống tự động sao lưu (kích hoạt khi dữ liệu thay đổi và qua kiểm tra theo lịch hằng ngày), giữ lại 100 bản sao lưu mới nhất (có thể điều chỉnh trong cài đặt).
Tệp sao lưu mới tuân theo **Cài đặt → Định dạng xuất mặc định**. Bản sao lưu tự động từ xa dùng cùng phần mở rộng (`txt`, `json`, `csv` hoặc `html`).

Nhấp nút nổi → **🔄 Khôi phục cấu hình** để xem danh sách bản sao lưu, xem trước nội dung, khôi phục hoặc xuất; bạn cũng có thể tải lên tệp `backup_*.(txt|json|csv|html)` đã tải xuống từ WebDAV/S3/OneDrive/Google Drive để xem trước và khôi phục.

#### Sao lưu từ xa

Hỗ trợ đồng bộ bản sao lưu lên bộ lưu trữ từ xa, tự động gửi khi dữ liệu thay đổi và cho phép cấu hình nhiều đích sao lưu:

- **WebDAV** — Hỗ trợ ổ đĩa đám mây hoặc dịch vụ tự triển khai sử dụng giao thức WebDAV tiêu chuẩn (⚠️ Không hỗ trợ dịch vụ qua proxy Cloudflare như Nutstore/jianguoyun vì gây lỗi vòng lặp 520)
- **Bộ lưu trữ tương thích S3** — Hỗ trợ AWS S3, Cloudflare R2, MinIO, Alibaba Cloud OSS và các dịch vụ tương thích S3 khác
- **OneDrive** — Sau khi cấp quyền Microsoft OAuth, bản sao lưu được ghi vào một thư mục con bên trong thư mục OneDrive dành riêng cho ứng dụng
- **Google Drive** — Sau khi cấp quyền Google OAuth, bản sao lưu được ghi vào thư mục Google Drive đã cấu hình

Thêm và quản lý các đích sao lưu từ xa trong **Cài đặt → Cài đặt đồng bộ**.

Bản sao lưu từ xa lưu cùng nội dung sao lưu mà ứng dụng tạo ra. Nếu `ENCRYPTION_KEY` đã được cấu hình khi tạo bản sao lưu, tệp từ xa cũng là dữ liệu mã hóa; để khôi phục, Worker phải giữ cùng giá trị `ENCRYPTION_KEY`.

Các bước thiết lập chi tiết: [Thiết lập ổ đĩa đám mây](docs/CLOUD_DRIVE_SETUP.md) (hiện bằng tiếng Trung).

### Cài đặt

Nhấp nút nổi → **⚙️ Cài đặt**:

- **Đổi mật khẩu** — Thay đổi mật khẩu quản trị
- **Chế độ giao diện** — Chọn sáng, tối hoặc theo hệ thống
- **Hiệu ứng chuyển mã** — Tắt hiệu ứng hoặc chọn trôi, lật hoặc chiếu sáng
- **Thời hạn đăng nhập** — Tùy chỉnh thời gian hết hạn JWT
- **Định dạng xuất mặc định** — Quy định lựa chọn xuất mặc định và phần mở rộng cho bản sao lưu mới cũng như bản sao lưu tự động từ xa
- **Số bản sao lưu được giữ lại** — Điều chỉnh số lượng bản sao lưu tự động được lưu giữ
- **Sao lưu từ xa** — Cấu hình đích sao lưu WebDAV/S3/OneDrive/Google Drive
- **Đăng xuất** — Xóa cookie phiên hiện tại và bộ nhớ đệm cục bộ bằng một lần nhấp; vẫn hoạt động cục bộ khi không thể kết nối máy chủ

### Cài đặt như ứng dụng di động (PWA)

- **iOS**: Mở bằng Safari → Nút Chia sẻ → Thêm vào Màn hình chính
- **Android**: Mở bằng Chrome → Menu (⋮) → Thêm vào màn hình chính

Sau khi cài đặt, có thể dùng toàn màn hình như ứng dụng gốc, với hỗ trợ truy cập ngoại tuyến.

### Điền TOTP trên Chrome / Edge / Firefox

Nhấp vào tiện ích để chọn tài khoản hoặc nhấn `Ctrl+Shift+U` để điền TOTP hiện tại cho tài khoản đã liên kết trước đó. Khi được cấp quyền cho từng trang xác minh, tiện ích có thể tự động phát hiện và điền các ô xác minh; nếu có nhiều kết quả phù hợp, bộ chọn tài khoản sẽ xuất hiện. Hỗ trợ một ô nhập hoặc 6/8 ô chữ số riêng biệt và không gửi biểu mẫu.

Sau khi đăng nhập vào hệ thống 2FA trong cùng hồ sơ trình duyệt và cấp quyền truy cập hệ thống, bạn có thể đóng tab hệ thống. Theo mặc định, tiện ích đọc khóa bí mật thông qua phiên hợp lệ và tính mã trong bộ nhớ nền cho từng tác vụ; hãy đăng nhập lại khi phiên hết hạn. Chủ động bật sử dụng ngoại tuyến sẽ lưu một bộ nhớ đệm khóa bí mật cục bộ độc lập, giúp mã vẫn khả dụng khi không có kết nối mạng hoặc không mở tab hệ thống. Bộ nhớ đệm không được mã hóa thêm bằng mật khẩu. Mã của tiện ích được cấp quyền có thể đọc toàn bộ danh sách khóa bí mật, nhưng khóa bí mật không bao giờ được gửi đến cửa sổ bật lên của tiện ích hoặc trang đích. Hỗ trợ các ô trong Shadow DOM mở và iframe cùng nguồn; không hỗ trợ HOTP, iframe khác nguồn, Shadow DOM đóng và duyệt web riêng tư.

Xem [hướng dẫn cài đặt và sử dụng](docs/BROWSER_EXTENSION.md), [thông báo quyền riêng tư Chrome / Edge](extension/PRIVACY.md) và [thông báo quyền riêng tư Firefox](extension/PRIVACY_FIREFOX.md) (hiện bằng tiếng Trung).

## 🔒 Bảo mật

- **Mật khẩu**: Băm có salt bằng PBKDF2-SHA256 (100.000 vòng lặp); JWT được lưu trong cookie HttpOnly + Secure + SameSite=Strict
- **Mã hóa dữ liệu**: Khi cấu hình `ENCRYPTION_KEY`, mọi khóa bí mật, bản sao lưu và thông tin xác thực WebDAV/S3/OneDrive/Google Drive được mã hóa bằng AES-GCM 256 bit; hãy giữ giá trị khóa gốc — không thể giải mã dữ liệu nếu mất khóa
- **Truyền tải**: HTTPS trên toàn bộ kết nối, TLS 1.2+
- **Quyền riêng tư**: OTP được tạo phía máy khách, không thu thập dữ liệu sử dụng, mã nguồn mở hoàn toàn
- **Thời hạn đăng nhập**: Mặc định 30 ngày, có thể tùy chỉnh trong cài đặt, tự động gia hạn khi đang sử dụng (tự động gia hạn khi còn dưới 7 ngày)

## 🔗 API OTP công khai

Tạo mã xác minh trực tiếp qua URL mà không cần đăng nhập:

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

Tham số: `type` (totp/hotp), `digits` (6/8), `period` (30/60/120), `algorithm` (sha1/sha256/sha512), `counter` (cho HOTP)

Trang TOTP hiển thị cả mã hiện tại và mã kế tiếp, mỗi mã đều có thể sao chép, và cập nhật ngay trên trang khi chu kỳ kết thúc. Trang HOTP dùng bộ đếm được chỉ định trong liên kết; việc sao chép không làm tăng bộ đếm.

## 📚 Tài liệu khác

| Tài liệu                                             | Mô tả                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| [Hướng dẫn triển khai](docs/DEPLOYMENT.md)           | Triển khai thủ công, cấu hình KV, Secrets                           |
| [Thiết lập ổ đĩa đám mây](docs/CLOUD_DRIVE_SETUP.md) | Các bước thiết lập OneDrive / Google Drive (tiếng Trung)            |
| [Tài liệu tham khảo API](docs/API_REFERENCE.md)      | Tài liệu đầy đủ về các điểm cuối API                                |
| [Kiến trúc](docs/ARCHITECTURE.md)                    | Kiến trúc hệ thống và thiết kế kỹ thuật                             |
| [Hướng dẫn phát triển](docs/DEVELOPMENT.md)          | Phát triển cục bộ, kiểm thử, quy cách mã nguồn                      |
| [Hướng dẫn PWA](docs/PWA_GUIDE.md)                   | Cài đặt PWA và các tính năng ngoại tuyến                            |
| [Tiện ích trình duyệt](docs/BROWSER_EXTENSION.md)    | Cài đặt, sử dụng và quyền của Chrome / Edge / Firefox (tiếng Trung) |

## 🤝 Đóng góp

Hoan nghênh bạn gửi [Issue](https://github.com/wuzf/2fa/issues) và [Pull Request](https://github.com/wuzf/2fa/pulls). Để biết chi tiết về phát triển, xem [Hướng dẫn phát triển](docs/DEVELOPMENT.md).

## 📄 Giấy phép

[Giấy phép MIT](LICENSE)

## 🌟 Lịch sử sao

<p align="center">
  <a href="https://github.com/wuzf/2fa/tree/star-history">
    <img alt="Biểu đồ lịch sử sao" src="https://raw.githubusercontent.com/wuzf/2fa/refs/heads/star-history/star-history.svg" />
  </a>
</p>

---

<div align="center">

**Nếu dự án hữu ích với bạn, hãy tặng một ⭐**

Được tạo bằng ❤️ bởi [wuzf](https://github.com/wuzf)

</div>
