# 🔐 2FA

Un sistema de gestión de claves de autenticación de dos factores basado en Cloudflare Workers. Despliegue gratuito, aceleración global y compatibilidad con el uso sin conexión mediante PWA.

![Version](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](README.md) · [繁體中文](README_TC.md) · [English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md) ·
[Deutsch](README_DE.md) · [Français](README_FR.md) · **[Español](README_ES.md)** · [Português (Brasil)](README_PT_BR.md) · [Italiano](README_IT.md) ·
[Русский](README_RU.md) · [Türkçe](README_TR.md) · [Bahasa Indonesia](README_ID.md) · [Tiếng Việt](README_VI.md) · [ไทย](README_TH.md)

<!-- README_LANGUAGE_NAV_END -->

**Funciones principales:** Generación automática de códigos TOTP/HOTP · Añadir claves mediante escaneo de QR, reconocimiento de imágenes, capturas de pantalla pegadas o imágenes arrastradas · Almacenamiento cifrado con AES-GCM de 256 bits · Importación masiva desde Google Authenticator, Aegis, 2FAS, Bitwarden, etc. · Exportación en varios formatos (TXT/JSON/CSV/HTML/códigos QR de migración de Google) · Copia de seguridad y restauración automáticas · Sincronización de copias remotas con WebDAV/S3/OneDrive/Google Drive · Ajustes de seguridad, sincronización y preferencias · 15 idiomas en todo el proyecto (detección automática / selección manual) · Temas claro, oscuro o según el sistema · Interfaz adaptable inspirada en Fluent 2

La aplicación web, las extensiones del navegador, la configuración inicial, las páginas OTP públicas, los mensajes de la API y los documentos de copia de seguridad admiten chino simplificado, chino tradicional, inglés, japonés, coreano, alemán, francés, español, portugués (Brasil), italiano, ruso, turco, indonesio, vietnamita y tailandés. La interfaz sigue el idioma del navegador o una selección manual; si el idioma del navegador no es compatible, se utiliza el inglés. Las copias CSV/HTML se pueden importar independientemente del idioma de la interfaz.

## 🧩 Extensión del navegador

