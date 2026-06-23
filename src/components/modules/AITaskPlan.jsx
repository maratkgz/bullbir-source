import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { serverTimestamp } from 'firebase/firestore'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'

// ── Category detection ──────────────────────────────────────────────────────
function detectCategory(text) {
  const t = text.toLowerCase()
  if (/english|язык|тил|spanish|french|german|korean|japanese|chinese|speak|слов|vocab|грамматик/.test(t)) return 'language'
  if (/бегать|run|fitness|спорт|gym|тренаж|похудеть|weight|workout|зарядка|физ/.test(t)) return 'fitness'
  if (/накопить|сберечь|save|деньги|money|бюджет|budget|откладыв|финанс/.test(t)) return 'savings'
  if (/код|coding|программ|javascript|python|developer|react|swift|flutter|it/.test(t)) return 'coding'
  if (/читать|book|книг|read|роман|страниц/.test(t)) return 'reading'
  if (/медитац|yoga|wellness|здоровье|sleep|сон|stress|стресс|mindful/.test(t)) return 'wellness'
  return 'general'
}

// ── Task templates per category ─────────────────────────────────────────────
const TEMPLATES = {
  language: {
    en: (g, n) => [
      `Learn 30 new words — week 1`, `Study grammar rules (basic)`, `Listen to 20 min of native audio`,
      `Practice speaking for 15 minutes`, `Review vocabulary from week 1`, `Learn 30 new words — week 2`,
      `Study grammar — intermediate`, `Watch a video without subtitles`, `Write a short text in ${g}`,
      `Full vocabulary review test`, `Learn 30 new words — week 3`, `Practice a dialogue`,
      `Listen to a podcast episode`, `Write a diary entry`, `Final self-assessment`,
    ].slice(0, n),
    ru: (g, n) => [
      `Выучить 30 новых слов — блок 1`, `Грамматика: базовые правила`, `20 минут аудирования`,
      `Разговорная практика (15 минут)`, `Повторение слов из блока 1`, `Выучить 30 новых слов — блок 2`,
      `Грамматика: продвинутый уровень`, `Посмотреть видео без субтитров`, `Написать текст на изучаемом языке`,
      `Тест на знание лексики`, `Выучить 30 новых слов — блок 3`, `Практика диалога`,
      `Прослушать подкаст`, `Написать дневниковую запись`, `Финальная самооценка`,
    ].slice(0, n),
    kg: (g, n) => [
      `30 жаңы сөз үйрөнүү — 1-блок`, `Грамматика: негизги эрежелер`, `20 мүнөт угуу практикасы`,
      `15 мүнөт сүйлөшүү практикасы`, `1-блоктун сөздөрүн кайталоо`, `30 жаңы сөз — 2-блок`,
      `Грамматика: орто деңгээл`, `Субтитрсиз видео көрүү`, `Тилде кыска текст жазуу`,
      `Лексика боюнча тест`, `30 жаңы сөз — 3-блок`, `Диалог практикасы`,
      `Подкаст угуу`, `Күндөлүк жазуу`, `Жыйынтыктоо тест`,
    ].slice(0, n),
  },
  fitness: {
    en: (g, n) => [
      `First workout: light cardio 20 min`, `Strength training — upper body`, `Rest day + stretching`,
      `Cardio: run or bike 30 min`, `Strength training — lower body`, `Active recovery walk`,
      `Interval training 25 min`, `Full body workout`, `Yoga or flexibility session`,
      `Long cardio session 45 min`, `Strength — progressive overload`, `Sport: try a new activity`,
      `Rest + mobility work`, `Benchmark workout to measure progress`, `Celebrate milestone 🎉`,
    ].slice(0, n),
    ru: (g, n) => [
      `Первая тренировка: лёгкое кардио 20 мин`, `Силовая: верхняя часть тела`, `День отдыха + растяжка`,
      `Кардио: бег или велосипед 30 мин`, `Силовая: нижняя часть тела`, `Активное восстановление`,
      `Интервальная тренировка 25 мин`, `Тренировка всего тела`, `Йога или гибкость 30 мин`,
      `Длинное кардио 45 мин`, `Силовая: прогрессивная нагрузка`, `Новая активность — попробовать`,
      `Отдых и мобильность`, `Контрольная тренировка — замерить прогресс`, `Отметить успех 🎉`,
    ].slice(0, n),
    kg: (g, n) => [
      `Биринчи машыгуу: жеңил кардио 20 мин`, `Күч машыгуусу: жогорку дене`, `Эс алуу + созуу`,
      `Кардио: чуркоо же велосипед 30 мин`, `Күч машыгуусу: төмөнкү дене`, `Активдүү калыбына келтирүү`,
      `Аралык машыгуу 25 мин`, `Бүт дене машыгуусу`, `Йога же ийкемдүүлүк 30 мин`,
      `Узун кардио 45 мин`, `Прогрессивдүү жүктөмдүү күч машыгуусу`, `Жаңы активдүүлүктү сынап көрүү`,
      `Эс алуу жана мобилдүүлүк`, `Прогрессти өлчөгөн контролдук машыгуу`, `Жетишкендикти белгилөө 🎉`,
    ].slice(0, n),
  },
  savings: {
    en: (g, n) => [
      `Audit all monthly expenses`, `Set a savings target amount`, `Cut 1 subscription or expense`,
      `Open or review savings account`, `First savings deposit`, `Review spending for the week`,
      `Find 3 ways to reduce expenses`, `Second savings deposit`, `Compare prices — groceries`,
      `Mid-point savings review`, `Eliminate impulse purchases for 7 days`, `Third savings deposit`,
      `Check progress toward goal`, `Plan next month's budget`, `Celebrate saving milestone 🎉`,
    ].slice(0, n),
    ru: (g, n) => [
      `Аудит всех ежемесячных расходов`, `Установить целевую сумму накоплений`, `Отказаться от 1 подписки/расхода`,
      `Открыть или проверить счёт для сбережений`, `Первый взнос на накопления`, `Проверить расходы за неделю`,
      `Найти 3 способа сократить расходы`, `Второй взнос на накопления`, `Сравнить цены — продукты`,
      `Промежуточный обзор сбережений`, `7 дней без импульсивных покупок`, `Третий взнос на накопления`,
      `Проверить прогресс к цели`, `Составить бюджет на следующий месяц`, `Отпраздновать веху накоплений 🎉`,
    ].slice(0, n),
    kg: (g, n) => [
      `Бардык айлык чыгымдарды текшерүү`, `Топтоо максаттуу суммасын белгилөө`, `1 жазылуу/чыгымдан баш тартуу`,
      `Топтоо эсебин ачуу же текшерүү`, `Биринчи топтоо салымы`, `Жуманын чыгымдарын текшерүү`,
      `Чыгымдарды азайтуунун 3 жолун табуу`, `Экинчи топтоо салымы`, `Бааларды салыштыруу`,
      `Ортосундагы топтоо жыйынтыгы`, `7 күн импульстук сатып алуулардан баш тартуу`, `Үчүнчү топтоо салымы`,
      `Максатка карата прогрессти текшерүү`, `Кийинки айга бюджет түзүү`, `Жетишкендикти белгилөө 🎉`,
    ].slice(0, n),
  },
  coding: {
    en: (g, n) => [
      `Complete an intro tutorial`, `Study core concepts (theory)`, `Build a "Hello World" project`,
      `Practice 5 coding exercises`, `Learn data structures basics`, `Build a small feature`,
      `Watch a 30-min masterclass`, `Refactor previous code`, `Add tests to your project`,
      `Build a mini project from scratch`, `Study algorithms`, `Deploy something to the web`,
      `Code review — read others' code`, `Add a feature to your project`, `Share or publish your work 🎉`,
    ].slice(0, n),
    ru: (g, n) => [
      `Пройти вводный туториал`, `Изучить основные концепции (теория)`, `Создать проект "Hello World"`,
      `Решить 5 задач на практику`, `Изучить основы структур данных`, `Написать небольшую фичу`,
      `Просмотреть 30-минутный мастер-класс`, `Рефакторинг предыдущего кода`, `Добавить тесты в проект`,
      `Построить мини-проект с нуля`, `Изучить алгоритмы`, `Опубликовать проект в интернете`,
      `Код-ревью — прочитать чужой код`, `Добавить новую функцию в проект`, `Поделиться своей работой 🎉`,
    ].slice(0, n),
    kg: (g, n) => [
      `Киришүү үчүн окутмалык өтүү`, `Негизги концепцияларды үйрөнүү (теория)`, `Hello World долбоорун жасоо`,
      `5 практикалык маселе чечүү`, `Маалымат структураларынын негиздери`, `Кичине функция жазуу`,
      `30 мүнөттүк мастер-класс көрүү`, `Мурунку кодду рефакторинг кылуу`, `Долбоорго тесттер кошуу`,
      `Нөлдөн мини-долбоор куруу`, `Алгоритмдерди үйрөнүү`, `Долбоорду интернетке чыгаруу`,
      `Код-ревью — башкалардын кодун окуу`, `Долбоорго жаңы функция кошуу`, `Иштин жыйынтыгын бөлүшүү 🎉`,
    ].slice(0, n),
  },
  reading: {
    en: (g, n) => [
      `Read chapters 1–3`, `Write key takeaways`, `Read chapters 4–6`, `Discuss or reflect on the theme`,
      `Read chapters 7–9`, `Summarise the first half`, `Read chapters 10–12`, `Take detailed notes`,
      `Read chapters 13–15`, `Write a one-page review`, `Read chapters 16–18`, `Note favourite quotes`,
      `Finish the book`, `Write final summary`, `Recommend it to someone 📚`,
    ].slice(0, n),
    ru: (g, n) => [
      `Прочитать главы 1–3`, `Записать ключевые идеи`, `Прочитать главы 4–6`, `Поразмышлять над темой`,
      `Прочитать главы 7–9`, `Резюмировать первую половину`, `Прочитать главы 10–12`, `Сделать подробные заметки`,
      `Прочитать главы 13–15`, `Написать мини-рецензию`, `Прочитать главы 16–18`, `Выписать любимые цитаты`,
      `Дочитать книгу`, `Написать итоговое резюме`, `Порекомендовать другу 📚`,
    ].slice(0, n),
    kg: (g, n) => [
      `1–3-беттерди окуу`, `Негизги ойлорду жазуу`, `4–6-беттерди окуу`, `Теманы ойлонуу`,
      `7–9-беттерди окуу`, `Биринчи жарымды жыйынтыктоо`, `10–12-беттерди окуу`, `Кеңири эскертмелер жазуу`,
      `13–15-беттерди окуу`, `Мини-рецензия жазуу`, `16–18-беттерди окуу`, `Сүйүктүү цитаталарды жазуу`,
      `Китепти аяктоо`, `Акыркы жыйынтык жазуу`, `Досуна сунуштоо 📚`,
    ].slice(0, n),
  },
  wellness: {
    en: (g, n) => [
      `5-minute morning meditation`, `Set a consistent sleep schedule`, `Drink 2L water every day for a week`,
      `10-minute mindful breathing`, `Reduce screen time 1 hour before bed`, `Evening journaling — gratitude`,
      `30-minute outdoor walk`, `Digital detox half-day`, `Cook a healthy meal`,
      `Practice deep breathing (box method)`, `Sleep 8 hours for 5 nights`, `Spend time in nature`,
      `Assess stress triggers`, `Build a wind-down routine`, `Celebrate 1 month of wellness 🌿`,
    ].slice(0, n),
    ru: (g, n) => [
      `5 минут утренней медитации`, `Установить постоянный режим сна`, `2 литра воды каждый день неделю`,
      `10 минут осознанного дыхания`, `Убрать экраны за 1 час до сна`, `Вечерний дневник — благодарность`,
      `30-минутная прогулка на свежем воздухе`, `Цифровой детокс — полдня`, `Приготовить полезную еду`,
      `Техника глубокого дыхания (метод box)`, `8 часов сна 5 ночей подряд`, `Время на природе`,
      `Оценить источники стресса`, `Создать вечерний ритуал`, `Отметить месяц заботы о себе 🌿`,
    ].slice(0, n),
    kg: (g, n) => [
      `Таңдагы 5 мүнөт медитация`, `Туруктуу уйку режимин орнотуу`, `Жума бою күнүнө 2 литр суу ичүү`,
      `10 мүнөт зейин дем алуу`, `Уктаардан 1 саат мурун экранды убакытты азайтуу`, `Кечки күндөлүк — ыраазычылык`,
      `30 мүнөт сыртта сейилдөө`, `Санариптик детокс — жарым күн`, `Пайдалуу тамак бышыруу`,
      `Терең дем алуу практикасы`, `5 түн 8 саат уйкусу`, `Жаратылышта убакыт өткөрүү`,
      `Стресс булактарын баалоо`, `Кечки ритуал түзүү`, `1 айлык ден-соолук майрамы 🌿`,
    ].slice(0, n),
  },
  general: {
    en: (g, n) => Array.from({ length: n }, (_, i) => `Step ${i + 1}: ${g.slice(0, 40)} — milestone ${i + 1}`),
    ru: (g, n) => Array.from({ length: n }, (_, i) => `Шаг ${i + 1}: продвижение к цели «${g.slice(0, 35)}»`),
    kg: (g, n) => Array.from({ length: n }, (_, i) => `Кадам ${i + 1}: «${g.slice(0, 35)}» максатына карай`),
  },
}

