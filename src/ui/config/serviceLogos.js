/**
 * Service Logos 配置（纯数据文件）
 *
 * 这是一个纯数据配置文件，只包含服务名称到域名的映射。
 * 逻辑处理（URL生成、匹配算法）由客户端代码实现（src/ui/scripts/core.js）。
 *
 * 数据格式：服务名 → 域名
 * 例如：'google' → 'google.com'
 *
 * 客户端会自动拼接 /api/favicon/ 前缀生成完整的图标 URL
 */

export const SERVICE_LOGOS = {
	// 科技巨头
	google: 'google.com',
	microsoft: 'microsoft.com',
	apple: 'apple.com',
	amazon: 'amazon.com',
	meta: 'meta.com',
	facebook: 'facebook.com',

	// 社交媒体
	twitter: 'twitter.com',
	x: 'x.com',
	instagram: 'instagram.com',
	linkedin: 'linkedin.com',
	reddit: 'reddit.com',
	snapchat: 'snapchat.com',
	pinterest: 'pinterest.com',
	tiktok: 'tiktok.com',
	discord: 'discord.com',
	mastodon: 'joinmastodon.org',
	truthsocial: 'truthsocial.com',
	'truth social': 'truthsocial.com',

	// 通讯工具
	slack: 'slack.com',
	telegram: 'telegram.org',
	whatsapp: 'whatsapp.com',
	signal: 'signal.org',
	zoom: 'zoom.us',

	// 开发平台
	github: 'github.com',
	gitee: 'gitee.com',
	gitlab: 'gitlab.com',
	bitbucket: 'bitbucket.org',

	// 云服务商
	aws: 'aws.amazon.com',
	azure: 'azure.microsoft.com',
	gcp: 'cloud.google.com',
	cloudflare: 'cloudflare.com',
	cloudcone: 'cloudcone.com',
	digitalocean: 'digitalocean.com',
	linode: 'linode.com',
	vultr: 'vultr.com',
	heroku: 'heroku.com',
	vercel: 'vercel.com',
	netlify: 'netlify.com',
	render: 'render.com',
	railway: 'railway.app',
	'fly.io': 'fly.io',
	oracle: 'oracle.com',
	aliyun: 'alibabacloud.com',
	'tencent cloud': 'cloud.tencent.com',
	'huawei cloud': 'huaweicloud.com',

	// 开发工具
	docker: 'docker.com',
	kubernetes: 'kubernetes.io',
	jenkins: 'jenkins.io',
	travis: 'travis-ci.com',
	circleci: 'circleci.com',
	firebase: 'firebase.google.com',
	supabase: 'supabase.com',
	planetscale: 'planetscale.com',

	// 域名注册商
	godaddy: 'godaddy.com',
	namecheap: 'namecheap.com',
	porkbun: 'porkbun.com',
	'name.com': 'name.com',
	dynadot: 'dynadot.com',

	// 生产力工具
	notion: 'notion.so',
	trello: 'trello.com',
	asana: 'asana.com',
	jira: 'atlassian.com',
	confluence: 'atlassian.com',
	monday: 'monday.com',
	airtable: 'airtable.com',

	// 设计工具
	figma: 'figma.com',
	canva: 'canva.com',
	adobe: 'adobe.com',

	// 云存储
	dropbox: 'dropbox.com',
	onedrive: 'onedrive.live.com',
	'google drive': 'drive.google.com',
	box: 'box.com',

	// 密码管理器
	'1password': '1password.com',
	bitwarden: 'bitwarden.com',
	lastpass: 'lastpass.com',
	dashlane: 'dashlane.com',

	// AI平台
	openai: 'openai.com',
	chatgpt: 'openai.com',
	anthropic: 'anthropic.com',
	claude: 'anthropic.com',
	gemini: 'gemini.com',
	huggingface: 'huggingface.co',
	replicate: 'replicate.com',
	cohere: 'cohere.com',
	'stability ai': 'stability.ai',
	midjourney: 'midjourney.com',
	dalle: 'openai.com',
	bard: 'bard.google.com',
	perplexity: 'perplexity.ai',
	'character.ai': 'character.ai',
	poe: 'poe.com',

	// 支付平台
	paypal: 'paypal.com',
	stripe: 'stripe.com',
	square: 'squareup.com',
	wise: 'wise.com',

	// 加密货币交易所
	binance: 'binance.com',
	coinbase: 'coinbase.com',
	kraken: 'kraken.com',
	bitfinex: 'bitfinex.com',
	okx: 'okx.com',
	huobi: 'huobi.com',
	kucoin: 'kucoin.com',
	bybit: 'bybit.com',

	// 游戏平台
	steam: 'steampowered.com',
	'epic games': 'epicgames.com',
	epicgames: 'epicgames.com',
	'battle.net': 'blizzard.com',
	blizzard: 'blizzard.com',
	ubisoft: 'ubisoft.com',
	ea: 'ea.com',
	origin: 'origin.com',
	'riot games': 'riotgames.com',
	activision: 'activision.com',
	playstation: 'playstation.com',
	xbox: 'xbox.com',
	nintendo: 'nintendo.com',

	// 流媒体
	netflix: 'netflix.com',
	spotify: 'spotify.com',
	youtube: 'youtube.com',
	twitch: 'twitch.tv',
	hulu: 'hulu.com',
	'disney+': 'disneyplus.com',
	hbo: 'hbo.com',
	'prime video': 'primevideo.com',

	// 电商平台
	shopify: 'shopify.com',
	ebay: 'ebay.com',
	etsy: 'etsy.com',
	walmart: 'walmart.com',
	target: 'target.com',
	alibaba: 'alibaba.com',
	taobao: 'taobao.com',
	jd: 'jd.com',

	// 出行服务
	uber: 'uber.com',
	lyft: 'lyft.com',
	airbnb: 'airbnb.com',

	// 金融服务
	robinhood: 'robinhood.com',
	webull: 'webull.com',
	'charles schwab': 'schwab.com',

	// VPN服务
	nordvpn: 'nordvpn.com',
	expressvpn: 'expressvpn.com',
	protonvpn: 'protonvpn.com',

	// 邮箱服务
	gmail: 'gmail.com',
	outlook: 'outlook.com',
	protonmail: 'proton.me',
	proton: 'proton.me',
	yahoo: 'yahoo.com',

	// 内容平台
	medium: 'medium.com',
	substack: 'substack.com',
	patreon: 'patreon.com',
	wordpress: 'wordpress.com',
	'greasy fork': 'greasyfork.org',
	greasyfork: 'greasyfork.org',

	// 其他工具
	duckduckgo: 'duckduckgo.com',
	mozilla: 'mozilla.org',
	brave: 'brave.com',
	evernote: 'evernote.com',
	bitly: 'bitly.com',
	salesforce: 'salesforce.com',
	hubspot: 'hubspot.com',

	// 中国服务
	tencent: 'tencent.com',
	wechat: 'wechat.com',
	alipay: 'alipay.com',
	baidu: 'baidu.com',
	douyin: 'douyin.com',
	bilibili: 'bilibili.com',
	xiaohongshu: 'xiaohongshu.com',
	dingding: 'dingtalk.com',
	feishu: 'feishu.cn',
	lark: 'larksuite.com',

	// 更多社交媒体和通讯
	threads: 'threads.net',
	bluesky: 'bsky.app',
	tumblr: 'tumblr.com',
	vk: 'vk.com',
	line: 'line.me',
	viber: 'viber.com',
	'wechat work': 'work.weixin.qq.com',
	skype: 'skype.com',
	messenger: 'messenger.com',
	teams: 'teams.microsoft.com',
	'google meet': 'meet.google.com',
	webex: 'webex.com',

	// 更多云服务商
	ovh: 'ovh.com',
	hetzner: 'hetzner.com',
	scaleway: 'scaleway.com',
	contabo: 'contabo.com',
	ionos: 'ionos.com',
	'ibm cloud': 'cloud.ibm.com',
	upcloud: 'upcloud.com',
	kamatera: 'kamatera.com',
	hostinger: 'hostinger.com',
	dreamhost: 'dreamhost.com',
	bluehost: 'bluehost.com',
	siteground: 'siteground.com',
	a2hosting: 'a2hosting.com',
	hostgator: 'hostgator.com',
	inmotion: 'inmotionhosting.com',

	// 更多开发工具和服务
	npm: 'npmjs.com',
	yarn: 'yarnpkg.com',
	pnpm: 'pnpm.io',
	pip: 'pypi.org',
	pypi: 'pypi.org',
	composer: 'getcomposer.org',
	maven: 'maven.apache.org',
	gradle: 'gradle.org',
	nuget: 'nuget.org',
	cargo: 'crates.io',
	rubygems: 'rubygems.org',
	packagist: 'packagist.org',
	'go.dev': 'go.dev',
	rust: 'rust-lang.org',
	python: 'python.org',
	nodejs: 'nodejs.org',
	php: 'php.net',
	ruby: 'ruby-lang.org',
	java: 'java.com',

	// 监控和分析工具
	datadog: 'datadoghq.com',
	newrelic: 'newrelic.com',
	sentry: 'sentry.io',
	grafana: 'grafana.com',
	prometheus: 'prometheus.io',
	elastic: 'elastic.co',
	splunk: 'splunk.com',
	logstash: 'elastic.co',
	kibana: 'elastic.co',
	pagerduty: 'pagerduty.com',
	opsgenie: 'opsgenie.com',
	pingdom: 'pingdom.com',
	statuspage: 'statuspage.io',
	uptimerobot: 'uptimerobot.com',

	// 更多域名和 DNS 服务
	cloudns: 'cloudns.net',
	route53: 'aws.amazon.com',
	hover: 'hover.com',
	gandi: 'gandi.net',
	enom: 'enom.com',
	'domain.com': 'domain.com',
	'google domains': 'domains.google',
	spaceship: 'spaceship.com',

	// 更多加密货币和区块链
	metamask: 'metamask.io',
	'trust wallet': 'trustwallet.com',
	ledger: 'ledger.com',
	trezor: 'trezor.io',
	exodus: 'exodus.com',
	'crypto.com': 'crypto.com',
	'gate.io': 'gate.io',
	bitget: 'bitget.com',
	mexc: 'mexc.com',
	bingx: 'bingx.com',
	phemex: 'phemex.com',
	bitmart: 'bitmart.com',
	poloniex: 'poloniex.com',
	bitstamp: 'bitstamp.net',

	// 更多支付平台
	venmo: 'venmo.com',
	cashapp: 'cash.app',
	zelle: 'zellepay.com',
	revolut: 'revolut.com',
	n26: 'n26.com',
	monzo: 'monzo.com',
	chime: 'chime.com',
	payoneer: 'payoneer.com',
	skrill: 'skrill.com',
	neteller: 'neteller.com',
	adyen: 'adyen.com',
	braintree: 'braintreepayments.com',
	paddle: 'paddle.com',
	lemonsqueezy: 'lemonsqueezy.com',
	gumroad: 'gumroad.com',

	// 更多电商和市场
	mercari: 'mercari.com',
	poshmark: 'poshmark.com',
	depop: 'depop.com',
	vinted: 'vinted.com',
	rakuten: 'rakuten.com',
	wish: 'wish.com',
	aliexpress: 'aliexpress.com',
	tmall: 'tmall.com',
	pinduoduo: 'pinduoduo.com',
	lazada: 'lazada.com',
	shopee: 'shopee.com',
	tokopedia: 'tokopedia.com',
	carousell: 'carousell.com',

	// 教育平台
	coursera: 'coursera.org',
	udemy: 'udemy.com',
	edx: 'edx.org',
	'khan academy': 'khanacademy.org',
	skillshare: 'skillshare.com',
	pluralsight: 'pluralsight.com',
	'linkedin learning': 'linkedin.com',
	udacity: 'udacity.com',
	codecademy: 'codecademy.com',
	freecodecamp: 'freecodecamp.org',
	leetcode: 'leetcode.com',
	hackerrank: 'hackerrank.com',
	codewars: 'codewars.com',
	topcoder: 'topcoder.com',
	kaggle: 'kaggle.com',

	// 更多流媒体和娱乐
	'apple music': 'music.apple.com',
	'apple tv': 'tv.apple.com',
	tidal: 'tidal.com',
	deezer: 'deezer.com',
	soundcloud: 'soundcloud.com',
	bandcamp: 'bandcamp.com',
	pandora: 'pandora.com',
	'youtube music': 'music.youtube.com',
	vimeo: 'vimeo.com',
	dailymotion: 'dailymotion.com',
	crunchyroll: 'crunchyroll.com',
	funimation: 'funimation.com',
	vrv: 'vrv.co',
	'paramount+': 'paramountplus.com',
	peacock: 'peacocktv.com',
	max: 'max.com',
	showtime: 'showtime.com',
	starz: 'starz.com',

	// 新闻和媒体
	nytimes: 'nytimes.com',
	wsj: 'wsj.com',
	'washington post': 'washingtonpost.com',
	guardian: 'theguardian.com',
	bbc: 'bbc.com',
	cnn: 'cnn.com',
	reuters: 'reuters.com',
	bloomberg: 'bloomberg.com',
	forbes: 'forbes.com',
	techcrunch: 'techcrunch.com',
	verge: 'theverge.com',
	wired: 'wired.com',
	'ars technica': 'arstechnica.com',
	'hacker news': 'news.ycombinator.com',

	// 论坛和社区
	'stack overflow': 'stackoverflow.com',
	stackoverflow: 'stackoverflow.com',
	'stack exchange': 'stackexchange.com',
	quora: 'quora.com',
	'4chan': '4chan.org',
	'8kun': '8kun.top',
	discourse: 'discourse.org',
	phpbb: 'phpbb.com',

	// 更多中国服务
	zhihu: 'zhihu.com',
	weibo: 'weibo.com',
	csdn: 'csdn.net',
	juejin: 'juejin.cn',
	segmentfault: 'segmentfault.com',
	oschina: 'oschina.net',
	cnblogs: 'cnblogs.com',
	'51cto': '51cto.com',
	infoq: 'infoq.cn',
	ithome: 'ithome.com',
	163: '163.com',
	netease: '163.com',
	qq: 'qq.com',
	360: '360.cn',
	sohu: 'sohu.com',
	sina: 'sina.com.cn',
	meituan: 'meituan.com',
	eleme: 'ele.me',
	didi: 'didiglobal.com',
	bytedance: 'bytedance.com',
	kuaishou: 'kuaishou.com',
	iqiyi: 'iqiyi.com',
	youku: 'youku.com',
	toutiao: 'toutiao.com',

	// 日本服务
	'line pay': 'pay.line.me',
	paypay: 'paypay.ne.jp',
	mercoin: 'mercoin.com',
	'yahoo japan': 'yahoo.co.jp',
	dmm: 'dmm.com',
	niconico: 'nicovideo.jp',
	pixiv: 'pixiv.net',

	// 韩国服务
	naver: 'naver.com',
	kakao: 'kakao.com',
	kakaotalk: 'kakao.com',
	coupang: 'coupang.com',
	bithumb: 'bithumb.com',
	upbit: 'upbit.com',

	// 俄罗斯服务
	vkontakte: 'vk.com',
	'telegram messenger': 'telegram.org',
	'mail.ru': 'mail.ru',
	'yandex mail': 'yandex.ru',
	rambler: 'rambler.ru',

	// 印度服务
	paytm: 'paytm.com',
	phonepe: 'phonepe.com',
	gpay: 'pay.google.com',
	flipkart: 'flipkart.com',
	'amazon india': 'amazon.in',
	swiggy: 'swiggy.com',
	zomato: 'zomato.com',
	ola: 'olacabs.com',

	// 东南亚服务
	grab: 'grab.com',
	gojek: 'gojek.com',
	bukalapak: 'bukalapak.com',

	// 更多VPN和安全服务
	surfshark: 'surfshark.com',
	cyberghost: 'cyberghostvpn.com',
	privateinternetaccess: 'privateinternetaccess.com',
	pia: 'privateinternetaccess.com',
	mullvad: 'mullvad.net',
	ivpn: 'ivpn.net',
	windscribe: 'windscribe.com',
	tunnelbear: 'tunnelbear.com',
	'hotspot shield': 'hotspotshield.com',

	// 更多密码管理器
	keepass: 'keepass.info',
	keepassxc: 'keepassxc.org',
	nordpass: 'nordpass.com',
	roboform: 'roboform.com',
	enpass: 'enpass.io',
	keeper: 'keepersecurity.com',
	'zoho vault': 'zoho.com',

	// 更多设计和创意工具
	sketch: 'sketch.com',
	invision: 'invisionapp.com',
	miro: 'miro.com',
	lucidchart: 'lucidchart.com',
	whimsical: 'whimsical.com',
	excalidraw: 'excalidraw.com',
	'draw.io': 'draw.io',
	pixlr: 'pixlr.com',
	photopea: 'photopea.com',
	'remove.bg': 'remove.bg',

	// 更多邮件服务
	fastmail: 'fastmail.com',
	tutanota: 'tutanota.com',
	'mailbox.org': 'mailbox.org',
	'zoho mail': 'zoho.com',
	'yandex.mail': 'yandex.com',
	aol: 'aol.com',
	icloud: 'icloud.com',
	hey: 'hey.com',

	// 文档和协作工具
	'google docs': 'docs.google.com',
	'google sheets': 'sheets.google.com',
	'google slides': 'slides.google.com',
	'office 365': 'office.com',
	coda: 'coda.io',
	clickup: 'clickup.com',
	basecamp: 'basecamp.com',
	wrike: 'wrike.com',
	smartsheet: 'smartsheet.com',
	teamwork: 'teamwork.com',

	// 更多游戏相关
	gog: 'gog.com',
	'itch.io': 'itch.io',
	'humble bundle': 'humblebundle.com',
	rockstar: 'rockstargames.com',
	'2k games': '2k.com',
	bethesda: 'bethesda.net',
	'square enix': 'square-enix.com',
	paradox: 'paradoxplaza.com',

	// 特殊服务
	redotpay: 'redotpay.com',
	v2ex: 'v2ex.com',
	yandex: 'yandex.com',
	deno: 'deno.com',
	bun: 'bun.sh',

	// 社区论坛
	'linux.do': 'linux.do',
};