Instala 2FA Verification Assistant: **[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**.

Abre el enlace de instalación en el navegador correspondiente. Después de instalarla, introduce la URL de tu instancia de 2FA autoalojada en los ajustes de la extensión e inicia sesión en esa instancia desde el mismo navegador para ver, copiar y rellenar códigos TOTP. El rellenado automático requiere un permiso independiente para cada página de verificación. La extensión necesita una instancia desplegada de este proyecto y su interfaz admite los 15 idiomas indicados arriba. Firefox requiere la versión 153 o posterior para escritorio, en una pestaña normal que use el contenedor predeterminado. No se admiten las pestañas de contenedor, las ventanas privadas ni Android.

[Guía de instalación y uso](docs/BROWSER_EXTENSION.md) · [Política de privacidad de Chrome / Edge](extension/PRIVACY.md) · [Política de privacidad de Firefox](extension/PRIVACY_FIREFOX.md) (en chino)

## 📸 Capturas de pantalla

|                    Escritorio                     |                    Tableta                    |                    Móvil                    |
| :-----------------------------------------------: | :-------------------------------------------: | :-----------------------------------------: |
| ![Escritorio](docs/images/screenshot-desktop.png) | ![Tableta](docs/images/screenshot-tablet.png) | ![Móvil](docs/images/screenshot-mobile.png) |

## 🚀 Despliegue rápido

### Demostración en línea

Visita el sitio de demostración (contraseña `2fa-Demo.`): **[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### Despliegue con un clic (recomendado)

[![Desplegar en Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> Se recomienda el despliegue con un clic. Todos los usuarios deben actualizar su instalación existente mediante el flujo de trabajo **Sync Upstream**. No actualices eliminando el Worker, eliminando el repositorio ni reinstalando.

1. Haz clic en el botón anterior, inicia sesión con GitHub y concede la autorización.
2. Inicia sesión en tu cuenta de Cloudflare, haz clic en **Deploy** y espera a que termine el despliegue. El almacenamiento KV se crea automáticamente.
3. Abre la URL de Workers proporcionada por Cloudflare, **establece tu contraseña de administrador** y empieza a utilizar la aplicación.

> La compilación automática de Git utiliza directamente el archivo `wrangler.toml` del repositorio. La configuración actual declara explícitamente `SECRETS_KV`. Wrangler crea automáticamente el KV necesario en el primer despliegue y sigue reutilizando el recurso vinculado al Worker actual en los despliegues posteriores.
> Si configuras manualmente los comandos de compilación de Git en el panel de Cloudflare, **utiliza `npm run deploy` como comando de despliegue, en lugar de ejecutar directamente `npx wrangler deploy`**, para conservar la incorporación de la información de versión y mantener la coherencia con el punto de entrada de despliegue predeterminado del repositorio.

#### Recomendación: activar el cifrado de datos

Después del despliegue, añade un Secret llamado `ENCRYPTION_KEY` en **Cloudflare Dashboard → Worker → Settings → Variables**:

```bash
# Generate encryption key (choose one)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY` es la clave maestra para descifrar los datos existentes. **Se recomienda configurarla**, siempre que guardes de inmediato su valor original en un gestor de contraseñas, una copia sin conexión u otro lugar seguro.
>
> Si no puedes garantizar que conservarás el valor original, **es mejor no configurarla que configurarla y perderla después**:
>
> - Una vez configurada: se cifran la lista de claves, las copias automáticas y las credenciales de WebDAV/S3/OneDrive/Google Drive.
> - Si se pierde: Cloudflare no vuelve a mostrar el valor original; no se podrán leer ni restaurar los datos cifrados existentes ni las copias cifradas.
> - Comportamiento actual: cuando se detectan datos cifrados pero falta `ENCRYPTION_KEY`, el sistema bloquea la lectura y la escritura para evitar sobrescribir accidentalmente los datos antiguos.

#### Actualizaciones de versión

El despliegue con un clic crea un repositorio independiente, no un fork. Las actualizaciones se realizan sobre la instalación existente mediante el flujo de trabajo **Sync Upstream**.

> ⚠️ **Haz siempre una copia de seguridad antes de actualizar**: antes de actualizar la versión, exporta tus datos actuales mediante **Exportación masiva** o **Restaurar configuración → Exportar copia de seguridad**, para evitar pérdidas de datos si se produce un fallo.

1. Abre el repositorio 2fa creado en tu cuenta de GitHub durante el despliegue con un clic.
2. Ve a **Actions** → **Sync Upstream**.
3. Haz clic en **Run workflow**, mantén la rama de origen en el valor predeterminado `main` e inicia una nueva ejecución.
4. Espera a que terminen la sincronización y el despliegue automático de Cloudflare; después, actualiza la página de la aplicación.

El flujo de trabajo conserva automáticamente el nombre del Worker, las vinculaciones KV y los ajustes habituales de despliegue de tu repositorio, y vuelve a desplegar **el mismo Worker**. También conserva los archivos de flujos de trabajo que ya existen en tu repositorio.

> **Si falta Sync Upstream**: un repositorio creado mediante el despliegue con un clic puede no incluir flujos de trabajo. Solo en ese caso, añade `.github/workflows/sync-upstream.yml` a tu repositorio, copia su contenido desde <https://github.com/wuzf/2fa/blob/main/.github/workflows/sync-upstream.yml> y crea un commit. Después, sigue los pasos de actualización anteriores.

> **Si una actualización anterior falló con `without workflows permission`**: una vez publicada la corrección en la rama `main` del repositorio de origen, los flujos **Sync Upstream** existentes que incluyan el paso de combinación automática de la configuración de despliegue podrán actualizarse siguiendo los pasos anteriores, sin editar YAML ni configurar un PAT. Inicia una nueva ejecución con `main`; las etiquetas de versiones anteriores no incluyen la corrección. Para otros casos, consulta la [resolución de problemas de actualización](docs/DEPLOYMENT.md#升级故障排查) (en chino).

Este método no afecta a los Workers, las vinculaciones KV ni los Secrets existentes. **Si ya configuraste `ENCRYPTION_KEY`, no necesitas volver a introducirla durante las actualizaciones; si no la has configurado, también puedes utilizar este procedimiento.**

> ⚠️ `ENCRYPTION_KEY` es la clave maestra para descifrar los datos existentes. Asegúrate de guardarla en un gestor de contraseñas en cuanto la crees. Los Secrets de Cloudflare no se pueden consultar después de guardarlos. Las actualizaciones normales no requieren volver a introducirlos, pero si eliminas esta clave sin conservar su valor original, no se podrán recuperar los datos cifrados existentes.

> ⚠️ **Volver a una versión anterior a 1.8.0**: desde la versión 1.8.0, los incrementos de los contadores HOTP se almacenan por separado de los datos principales. Antes de volver a una versión anterior, llama una vez al endpoint de compactación para reincorporar los contadores; de lo contrario, los contadores HOTP volverán a los valores que tenían en el momento de la actualización. Consulta los [pasos para volver a una versión anterior](docs/DEPLOYMENT.md#回滚到-180-之前的版本) (en chino). Los despliegues que solo utilizan TOTP no se ven afectados.

#### Comprobar el resultado de la combinación

El flujo de trabajo `Sync Upstream` está diseñado para completar siempre las actualizaciones en **el mismo repositorio y el mismo Worker**. Ahora combina automáticamente `wrangler.toml` y muestra en el resumen las diferencias respecto al repositorio de origen, para que puedas comprobar qué valores proceden de tu configuración local de despliegue:

1. Revisa las diferencias de `wrangler.toml` en el resumen de la ejecución de GitHub Actions.
2. Abre `wrangler.toml` en tu repositorio.
3. Comprueba que el nombre del Worker, las vinculaciones KV, las rutas y los ajustes de despliegue existentes sigan siendo correctos.
4. Si mantienes configuraciones muy específicas en `wrangler.toml`, crea los commits adicionales que sean necesarios.

> Si Cloudflare no inicia automáticamente un nuevo despliegue, ve a la página **Deployments** y vuelve a desplegar el último commit de tu repositorio actual. No elimines la instalación para reinstalarla.

## 📖 Guía de uso

### Añadir claves

Haz clic en el botón flotante **➕** de la esquina inferior derecha:

- **Escanear código QR** — Escanea códigos QR de 2FA con la cámara y rellena los campos automáticamente.
- **Seleccionar imagen** — Sube una captura de pantalla de un código QR para reconocerlo automáticamente.
- **Pegar captura de pantalla** — Usa Ctrl+V para pegar capturas de códigos QR desde el portapapeles; resulta práctico en equipos sin cámara.
- **Arrastrar y soltar imagen** — Arrastra imágenes de códigos QR directamente al cuadro de diálogo para reconocerlas automáticamente.
- **Añadir manualmente** — Introduce el nombre del servicio y la clave secreta Base32; despliega los ajustes avanzados para modificar los dígitos, el período o el algoritmo.

### Uso diario

- **Copiar código**: haz clic directamente en los dígitos del código.
- **Gestionar claves**: haz clic en **⋯** en la esquina superior derecha de una tarjeta → Ver código QR / Copiar URI / Copiar enlace de la página / Editar / Eliminar.
- **Buscar**: busca en tiempo real por nombre del servicio o de la cuenta en la barra de búsqueda superior.
- **Agrupación inteligente**: agrupa automáticamente servicios relacionados y varias cuentas, con la opción de volver a una lista sin agrupar.
- **Ordenar**: ordena por fecha de incorporación o por nombre.
- **Tema**: botón de acción flotante → **Ajustes → Preferencias → Modo de tema**, y elige claro, oscuro o según el sistema.

### Importación masiva

Haz clic en el botón flotante → **📥 Importación masiva**. Permite importar archivos o pegar texto.

**Formatos compatibles:**

| Origen                 | Formato                                         |
| ---------------------- | ----------------------------------------------- |
| Universal              | Texto de URI `otpauth://` (TXT), CSV, HTML      |
| Google Authenticator   | Código QR de migración (`otpauth-migration://`) |
| Aegis                  | Archivo de exportación JSON                     |
| 2FAS                   | Archivo de exportación `.2fas`                  |
| Bitwarden              | Exportación JSON o CSV de Authenticator         |
| LastPass Authenticator | Archivo de exportación JSON                     |
| andOTP                 | Archivo de exportación JSON                     |
| Ente Auth              | Archivo de exportación                          |

### Exportación masiva

Haz clic en el botón flotante → **📤 Exportación masiva**. Admite los formatos TXT, JSON, CSV y HTML, además de generar **códigos QR de migración de Google Authenticator**, que se pueden escanear para importar directamente.
Las exportaciones estándar TXT / JSON / CSV / HTML dan prioridad al formato unificado del servidor cuando hay conexión y recurren automáticamente a una exportación local compatible cuando no hay conexión o el cuerpo de la solicitud es demasiado grande.

### Copia de seguridad y restauración

El sistema crea copias automáticamente al cambiar los datos y durante una comprobación diaria programada. Conserva las últimas 100 copias; esta cantidad se puede modificar en los ajustes.
Los nuevos archivos de copia de seguridad siguen **Ajustes → Formato de exportación predeterminado**. Las copias automáticas remotas utilizan la misma extensión (`txt`, `json`, `csv` o `html`).

Haz clic en el botón flotante → **🔄 Restaurar configuración** para ver la lista de copias, previsualizar su contenido, restaurarlas o exportarlas. También puedes subir un archivo `backup_*.(txt|json|csv|html)` descargado de WebDAV/S3/OneDrive/Google Drive para previsualizarlo y restaurarlo.

#### Copia de seguridad remota

Permite sincronizar las copias con almacenamiento remoto y enviarlas automáticamente cuando cambian los datos. Se pueden configurar varios destinos de copia de seguridad:

- **WebDAV** — Admite servicios de almacenamiento en la nube o servicios autoalojados con el protocolo WebDAV estándar. ⚠️ No admite servicios que pasan por un proxy de Cloudflare, como Nutstore/jianguoyun, ya que provocan errores de bucle 520.
- **Almacenamiento compatible con S3** — Admite AWS S3, Cloudflare R2, MinIO, Alibaba Cloud OSS y otros servicios compatibles con S3.
- **OneDrive** — Tras la autorización OAuth de Microsoft, las copias se guardan en una subcarpeta dentro de la carpeta de OneDrive específica de la aplicación.
- **Google Drive** — Tras la autorización OAuth de Google, las copias se guardan en la carpeta de Google Drive configurada.

Añade y gestiona los destinos de copia de seguridad remota en **Ajustes → Ajustes de sincronización**.

Las copias remotas guardan el mismo contenido de copia de seguridad que genera la aplicación. Si `ENCRYPTION_KEY` estaba configurada al crear la copia, el archivo remoto también estará cifrado. Para restaurarlo es necesario conservar la misma `ENCRYPTION_KEY` en el Worker.

Pasos detallados: [Configuración del almacenamiento en la nube](docs/CLOUD_DRIVE_SETUP.md) (actualmente en chino).

### Ajustes

Haz clic en el botón flotante → **⚙️ Ajustes**:

- **Cambiar contraseña** — Cambia la contraseña de administrador.
- **Modo de tema** — Elige claro, oscuro o según el sistema.
- **Animación de transición de códigos** — Desactiva las animaciones o elige un efecto de flujo, giro o foco.
- **Duración de la sesión** — Personaliza el tiempo de caducidad del JWT.
- **Formato de exportación predeterminado** — Controla la opción de exportación predeterminada y la extensión de las nuevas copias de seguridad y de las copias automáticas remotas.
- **Número de copias conservadas** — Ajusta cuántas copias automáticas se conservan.
- **Copia de seguridad remota** — Configura los destinos WebDAV/S3/OneDrive/Google Drive.
- **Cerrar sesión** — Borra con un clic la cookie de sesión actual y la caché local; sigue funcionando localmente si el servidor no está disponible.

### Instalar como aplicación móvil (PWA)

- **iOS**: abre la aplicación en Safari → botón Compartir → Añadir a pantalla de inicio.
- **Android**: abre la aplicación en Chrome → menú (⋮) → Añadir a pantalla de inicio.

Una vez instalada, úsala como una aplicación nativa, a pantalla completa y con acceso sin conexión.

### Rellenar TOTP en Chrome / Edge / Firefox

Haz clic en la extensión para seleccionar una cuenta o pulsa `Ctrl+Shift+U` para rellenar el TOTP actual de una cuenta vinculada previamente. Con el permiso correspondiente para cada página de verificación, la extensión puede detectar y rellenar los campos de verificación automáticamente. Si hay varias coincidencias, muestra un selector de cuentas. Admite un único campo o 6/8 campos separados para los dígitos y no envía el formulario.

Después de iniciar sesión en la instancia de 2FA desde el mismo perfil del navegador y conceder acceso a la instancia, puedes cerrar su pestaña. De forma predeterminada, la extensión lee las claves secretas a través de la sesión válida y calcula los códigos en memoria en segundo plano para cada tarea. Vuelve a iniciar sesión cuando caduque la sesión. Al activar expresamente el uso sin conexión, se guarda una caché local independiente de claves secretas, de modo que los códigos sigan disponibles sin conexión a la red ni una pestaña de la instancia abierta. La caché no tiene cifrado adicional mediante contraseña. El código autorizado de la extensión puede leer la lista completa de claves, pero las claves secretas nunca se envían a la ventana emergente ni al sitio de destino. Se admiten campos en Shadow DOM abierto e iframes del mismo origen. No se admiten HOTP, iframes de distinto origen, Shadow DOM cerrado ni navegación privada.

Consulta la [guía de instalación y uso](docs/BROWSER_EXTENSION.md), el [aviso de privacidad de Chrome / Edge](extension/PRIVACY.md) y el [aviso de privacidad de Firefox](extension/PRIVACY_FIREFOX.md) (actualmente en chino).

## 🔒 Seguridad

- **Contraseña**: hash con sal PBKDF2-SHA256 (100.000 iteraciones); el JWT se guarda en cookies HttpOnly + Secure + SameSite=Strict.
- **Cifrado de datos**: con `ENCRYPTION_KEY` configurada, todas las claves secretas, las copias de seguridad y las credenciales de WebDAV/S3/OneDrive/Google Drive se cifran con AES-GCM de 256 bits. Asegúrate de guardar la clave original: si se pierde, los datos cifrados no se pueden descifrar.
- **Transporte**: HTTPS en todas las comunicaciones, TLS 1.2+.
- **Privacidad**: los OTP se generan en el cliente, no se recopilan datos de uso y todo el código es abierto.
- **Duración de la sesión**: 30 días de forma predeterminada, configurable en los ajustes; se renueva automáticamente durante el uso activo cuando quedan menos de 7 días.

## 🔗 API OTP pública

Genera códigos de verificación directamente mediante una URL, sin iniciar sesión:

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

Parámetros: `type` (totp/hotp), `digits` (6/8), `period` (30/60/120), `algorithm` (sha1/sha256/sha512), `counter` (para HOTP)

Las páginas TOTP muestran el código actual y el siguiente, ambos disponibles para copiar, y se actualizan en la misma página al finalizar el período. Las páginas HOTP utilizan el contador indicado en el enlace; copiar el código no lo incrementa.

## 📚 Más documentación

| Documento                                                                | Descripción                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [Guía de despliegue](docs/DEPLOYMENT.md)                                 | Despliegue manual, configuración KV, Secrets                      |
| [Configuración del almacenamiento en la nube](docs/CLOUD_DRIVE_SETUP.md) | Configuración de OneDrive / Google Drive (en chino)               |
| [Referencia de la API](docs/API_REFERENCE.md)                            | Documentación completa de los endpoints de la API                 |
| [Arquitectura](docs/ARCHITECTURE.md)                                     | Arquitectura del sistema y diseño técnico                         |
| [Guía de desarrollo](docs/DEVELOPMENT.md)                                | Desarrollo local, pruebas, estilo de código                       |
| [Guía de PWA](docs/PWA_GUIDE.md)                                         | Instalación de la PWA y funciones sin conexión                    |
| [Extensión del navegador](docs/BROWSER_EXTENSION.md)                     | Instalación, uso y permisos de Chrome / Edge / Firefox (en chino) |

## 🤝 Contribuir

Puedes enviar [Issues](https://github.com/wuzf/2fa/issues) y [Pull Requests](https://github.com/wuzf/2fa/pulls). Para conocer los detalles de desarrollo, consulta la [guía de desarrollo](docs/DEVELOPMENT.md).

## 📄 Licencia

[Licencia MIT](LICENSE)

## 🌟 Historial de estrellas

<p align="center">
  <a href="https://github.com/wuzf/2fa/tree/star-history">
    <img alt="Gráfico de la evolución de las estrellas de GitHub" src="https://raw.githubusercontent.com/wuzf/2fa/refs/heads/star-history/star-history.svg" />
  </a>
</p>

---

<div align="center">

**Si este proyecto te resulta útil, dale una ⭐**

Hecho con ❤️ por [wuzf](https://github.com/wuzf)

</div>