const DURATIONS = [
  { key: '2w', label: { en: '2 weeks', ru: '2 недели', kg: '2 апта' }, weeks: 2 },
  { key: '1m', label: { en: '1 month', ru: '1 месяц', kg: '1 ай' }, weeks: 4 },
  { key: '3m', label: { en: '3 months', ru: '3 месяца', kg: '3 ай' }, weeks: 12 },
  { key: '6m', label: { en: '6 months', ru: '6 месяцев', kg: '6 ай' }, weeks: 24 },
]

// ── Gemini API call ──────────────────────────────────────────────────────────
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`

async function generateWithGemini(goalText, weeks, lang) {
  const today = new Date().toISOString().split('T')[0]
  const endDate = new Date(Date.now() + weeks * 7 * 86400000).toISOString().split('T')[0]
  const count = Math.min(15, Math.max(6, Math.floor(weeks * 1.3)))

  const langInstruction = {
    en: 'Write all task titles in English.',
    ru: 'Пиши все названия задач на русском языке.',
    kg: 'Бардык тапшырмалардын аталыштарын кыргыз тилинде жаз.',
  }[lang] || 'Write in the same language as the goal.'

  const prompt = `You are a personal productivity coach. Create a detailed, actionable task plan.

Goal: "${goalText}"
Duration: ${weeks} weeks (${today} → ${endDate})
Number of tasks: ${count}
${langInstruction}

