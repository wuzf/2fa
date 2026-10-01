# 🔐 2FA

Um sistema de gerenciamento de chaves de autenticação de dois fatores desenvolvido com Cloudflare Workers. Implantação gratuita, aceleração global e suporte a uso offline como PWA.

![Versão](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![Licença](https://img.shields.io/badge/license-MIT-green)
![Plataforma](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](../../README.md) · [繁體中文](../zh-TW/README.md) · [English](../en/README.md) · [日本語](../ja/README.md) · [한국어](../ko/README.md) ·
[Deutsch](../de/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · **[Português (Brasil)](README.md)** · [Italiano](../it/README.md) ·
[Русский](../ru/README.md) · [Türkçe](../tr/README.md) · [Bahasa Indonesia](../id/README.md) · [Tiếng Việt](../vi/README.md) · [ไทย](../th/README.md)

<!-- README_LANGUAGE_NAV_END -->

**Principais recursos:** Geração automática de códigos TOTP/HOTP · Adição de chaves por leitura de QR code, reconhecimento de imagem, captura de tela colada ou imagem arrastada · Armazenamento criptografado com AES-GCM de 256 bits · Importação em lote do Google Authenticator, Aegis, 2FAS, Bitwarden e outros · Exportação em vários formatos (TXT/JSON/CSV/HTML/QR codes de migração do Google) · Backup e restauração automáticos · Sincronização de backups remotos com WebDAV/S3/OneDrive/Google Drive · Configurações de segurança, sincronização e preferências · 15 idiomas em todo o projeto (detecção automática ou seleção manual) · Temas claro, escuro e do sistema · Interface responsiva inspirada no Fluent 2

O aplicativo web, as extensões de navegador, a configuração inicial, as páginas públicas de OTP, as mensagens da API e os documentos de backup oferecem suporte a chinês simplificado, chinês tradicional, inglês, japonês, coreano, alemão, francês, espanhol, português (Brasil), italiano, russo, turco, indonésio, vietnamita e tailandês. As interfaces seguem o idioma do navegador ou uma seleção manual, usando inglês quando o idioma do navegador não é compatível. Backups CSV/HTML podem ser importados independentemente do idioma da interface.

## 🧩 Extensão de navegador

Instale o 2FA Verification Assistant: **[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**.

Abra o link de instalação no navegador correspondente. Após instalar, informe a URL da sua instância auto-hospedada do 2FA nas configurações da extensão e entre nessa instância no mesmo navegador para visualizar, copiar e preencher códigos TOTP. O preenchimento automático exige uma permissão para cada site, que você pode conceder na primeira vez que preencher um código nele. A extensão exige uma instância implantada deste projeto, e sua interface oferece suporte aos 15 idiomas listados acima. O Firefox para computador e Android exige a versão 153 ou posterior e abas normais; abas de contêiner no computador e abas privativas em ambas as plataformas não são compatíveis. O Firefox para Android é compatível a partir da versão 1.2.0 da loja de extensões, mas ainda não foi testado em um dispositivo físico. O Firefox para Android não oferece atalhos de teclado para extensões.

[Guia de instalação e uso](../BROWSER_EXTENSION.md) · [Política de privacidade do Chrome / Edge](../../extension/PRIVACY.md) · [Política de privacidade do Firefox](../../extension/PRIVACY_FIREFOX.md) (em chinês)

## 📸 Capturas de tela

|                   Computador                    |                   Tablet                   |                   Celular                   |
| :---------------------------------------------: | :----------------------------------------: | :-----------------------------------------: |
| ![Computador](../images/screenshot-desktop.png) | ![Tablet](../images/screenshot-tablet.png) | ![Celular](../images/screenshot-mobile.png) |

## 🚀 Implantação rápida

### Demonstração ao vivo

Acesse o site de demonstração (senha `2fa-Demo.`): **[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### Implantação com um clique (recomendada)

[![Implantar no Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> A implantação com um clique é recomendada. Todos os usuários devem atualizar a instalação existente pelo workflow **Sync Upstream**. Não atualize excluindo o Worker, excluindo o repositório ou reinstalando.

1. Clique no botão acima, entre com sua conta do GitHub e conceda a autorização
2. Entre na sua conta da Cloudflare, clique em **Deploy** e aguarde a conclusão da implantação (o armazenamento KV é criado automaticamente)
3. Abra a URL do Workers fornecida pela Cloudflare, **defina sua senha de administrador** e comece a usar

> A compilação automática via Git usa diretamente o `wrangler.toml` do repositório. A configuração atual declara explicitamente `SECRETS_KV`, e o Wrangler cria automaticamente o KV necessário na primeira implantação e continua reutilizando o recurso vinculado ao Worker atual nas implantações seguintes.
> Se você configurar manualmente os comandos de compilação Git no painel da Cloudflare, **use `npm run deploy` como comando de implantação, em vez de executar diretamente `npx wrangler deploy`**, para preservar a injeção de versão e manter a consistência com o comando padrão de implantação do repositório.

#### Recomendado: ativar a criptografia de dados

Após a implantação, adicione um Secret chamado `ENCRYPTION_KEY` em **Cloudflare Dashboard → Worker → Settings → Variables**:

```bash
# Gerar a chave de criptografia (escolha uma opção)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY` é a chave mestra para descriptografar os dados existentes. **É recomendável configurá-la**, desde que você salve imediatamente o valor original em um gerenciador de senhas, backup offline ou outro local seguro.
>
> Se você não puder garantir que o valor original será salvo, **é melhor não configurar a chave do que configurá-la e perdê-la**:
>
> - Depois de configurada: a lista de segredos, os backups automáticos e as credenciais de WebDAV/S3/OneDrive/Google Drive são todos criptografados
> - Em caso de perda: a Cloudflare não mostra novamente o valor original; os dados e backups criptografados existentes não poderão ser lidos nem restaurados
> - Comportamento atual: quando detecta dados criptografados, mas `ENCRYPTION_KEY` está ausente, o sistema bloqueia leituras e gravações para impedir a sobrescrita acidental dos dados antigos

#### Atualizações de versão

A implantação com um clique cria um repositório independente (não um Fork). As atualizações são realizadas na instalação existente pelo workflow **Sync Upstream**.

> ⚠️ **Sempre faça backup dos dados antes de atualizar**: antes de atualizar a versão, exporte seus dados atuais por **Exportação em lote** ou **Restaurar configuração → Exportar backup**, para evitar perda de dados em caso de falha.

1. Abra o repositório 2fa criado na sua conta do GitHub durante a implantação com um clique
2. Acesse **Actions** → **Sync Upstream**
3. Clique em **Run workflow**, mantenha a branch de origem no padrão `main` e inicie uma nova execução
4. Aguarde a conclusão da sincronização e da implantação automática da Cloudflare e, depois, atualize o aplicativo

O workflow preserva automaticamente o nome do Worker, os vínculos KV e as configurações comuns de implantação do seu repositório, e reimplanta **o mesmo Worker**. Os arquivos de workflow existentes no repositório também são preservados.

> **Se Sync Upstream não estiver disponível**: a implantação com um clique não copia `.github/workflows` ao importar o repositório, então um repositório novo não inclui workflows e precisa desta entrada antes da primeira atualização. Substitua `OWNER/REPO` no link abaixo pelo seu repositório (por exemplo, `alice/2fa`) e abra-o no navegador. O GitHub preenche o nome e o conteúdo do arquivo; clique em **Commit changes**:
>
> ```text
> https://github.com/OWNER/REPO/new/main?filename=.github/workflows/sync-upstream.yml&value=%23%20Save%20as%20.github%2Fworkflows%2Fsync-upstream.yml%20in%20your%20repository.%0A%23%20The%20upgrade%20steps%20come%20from%20wuzf%2F2fa%2C%20so%20this%20file%20never%20needs%20updating.%0Aname%3A%20Sync%20Upstream%0A%0Aon%3A%0A%20%20workflow_dispatch%3A%0A%20%20%20%20inputs%3A%0A%20%20%20%20%20%20upstream_ref%3A%0A%20%20%20%20%20%20%20%20description%3A%20Upstream%20branch%20or%20tag%20to%20sync%0A%20%20%20%20%20%20%20%20required%3A%20false%0A%20%20%20%20%20%20%20%20default%3A%20main%0A%0Apermissions%3A%0A%20%20contents%3A%20write%0A%0Ajobs%3A%0A%20%20sync%3A%0A%20%20%20%20uses%3A%20wuzf%2F2fa%2F.github%2Fworkflows%2Fsync-upstream.yml%40main%0A%20%20%20%20with%3A%0A%20%20%20%20%20%20upstream_ref%3A%20%24%7B%7B%20inputs.upstream_ref%20%7D%7D%0A
> ```
>
> Você também pode criar `.github/workflows/sync-upstream.yml` manualmente e copiar o conteúdo de <https://github.com/wuzf/2fa/blob/main/.github/sync-upstream-entry.yml>. A entrada tem poucas linhas; as etapas de atualização vêm do repositório original, então ela nunca precisa ser atualizada. Em seguida, siga as etapas de atualização acima.

> **Se uma atualização anterior falhou com `without workflows permission`**: depois que a correção for publicada na branch `main` de origem, os workflows **Sync Upstream** existentes que tenham a etapa de mesclagem automática da configuração de implantação poderão atualizar usando as etapas acima, sem editar YAML nem configurar um PAT. Inicie uma nova execução com `main`; as tags de versões antigas não incluem a correção. Para outros casos, consulte a [solução de problemas de atualização](../DEPLOYMENT.md#升级故障排查) (em chinês).

Esse método não afeta os Workers, vínculos KV ou Secrets existentes. **Se você já configurou `ENCRYPTION_KEY`, não precisa informá-la novamente durante as atualizações; se ainda não configurou, também pode usar esse processo de atualização.**

> ⚠️ `ENCRYPTION_KEY` é a chave mestra para descriptografar os dados existentes. Salve-a em um gerenciador de senhas ao criá-la. Os Secrets da Cloudflare não podem ser visualizados após serem salvos; atualizações normais não exigem que a chave seja informada novamente, mas, se você a excluir sem guardar o valor original, os dados criptografados existentes não poderão ser recuperados.

> ⚠️ **Reverter para uma versão anterior à 1.8.0**: desde a versão 1.8.0, os incrementos dos contadores HOTP são armazenados separadamente dos dados principais. Antes de reverter, chame o endpoint de compactação uma vez para gravar os contadores de volta; caso contrário, os contadores HOTP voltarão aos valores que tinham no momento da atualização. Consulte as [etapas de reversão](../DEPLOYMENT.md#回滚到-180-之前的版本) (em chinês). Instalações que usam apenas TOTP não são afetadas.

#### Verificar o resultado da mesclagem

O workflow `Sync Upstream` foi projetado para sempre concluir as atualizações **no mesmo repositório e no mesmo Worker**. O workflow agora mescla automaticamente o `wrangler.toml` e mostra, no resumo, as diferenças em relação à origem, para que você possa confirmar quais valores vêm da configuração da sua implantação local:

1. Confira as diferenças do `wrangler.toml` no resumo da execução do GitHub Actions
2. Abra o `wrangler.toml` no seu repositório
3. Confirme que o nome do Worker, os vínculos KV, as rotas e as configurações de implantação existentes continuam corretos
4. Se você mantém configurações muito específicas no `wrangler.toml`, faça commits adicionais conforme necessário

> Se a Cloudflare não iniciar a reimplantação automaticamente, acesse a página **Deployments** e reimplante o commit mais recente do seu repositório atual — não exclua nem reinstale.

## 📖 Guia do usuário

### Adicionar chaves

Clique no botão flutuante **➕** no canto inferior direito:

- **Ler QR code** — Use a câmera para ler QR codes de 2FA e preencher os dados automaticamente
- **Selecionar imagem** — Envie uma captura de tela de um QR code para reconhecimento automático
- **Colar captura de tela** — Use Ctrl+V para colar capturas de QR code da área de transferência (útil para usuários de computador sem câmera)
- **Arrastar e soltar imagem** — Arraste imagens de QR code diretamente para a caixa de diálogo para reconhecimento automático
- **Adicionar manualmente** — Informe o nome do serviço e o segredo Base32 (expanda as configurações avançadas para ajustar os dígitos, o período e o algoritmo)

### Uso diário

- **Copiar código**: clique diretamente nos dígitos do código
- **Gerenciar chaves**: clique em **⋯** no canto superior direito de um cartão → Ver QR code / Copiar URI / Copiar link da página / Editar / Excluir
- **Pesquisar**: pesquise em tempo real pelo nome do serviço ou da conta na barra de pesquisa superior
- **Agrupamento inteligente**: agrupe automaticamente serviços relacionados e várias contas, com a opção de voltar a uma lista simples
- **Ordenar**: ordene por data de adição ou nome
- **Tema**: botão flutuante → **Configurações → Preferências → Modo do tema** e escolha claro, escuro ou acompanhar o sistema

### Importação em lote

Clique no botão flutuante → **📥 Importação em lote**. É possível importar arquivos ou colar texto.

**Formatos compatíveis:**

| Origem                 | Formato                                      |
| ---------------------- | -------------------------------------------- |
| Universal              | Texto de URI `otpauth://` (TXT), CSV, HTML   |
| Google Authenticator   | QR code de migração (`otpauth-migration://`) |
| Aegis                  | Arquivo de exportação JSON                   |
| 2FAS                   | Arquivo de exportação `.2fas`                |
| Bitwarden              | Exportação JSON ou CSV do Authenticator      |
| LastPass Authenticator | Arquivo de exportação JSON                   |
| andOTP                 | Arquivo de exportação JSON                   |
| Ente Auth              | Arquivo de exportação                        |

### Exportação em lote

Clique no botão flutuante → **📤 Exportação em lote**. São compatíveis os formatos TXT, JSON, CSV e HTML, além da geração de **QR codes de migração do Google Authenticator** (que podem ser lidos para importar diretamente).
As exportações padrão em TXT / JSON / CSV / HTML priorizam o formato unificado do backend quando há conexão e recorrem automaticamente a uma exportação local compatível quando não há conexão ou quando o corpo da requisição é muito grande.

### Backup e restauração

O sistema faz backups automaticamente (acionados por alterações nos dados e por uma verificação diária agendada), mantendo os 100 backups mais recentes (ajustável nas configurações).
Novos arquivos de backup seguem **Configurações → Formato padrão de exportação**. Os backups automáticos remotos usam a mesma extensão (`txt`, `json`, `csv` ou `html`).

Clique no botão flutuante → **🔄 Restaurar configuração** para ver a lista de backups, visualizar o conteúdo, restaurar ou exportar. Você também pode enviar um arquivo `backup_*.(txt|json|csv|html)` baixado do WebDAV/S3/OneDrive/Google Drive para visualizar e restaurar.

#### Backup remoto

É possível sincronizar backups com armazenamento remoto, com envio automático quando os dados mudam e configuração de vários destinos de backup:

- **WebDAV** — Compatível com serviços de armazenamento em nuvem ou serviços auto-hospedados que usam o protocolo WebDAV padrão (⚠️ não é compatível com serviços que passam pelo proxy da Cloudflare, como Nutstore/jianguoyun, que causam erros de loop 520)
- **Armazenamento compatível com S3** — Compatível com AWS S3, Cloudflare R2, MinIO, Alibaba Cloud OSS e outros serviços compatíveis com S3
- **OneDrive** — Após a autorização via Microsoft OAuth, os backups são gravados em uma subpasta dentro da pasta específica do aplicativo no OneDrive
- **Google Drive** — Após a autorização via Google OAuth, os backups são gravados na pasta configurada do Google Drive

Adicione e gerencie destinos de backup remoto em **Configurações → Configurações de sincronização**.

Os backups remotos armazenam o mesmo conteúdo de backup gerado pelo aplicativo. Se `ENCRYPTION_KEY` estava configurada quando o backup foi criado, o arquivo remoto também contém dados criptografados; para restaurá-lo, é necessário manter a mesma `ENCRYPTION_KEY` no Worker.

Etapas detalhadas de configuração: [Configuração de armazenamento em nuvem](../CLOUD_DRIVE_SETUP.md) (atualmente em chinês).

### Configurações

Clique no botão flutuante → **⚙️ Configurações**:

- **Alterar senha** — Altere a senha de administrador
- **Modo do tema** — Escolha claro, escuro ou acompanhar o sistema
- **Animação de transição dos códigos** — Desative as animações ou escolha fluxo, giro ou holofote
- **Validade do login** — Personalize o prazo de expiração do JWT
- **Formato padrão de exportação** — Define o formato padrão de exportação e a extensão usada em novos backups e backups automáticos remotos
- **Quantidade de backups mantidos** — Ajuste a quantidade de backups automáticos preservados
- **Backup remoto** — Configure destinos de backup WebDAV/S3/OneDrive/Google Drive
- **Sair** — Limpe com um clique o cookie da sessão atual e o cache local; a ação continua funcionando localmente quando o servidor está inacessível

### Instalar como aplicativo móvel (PWA)

- **iOS**: abra no Safari → botão Compartilhar → Adicionar à Tela de Início
- **Android**: abra no Chrome → menu (⋮) → Adicionar à tela inicial

Após a instalação, use em tela cheia como um aplicativo nativo, com suporte a acesso offline.

### Preenchimento TOTP no Chrome / Edge / Firefox

Clique na extensão para selecionar uma conta ou pressione `Ctrl+Shift+U` para preencher o TOTP atual de uma conta vinculada anteriormente. Depois que um site é autorizado, a extensão pode detectar e preencher automaticamente os campos de verificação dele; quando há várias correspondências, exibe um seletor de contas. Ela oferece suporte a um campo único ou a 6/8 campos separados por dígito e não envia o formulário.

Depois de entrar na instância do 2FA no mesmo perfil de navegador e conceder acesso à instância, você pode fechar a aba da instância. Por padrão, a extensão lê os segredos usando a sessão válida e calcula os códigos na memória em segundo plano para cada tarefa; entre novamente quando a sessão expirar. Ativar explicitamente o uso offline salva um cache local independente de segredos, para que os códigos continuem disponíveis sem conexão de rede ou sem a aba da instância aberta. O cache não tem criptografia adicional por senha. O código autorizado da extensão pode ler a lista completa de segredos, mas as chaves secretas nunca são enviadas ao popup nem ao site de destino. Há suporte a campos em Shadow DOM aberto e iframes da mesma origem; HOTP, iframes de origem diferente, Shadow DOM fechado e navegação privativa não são compatíveis.

Consulte o [guia de instalação e uso](../BROWSER_EXTENSION.md), o [aviso de privacidade do Chrome / Edge](../../extension/PRIVACY.md) e o [aviso de privacidade do Firefox](../../extension/PRIVACY_FIREFOX.md) (atualmente em chinês).

## 🔒 Segurança

- **Senha**: hash com salt usando PBKDF2-SHA256 (100.000 iterações), JWT armazenado em cookies HttpOnly + Secure + SameSite=Strict
- **Criptografia de dados**: com `ENCRYPTION_KEY` configurada, todos os segredos, backups e credenciais de WebDAV/S3/OneDrive/Google Drive são criptografados com AES-GCM de 256 bits; salve a chave original — os dados criptografados não podem ser descriptografados se ela for perdida
- **Transporte**: HTTPS em toda a comunicação, TLS 1.2+
- **Privacidade**: OTP gerado no cliente, sem coleta de dados de uso, código totalmente aberto
- **Validade do login**: 30 dias por padrão, personalizável nas configurações, renovada automaticamente durante o uso ativo (estendida automaticamente quando restam menos de 7 dias)

## 🔗 API pública de OTP

Gere códigos de verificação diretamente pela URL, sem fazer login:

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

Parâmetros: `type` (totp/hotp), `digits` (6/8), `period` (30/60/120), `algorithm` (sha1/sha256/sha512), `counter` (para HOTP)

As páginas TOTP mostram os códigos atual e seguinte, ambos disponíveis para copiar, e se atualizam no próprio local quando o período termina. As páginas HOTP usam o contador especificado no link; copiar não o incrementa.

## 📚 Mais documentação

| Documento                                                         | Descrição                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Guia de implantação](../DEPLOYMENT.md)                           | Implantação manual, configuração KV, Secrets                        |
| [Configuração de armazenamento em nuvem](../CLOUD_DRIVE_SETUP.md) | Etapas de configuração do OneDrive / Google Drive (em chinês)       |
| [Referência da API](../API_REFERENCE.md)                          | Documentação completa dos endpoints da API                          |
| [Arquitetura](../ARCHITECTURE.md)                                 | Arquitetura do sistema e projeto técnico                            |
| [Guia de desenvolvimento](../DEVELOPMENT.md)                      | Desenvolvimento local, testes e estilo de código                    |
| [Guia de PWA](../PWA_GUIDE.md)                                    | Instalação do PWA e recursos offline                                |
| [Extensão de navegador](../BROWSER_EXTENSION.md)                  | Instalação, uso e permissões no Chrome / Edge / Firefox (em chinês) |

## 🤝 Contribuições

Contribuições por [Issues](https://github.com/wuzf/2fa/issues) e [Pull Requests](https://github.com/wuzf/2fa/pulls) são bem-vindas. Para detalhes sobre desenvolvimento, consulte o [Guia de desenvolvimento](../DEVELOPMENT.md).

## 📄 Licença

[Licença MIT](../../LICENSE)

## 🌟 Histórico de estrelas

<p align="center">
  <a href="https://github.com/wuzf/2fa/tree/star-history">
    <img alt="Gráfico do histórico de estrelas" src="https://raw.githubusercontent.com/wuzf/2fa/refs/heads/star-history/star-history.svg" />
  </a>
</p>

---

<div align="center">

**Se este projeto é útil para você, dê uma ⭐**

Feito com ❤️ por [wuzf](https://github.com/wuzf)

</div>
