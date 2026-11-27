// Quotes shown on the loading screen: a mix of light humour, motivation and inspiration.
// PERSONAL holds the author's own phrases — shown as written, in every language.
export const PERSONAL_QUOTES = ['будтэ сабими самий', 'симу сою римя']

export const SPLASH_QUOTES = {
  ru: [
    'Загружаем мотивацию… Пожалуйста, не выключайте себя.',
    'Сделанное лучше идеального.',
    'Диван не обидится, если ты сначала сделаешь одно дело.',
    'Маленький шаг сегодня — большая разница через год.',
    'Кофе ускоряет загрузку. Проверено на разработчиках.',
    'Дисциплина — это помнить, чего ты хочешь больше всего.',
    'Ты не обязан быть великим, чтобы начать. Но нужно начать, чтобы стать великим.',
    'Прокрастинация: завтра — самый занятой день недели.',
    'Каждый мастер когда-то был новичком.',
    'Даже чайник закипает не сразу.',
    'Лучшее время начать было вчера. Второе лучшее — сейчас.',
    'Твоё будущее «я» уже говорит тебе спасибо.',
  ],
  kg: [
    'Мотивация жүктөлүүдө… Өзүңдү өчүрбө.',
    'Жасалган иш кемчиликсиз пландан жакшы.',
    'Диван таарынбайт, адегенде бир ишти бүтүрсөң.',
    'Бүгүнкү кичинекей кадам — бир жылдан кийин чоң айырма.',
    'Кофе жүктөөнү тездетет. Иштеп чыгуучуларда текшерилген.',
    'Тартип — эң көп эмнени каалаарыңды эстеп жүрүү.',
    'Баштоо үчүн улуу болушуң шарт эмес. Улуу болуш үчүн баштоо керек.',
    'Эртең — жуманын эң бош эмес күнү.',
    'Ар бир устат качандыр бир кезде жаңы баштоочу болгон.',
    'Чайнек да заматта кайнабайт.',
    'Баштоонун эң жакшы убактысы кечээ болчу. Экинчиси — азыр.',
    'Келечектеги сен азыртадан ыракмат айтып жатат.',
  ],
  en: [
    'Loading motivation… please do not turn yourself off.',
    'Done is better than perfect.',
    'The couch will not be offended if you finish one task first.',
    'A small step today is a big difference a year from now.',
    'Coffee speeds up loading. Tested on developers.',
    'Discipline is remembering what you want most.',
    'You don’t have to be great to start, but you have to start to be great.',
    'Procrastination: tomorrow is the busiest day of the week.',
    'Every master was once a beginner.',
    'Even a kettle doesn’t boil instantly.',
    'The best time to start was yesterday. The second best is now.',
    'Your future self is already saying thanks.',
  ],
}

/** One random quote for the language; personal phrases are always in the mix. */
export function pickSplashQuote(lang, random = Math.random) {
  const pool = [...(SPLASH_QUOTES[lang] || SPLASH_QUOTES.ru), ...PERSONAL_QUOTES]
  return pool[Math.floor(random() * pool.length)] ?? pool[0]
}