Rules:
- Each task must be specific and actionable (not vague like "study more")
- Spread tasks evenly across the timeframe
- First tasks should be easier/foundational, later ones more advanced
- Assign priority: first 3 tasks = "high", middle = "medium", last tasks = "low"
- Deadlines must be between ${today} and ${endDate} in YYYY-MM-DD format

Respond ONLY with a raw JSON array, no markdown fences, no explanation:
[{"title":"...","deadline":"YYYY-MM-DD","priority":"high|medium|low"},...]`

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 2000 },
    }),
  })

  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const data = await res.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  // Strip markdown fences if model added them anyway
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const tasks = JSON.parse(cleaned)
  return tasks.map((task, i) => ({
    title: task.title,
    deadline: task.deadline || endDate,
    priority: task.priority || (i < 3 ? 'high' : i < 8 ? 'medium' : 'low'),
    status: 'todo',
  }))
}

// ── Fallback: template-based generation (used when no API key or API fails) ──
function generateFallback(goalText, weeks, lang) {
  const category = detectCategory(goalText)
  const count = Math.min(15, Math.max(5, Math.floor(weeks * 1.2)))
  const templates = TEMPLATES[category]?.[lang] || TEMPLATES[category]?.ru || TEMPLATES.general.ru
  const titles = typeof templates === 'function' ? templates(goalText, count) : templates(goalText, count)
  const now = new Date()
  const totalMs = weeks * 7 * 86400000
  return titles.map((title, i) => ({
    title,
    deadline: new Date(now.getTime() + (totalMs / (titles.length + 1)) * (i + 1)).toISOString().split('T')[0],
    priority: i < 3 ? 'high' : i < 8 ? 'medium' : 'low',
    status: 'todo',
  }))
}

function SkeletonCard() {
  return (
    <div className="ai-skeleton-card">
      <div className="ai-skel-line wide" />
      <div className="ai-skel-line narrow" />
    </div>
  )
}

export default function AITaskPlan() {
  const { t, lang } = useLang()
  const { add } = useCollection('tasks')
  const toast = useToast()
  const navigate = useNavigate()

  const [goal, setGoal] = useState('')
  const [duration, setDuration] = useState('1m')
  const [step, setStep] = useState('form') // form | thinking | preview | error
  const [plan, setPlan] = useState([])
  const [errorMsg, setErrorMsg] = useState('')

  const generate = async () => {
    if (!goal.trim()) return
    setStep('thinking')
    setErrorMsg('')
    const dur = DURATIONS.find(d => d.key === duration)
    try {
      let tasks
      if (GEMINI_KEY) {
        tasks = await generateWithGemini(goal.trim(), dur.weeks, lang)
      } else {
        // No key — use templates
        await new Promise(r => setTimeout(r, 1400))
        tasks = generateFallback(goal.trim(), dur.weeks, lang)
      }
      setPlan(tasks.map((t, i) => ({ ...t, id: i })))
      setStep('preview')
    } catch (err) {
      console.error('Gemini error:', err)
      // Graceful fallback to templates
      try {
        const tasks = generateFallback(goal.trim(), dur.weeks, lang)
        setPlan(tasks.map((t, i) => ({ ...t, id: i })))
        setStep('preview')
        toast.info('⚠️ AI недоступен — использованы шаблоны')
      } catch {
        setErrorMsg(err.message || 'Ошибка генерации')
        setStep('error')
      }
    }
  }

  const updateTask = (id, field, value) =>
    setPlan(p => p.map(t => t.id === id ? { ...t, [field]: value } : t))

  const removeTask = (id) => setPlan(p => p.filter(t => t.id !== id))

  const acceptPlan = async () => {
    const goalName = goal.trim()
    await Promise.all(plan.map(task =>
      add({
        ...task,
        title: task.title,
        description: '',
        tags: [`✨ AI: ${goalName.slice(0, 25)}`],
        subtasks: [],
        aiGenerated: true,
        aiPlan: goalName,
      })
    ))
    toast.success(t('ai.accepted'))
    navigate('/app/tasks')
  }

  const durationLabel = (key) => {
    const d = DURATIONS.find(x => x.key === key)
    return d?.label[lang] || d?.label.ru || key
  }

  return (
    <div>
      <div className="page-header">
        <h1>✨ {t('ai.title')}</h1>
      </div>

      <AnimatePresence mode="wait">

        {/* ── Step 1: Form ── */}
        {step === 'form' && (
          <motion.div key="form" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="ai-form-wrap">
            <div className="card">
              <div className="field">
                <label>{t('ai.goalLabel')}</label>
                <textarea
                  className="input ai-goal-input"
                  rows={3}
                  placeholder={t('ai.goalPlaceholder')}
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) generate() }}
                />
              </div>
              <div className="field" style={{ marginTop: 'var(--space-4)' }}>
                <label>{t('ai.duration')}</label>
                <div className="prof-choice-row">
                  {DURATIONS.map(d => (
                    <button key={d.key} className={`prof-choice-btn ${duration === d.key ? 'active' : ''}`} onClick={() => setDuration(d.key)}>
                      {d.label[lang] || d.label.ru}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 'var(--space-4)', width: '100%' }} disabled={!goal.trim()} onClick={generate}>
                ✨ {t('ai.generate')}
              </button>
            </div>

            <div className="card ai-hint-card">
              <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>💡 {t('ai.hint')}</p>
              <ul className="ai-examples">
                {(t('ai.examples') || '').split('|').filter(Boolean).map((ex, i) => (
                  <li key={i} className="ai-example-item" onClick={() => setGoal(ex.trim())}>
                    {ex.trim()}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}

        {/* ── Error ── */}
        {step === 'error' && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ai-form-wrap">
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
              <p style={{ fontSize: 32 }}>⚠️</p>
              <p style={{ fontWeight: 600, marginTop: 8 }}>Ошибка генерации</p>
              <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>{errorMsg}</p>
              <button className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }} onClick={() => setStep('form')}>Попробовать снова</button>
            </div>
          </motion.div>
        )}

        {/* ── Step 2: Thinking ── */}
        {step === 'thinking' && (
          <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="ai-thinking-wrap">
            <div className="ai-thinking-header">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                style={{ fontSize: 32, display: 'inline-block' }}
              >✨</motion.div>
              <p className="ai-thinking-text">{t('ai.thinking')}</p>
              <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>«{goal}»</p>
            </div>
            <div className="ai-skeleton-list">
              {Array.from({ length: 6 }).map((_, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.15 }}>
                  <SkeletonCard />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Step 3: Preview ── */}
        {step === 'preview' && (
          <motion.div key="preview" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="ai-preview-header">
              <div>
                <h2 style={{ fontSize: 'var(--text-xl)' }}>📋 {t('ai.planReady')}</h2>
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  «{goal}» · {durationLabel(duration)} · {plan.length} {t('ai.tasks')}
                </p>
              </div>
              <div className="flex gap-3">
                <button className="btn btn-ghost" onClick={() => { setStep('form'); setPlan([]) }}>{t('ai.regenerate')}</button>
                <button className="btn btn-primary" onClick={acceptPlan}>✓ {t('ai.accept')}</button>
              </div>
            </div>

            <div className="ai-plan-list">
              <AnimatePresence>
                {plan.map((task, idx) => (
                  <motion.div
                    key={task.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20, scale: 0.95 }}
                    transition={{ delay: idx * 0.04 }}
                    className="ai-plan-card"
                  >
                    <div className="ai-plan-num">{idx + 1}</div>
                    <div className="ai-plan-body">
                      <input
                        className="ai-plan-title-input"
                        value={task.title}
                        onChange={e => updateTask(task.id, 'title', e.target.value)}
                      />
                      <div className="ai-plan-meta">
                        <input
                          type="date"
                          className="input ai-plan-date"
                          value={task.deadline}
                          onChange={e => updateTask(task.id, 'deadline', e.target.value)}
                        />
                        <select
                          className="select ai-plan-prio"
                          value={task.priority}
                          onChange={e => updateTask(task.id, 'priority', e.target.value)}
                        >
                          <option value="low">{t('tasks.low')}</option>
                          <option value="medium">{t('tasks.medium')}</option>
                          <option value="high">{t('tasks.high')}</option>
                        </select>
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-icon" style={{ color: 'var(--text-muted)' }} onClick={() => removeTask(task.id)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div style={{ textAlign: 'center', marginTop: 'var(--space-5)' }}>
              <button className="btn btn-primary" style={{ minWidth: 200 }} onClick={acceptPlan}>
                ✓ {t('ai.accept')} ({plan.length})
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}
