// Russian distinguishes counts such as 1/21, 2/22 and 5/25. These templates
// retain the same metadata parameters as the ordinary one/other dictionaries.
export const PLURAL_OVERRIDES = {
	ru: {
		popupBoundAccounts: {
			one: 'С этим сайтом связан {count} аккаунт. Выберите аккаунт для входа.',
			few: 'С этим сайтом связаны {count} аккаунта. Выберите аккаунт для входа.',
			many: 'С этим сайтом связано {count} аккаунтов. Выберите аккаунт для входа.',
		},
		popupUnavailableAccounts: {
			few: 'Пропущено {count} повторяющихся или несовместимых аккаунта: {names}{more}. Исправьте их в своём экземпляре.',
			many: 'Пропущено {count} повторяющихся или несовместимых аккаунтов: {names}{more}. Исправьте их в своём экземпляре.',
		},
		popupRemainingSeconds: { few: 'Осталось {seconds} секунды', many: 'Осталось {seconds} секунд' },
		popupUpdatesIn: { few: 'Обновление через {seconds} секунды', many: 'Обновление через {seconds} секунд' },
		popupNextIn: { few: 'Действует через {seconds} секунды', many: 'Действует через {seconds} секунд' },
		popupSearchCount: {
			few: 'Найдено {count} совпадения среди всех аккаунтов',
			many: 'Найдено {count} совпадений среди всех аккаунтов',
		},
		popupLoginSummary: {
			few: 'Аккаунт страницы {email}: {count} подходящих аккаунта Google{hint}',
			many: 'Аккаунт страницы {email}: {count} подходящих аккаунтов Google{hint}',
		},
		optionsAccountStatus: {
			few: '{connection} · {count} аккаунта{unavailable}',
			many: '{connection} · {count} аккаунтов{unavailable}',
		},
		optionsUnavailableAccounts: {
			few: '; {count} аккаунта пока не поддерживаются',
			many: '; {count} аккаунтов пока не поддерживаются',
		},
		optionsSiteCount: { few: '{count} сайта', many: '{count} сайтов' },
		optionsSiteCountFiltered: { few: '{count} / {total} сайта', many: '{count} / {total} сайтов' },
	},
};
