# Ревью безопасности собственной авторизации BullBir (этап 10)

- **Дата:** 2026-11-26 · **Ветка:** `feature/own-auth` (после коммита этапа 9, `76110f0`)
- **Стандарты:** OWASP ASVS 4.0.3, уровень 2 (главы V2, V3, V4, V5, V7, V8, V9, V13, V14) и OWASP Top 10 (2021)
- **Что проверено:** весь код `server/` и `api/`, `firestore.rules`, `storage.rules`, `vercel.json`,
  `vite.config.js`, клиент (`src/auth/api.js`, `src/context/AuthContext.jsx`, `src/firebase/*.js`),
  документы `docs/adr/001-own-auth.md`, `docs/auth-api.md`, `docs/auth-migration-plan.md`, имена тестов в `tests/`.
- **Что запускалось в этом ревью:** `npx tsc -p tsconfig.server.json` — без ошибок; `npx vitest run` —
  **450 из 450** unit-тестов зелёные. Тесты на эмуляторе (`tests/emulator/*`) в этом ревью **не запускались**
  (по условиям задачи). На них ссылаемся по названию; последний зелёный прогон (254 теста) записан в коммите этапа 9.
- `npm audit --omit=dev`: 37 уязвимостей в зависимостях (5 high, все транзитивные через пакет `firebase`), см. раздел 4.

Как читать ссылки: `server/routes/auth.ts:160` — файл и номер строки. Тесты: `файл › название теста`.
Тесты из `tests/unit/` запускаются командой `npm test`, из `tests/emulator/` — `npm run test:emulator`.

---

## 1. Коротко

**Вердикт.** Авторизация сделана аккуратно и «по учебнику»: большинство требований ASVS L2 из
проверенных глав выполнено, и почти на каждый пункт защиты есть автоматический тест. Серьёзных
дыр, через которые можно войти в чужой аккаунт, в коде **не найдено**. Но выкатывать в прод
**пока рано**: есть 2 пункта высокого приоритета (один — настройка Firebase Console, второй — удаление
аккаунта, которое может «застрять» на полпути) и обязательная настройка внешних сервисов (Upstash, Resend).
После их закрытия — можно выкатывать; остальное — плановые улучшения.

**Что сделано сильно**

- **Пароли:** argon2id с параметрами OWASP, проверка по базе утёкших паролей (HIBP, наружу уходят
  только 5 символов хэша), никаких правил «заглавная + цифра», нет обрезки длинных паролей.
- **Сессии:** случайный токен 256 бит в cookie `__Host-session` (HttpOnly, Secure, SameSite=Lax);
  в базе только SHA-256 от токена; новый токен при каждом входе; «мои устройства» и «выйти везде».
- **Мост к Firestore** закрыт «версией учётных данных» (`bb_cv`): после смены пароля/почты, «выйти везде»
  и удаления старые Firebase-токены перестают работать **сразу**, а не через час.
- **Перебор:** лимиты по IP и по почте (Upstash Redis), блокировка аккаунта 15 мин с удвоением до 24 ч,
  попытка резервируется **до** проверки пароля — параллельные запросы не обходят лимит. При падении
  Redis система **отказывает**, а не пропускает (fail closed).
- **Нельзя узнать, зарегистрирована ли почта:** одинаковые ответы, «фиктивная» проверка пароля,
  выравнивание времени ответа.
- **Коды из писем:** хранится только HMAC с секретом сервера; одноразовые, 10 минут, 5 попыток;
  коды для входа/сброса/смены почты привязаны к браузеру (cookie `__Host-otp`) — чужой браузер не
  может ни угадывать, ни «сжечь» код владельца.
- **Google-вход:** Authorization Code + PKCE + state + nonce, свой проверщик подписи JWT с жёстко
  заданным алгоритмом RS256; автопривязка к существующему аккаунту только для `@gmail.com` при
  подтверждённой почте с обеих сторон.
- **Защита от «предрегистрации» чужой почты:** аккаунт создаётся только при вводе кода **и** того же
  пароля; подтверждение почты кодом стирает всё, что настроил тот, кто создал запись.
- **Единый конвейер запросов** (`server/router.ts`): проверка Origin (CSRF), лимиты, таймаут, единый
  формат ошибок, логи без секретов — ни один эндпоинт не может «забыть» защиту.
- **Правила Firestore/Storage:** всё закрыто по умолчанию, серверные коллекции явно запрещены клиенту,
  есть тесты правил.

**Главные открытые риски (подробно — раздел 4)**

1. 🔴 **Старые способы входа Firebase Auth ещё включены в консоли** → любой может создать Firebase-учётку
   на чужую почту и этим **навсегда заблокировать** регистрацию владельца почты; правила Firestore
   принимают любой Firebase-токен для корневого профиля `users/{uid}`.
2. 🔴 **Удаление аккаунта может оборваться на полпути без возможности повторить** (таймаут 8 с,
   аккаунт уже «мёртв», а личные данные остаются в базе).
3. 🟠 Выход на одном устройстве (`logout`, «отключить устройство») не отзывает мост сразу — у украденного
   устройства остаётся доступ к Firestore до 1 часа.
4. 🟠 Нет второго фактора (MFA/TOTP) и нет CAPTCHA; минимальная длина пароля 10 символов (ASVS просит 12);
   сессия живёт до 7 дней без активности / 30 дней максимум (ASVS L2 ждёт 12 ч / 30 мин).
5. 🟠 Upstash и Resend ещё не настроены — без них сервер в проде **не запустится** (это правильно, но это блокер).

---

## 2. ASVS 4.0.3, уровень 2

Обозначения: ✅ выполнено · ⚠️ частично · ❌ нет · — не применимо.

### V2. Аутентификация

| Требование | Статус | Как сделано (где) | Доказательство (тест) |
|---|---|---|---|
| 2.1.1 Пароль не короче 12 символов | ⚠️ | Минимум **10** символов (`server/auth/password.ts:13`). Сознательно мягче ASVS; HIBP частично компенсирует | `auth-units.test.ts › password policy › length must be 10..128` |
| 2.1.2 Разрешены пароли 64+ символов, запрет > 128 | ✅ | Максимум 128 (`password.ts:14`, `:45-50`) | там же |
| 2.1.3 Пароль не обрезается | ✅ | Слишком длинный отклоняется, а не обрезается (`password.ts:45-50`, `routes/auth.ts:39-41`); argon2 без лимита 72 байта | `auth-units.test.ts › password policy › counts code points, not UTF-16 units` |
| 2.1.4 Любые символы Unicode, включая эмодзи | ✅ | Длина считается по кодовым точкам (`password.ts:46`) | там же |
| 2.1.5 Пользователь может сменить пароль | ✅ | `POST password/change` (`server/routes/account.ts:127-143`) | `account-stage7.test.ts › password change › success: this browser gets a new working session…` |
| 2.1.6 Смена требует текущий и новый пароль | ✅ | `reauthenticate()` (`account.ts:52-60`) | `account-stage7.test.ts › password change › wrong current password → invalid_credentials, counted by the lockout (5th → 429)` |
| 2.1.7 Проверка по базе утёкших паролей | ⚠️ | HIBP k-anonymity (`password.ts:59-79`). При недоступности HIBP — пропускает (fail open, `:74-78`); событие `hibp_unavailable` объявлено, но **никогда не пишется** | `auth-units.test.ts › HIBP lookup sends only a 5-char SHA-1 prefix…`, `› HIBP unreachable → fails open…`; `auth-flow.test.ts › breached password → breached_password, nothing created, no mail` |
| 2.1.8 Индикатор силы пароля | ⚠️ | Есть подсказки-правила (длина) в `NewPasswordFields.jsx`/`Register.jsx`, полноценного измерителя нет | — |
| 2.1.9 Нет правил состава («заглавная+цифра») | ✅ | Только длина + HIBP (`password.ts:88-93`) | `auth-units.test.ts › length is checked before (and without) the breach lookup` |
| 2.1.10 Нет принудительной периодической смены | ✅ | Не реализовано намеренно | — |
| 2.1.11 Вставка из буфера / менеджеры паролей | ✅ | Ничего не запрещает вставку | — |
| 2.1.12 Можно показать пароль | ✅ | Переключатель видимости (`src/components/auth/Login.jsx:131`) | — |
| 2.2.1 Защита от перебора и автоматизации | ✅ | Лимиты по IP и по почте (`server/limits.ts`), блокировка аккаунта (`server/auth/throttle.ts:33-54`), fail closed (`server/rateLimit.ts:97-109`). CAPTCHA нет (см. риск С4) | `auth-flow.test.ts › 5 failures → 429…`, `› 10 concurrent wrong logins: at most 5 get past the lock`, `› unknown emails lock exactly like real ones…`; `rateLimit.test.ts › fails CLOSED with service_unavailable…` |
| 2.2.2 «Слабые» аутентификаторы (почта) только как дополнительные | ⚠️ | Вход по коду из почты — **основной** способ, а не второй фактор. Риск снижен: 8 цифр, привязка к браузеру, лимиты, в письме видно устройство и время (`server/routes/otpLogin.ts`) | `otp-login.test.ts › code security › a code from browser A does not work from browser B…` |
| 2.2.3 Уведомление после изменения учётных данных | ✅ | Письма: пароль изменён, почта изменена (на **старый** адрес), добавлен Google-вход, аккаунт удалён (`server/auth/mailer.ts:24-108`) | `account-stage7.test.ts › email change › confirm: … old notified …`; `oauth-google.test.ts › existing VERIFIED password account (gmail.com) … mail …` |
| 2.3.1 Временные пароли от системы | — | Система паролей не выдаёт | — |
| 2.4.1 Пароли хранятся солёным хэшем с «дорогой» функцией | ✅ | argon2id m=19 MiB, t=2, p=1 (`password.ts:16-20`); старые scrypt-хэши Firebase перехэшируются при первом входе (`server/auth/passwordCheck.ts:50-63`) | `auth-units.test.ts › argon2 hash verifies the right password only…`; `migration-login.test.ts › correct password → 200 + session; legacy hash replaced by argon2id…` |
| 2.4.2 Соль ≥ 32 бит | ✅ | Соль генерирует `@node-rs/argon2` (16 байт) | — |
| 2.4.5 Дополнительный «секретный перец» для паролей | ❌ | Перец (`AUTH_PEPPER`) применяется только к кодам, не к паролям. Низкий риск (argon2id) | — |
| 2.5.1 Секреты восстановления не в открытом виде | ✅ | Код восстановления — одноразовый, 10 мин, в базе только HMAC (`server/auth/otp.ts:46-59`) | `otp-login.test.ts › the stored code is never the plain code or the plain challenge` |
| 2.5.2 Нет «подсказок» и секретных вопросов | ✅ | Нет | — |
| 2.5.3 Восстановление не раскрывает пароль | ✅ | Только установка нового (`account.ts:95-123`) | — |
| 2.5.4 Нет общих/стандартных аккаунтов | ✅ | Нет; админы назначаются только в консоли (`firestore.rules:47-49`, `:83-86`) | `firestore.rules.test.ts › keeps admin records read-only to clients` |
| 2.5.5 Уведомление при смене/сбросе | ✅ | Письмо `password-changed` после сброса и смены (`account.ts:119`, `:140`) | `account-stage7.test.ts › password reset › confirm: … password-changed mail` |
| 2.5.6 Безопасный сброс пароля | ✅ | Код на почту, привязан к браузеру, после сброса все сессии и мост завершаются (`account.ts:95-123`) | `account-stage7.test.ts › password reset › confirm with another browser's challenge cookie → invalid_code`, `› credential version: a bridge token minted before the reset can no longer read…` |
| 2.5.7 Восстановление при потере второго фактора | — | Второго фактора нет | — |
| 2.7.1 Нет SMS/телефона как канала | ✅ | Вход по SMS удалён на этапе 9 | — |
| 2.7.2 Код из письма живёт ≤ 10 мин | ✅ | `CODE_TTL_MS` (`otp.ts:19`) | `otp-login.test.ts › expires after 10 minutes`; `auth-flow.test.ts › expires after 10 minutes` |
| 2.7.3 Код одноразовый | ✅ | Удаляется в транзакции (`otp.ts:78-97`) | `otp-login.test.ts › single use: the same code twice…` |
| 2.7.4 Отдельный защищённый канал | ⚠️ | Почта. Защищённость зависит от почтового ящика пользователя | — |
| 2.7.5 Сервер хранит только хэш кода | ✅ | HMAC-SHA256(pepper, id:code) (`otp.ts:41-43`) | `otp-login.test.ts › the stored code is never the plain code…` |
| 2.7.6 Код из CSPRNG, ≥ 20 бит | ✅ | `crypto.randomInt` без смещения (`server/auth/crypto.ts:25-27`); 6 цифр для регистрации, 8 для входа/сброса | `auth-units.test.ts › sixDigitCode is roughly uniform…` |
| 2.8.x Одноразовые пароли (TOTP) | ❌ | Не реализовано (см. риск С1) | — |
| 2.10.1–2.10.4 Секреты сервисов | ⚠️ | Секреты только в переменных окружения, проверяются при старте без вывода значений (`server/env.ts:91-118`); `.gitignore` закрывает ключи. Ключ сервисного аккаунта — статичный JSON (не workload identity) | `env.test.ts › names invalid variables but never includes their secret values` |

### V3. Управление сессиями

| Требование | Статус | Как сделано (где) | Доказательство (тест) |
|---|---|---|---|
| 3.1.1 Токен сессии не в URL | ✅ | Только cookie (`server/auth/cookies.ts:49-51`) | — |
| 3.2.1 Новый токен при входе | ✅ | `startSession` удаляет предъявленную сессию и выдаёт новую (`server/routes/auth.ts:44-50`); то же для Google (`server/routes/oauth.ts:52-60`) | `auth-flow.test.ts › login with an old cookie presented ends that old session`; `oauth-google.test.ts › a session presented at the callback is replaced, not kept (no fixation)` |
| 3.2.2 ≥ 64 бит случайности | ✅ | 32 байта = 256 бит (`crypto.ts:7-9`) | `auth-units.test.ts › randomToken is 32 bytes as 43 base64url chars…` |
| 3.2.3 Токен хранится безопасно в браузере | ✅ | HttpOnly cookie, JS его не видит | `auth-units.test.ts › Set-Cookie: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age, no Domain` |
| 3.2.4 Токен из CSPRNG | ✅ | `crypto.randomBytes` | там же |
| 3.3.1 Выход завершает сессию | ⚠️ | Сессия удаляется на сервере (`auth.ts:184-195`). Но Firebase ID-токен моста на этом устройстве живёт ещё до 1 ч (см. риск С2) | `auth-flow.test.ts › logout clears the cookie, kills the token and revokes Firebase refresh tokens` |
| 3.3.2 Периодическая повторная аутентификация (L2: 12 ч или 30 мин бездействия) | ⚠️ | 7 дней без активности, 30 дней максимум (`server/auth/sessions.ts:16-17`). Осознанный выбор для личного PWA; опасные действия требуют пароль | `auth-flow.test.ts › idle expiry: 7 days without activity → 401`, `› absolute expiry: 30 days…` |
| 3.3.3 После смены пароля — выход на других устройствах | ✅ | `freshSessionOnly` → `revokeAllSessions` + сдвиг `passwordChangedAt` (`account.ts:63-70`, `routes/auth.ts:56-67`) | `account-stage7.test.ts › password change › success: … other sessions end, old password fails…` |
| 3.3.4 Пользователь видит сессии и может завершить любую | ✅ | `GET sessions`, `DELETE sessions/:id`, `logout-all` (`server/routes/sessions.ts`) | `auth-flow.test.ts › DELETE sessions/:id of another device → that cookie is dead; mine survives`, `› a session id of another user → 404…` |
| 3.4.1 Флаг Secure | ✅ | `cookies.ts:50` | `auth-units.test.ts › Set-Cookie: HttpOnly, Secure…` |
| 3.4.2 Флаг HttpOnly | ✅ | `cookies.ts:50` | там же |
| 3.4.3 SameSite | ✅ | `Lax` для сессии и OAuth, `Strict` для `__Host-otp` (`cookies.ts:41-55`, `server/auth/oauth/flow.ts:116-118`) | `oauth-flow.test.ts › uses a __Host- cookie: Secure, HttpOnly, Path=/, no Domain, Lax, short-lived` |
| 3.4.4 Префикс `__Host-` | ✅ | `__Host-session`, `__Host-otp`, `__Host-oauth` | там же |
| 3.4.5 Path ограничен | ✅ | `Path=/` (требование `__Host-`), один origin | — |
| 3.5.2 Сессия — не статичный ключ | ✅ | Токены отзываемые, с TTL | — |
| 3.5.3 Stateless-токены подписаны | ✅ | Custom token Firebase подписан ключом Admin SDK; claim `bb_cv` проверяется правилами (`firestore.rules:30-33`) | `bridge.test.ts › signs the client in as the same uid with the bb_ev claim`; `firestore.rules.test.ts › credential version › stale token (…) is denied reads and writes…` |
| 3.7.1 Повторная проверка перед опасными действиями | ✅ | Смена пароля/почты и удаление требуют **текущий пароль**; у аккаунтов без пароля — сначала задать его через сброс (`account.ts:52-60`) | `account-stage7.test.ts › email change › passwordless account → password_not_set (even with a fresh session)…`; `› account deletion › password account: missing / wrong current password → invalid_credentials; nothing deleted` |

### V4. Контроль доступа

| Требование | Статус | Как сделано (где) | Доказательство (тест) |
|---|---|---|---|
| 4.1.1 Проверки доступа на доверенной стороне | ✅ | Сервер (`currentUser`, `routes/auth.ts:56-67`) + правила Firestore/Storage | `auth-flow.test.ts › firebase-token and me without a session → 401` |
| 4.1.2 Пользователь не может менять атрибуты доступа | ⚠️ | Claims `bb_ev`/`bb_cv` ставит только сервер; поля профиля — белый список (`firestore.rules:56-73`). Но правила принимают **любой** Firebase-токен (не только наш custom token) — см. риск В1 | `firestore.rules.test.ts › rejects client-created privilege fields…`, `› ignores Firebase email_verified without the bb_ev claim` |
| 4.1.3 Минимальные привилегии | ✅ | Клиенту доступны только `users/{его uid}/…` и белый список коллекций (`firestore.rules:37-43`, `:76-80`) | `firestore.rules.test.ts › allows verified owners, but not other users, to access module data` |
| 4.1.5 Ошибка = отказ | ✅ | Deny-by-default (`firestore.rules:116-118`, `storage.rules:26-28`); ошибки лимитера → 503 | `firestore.rules.test.ts` (it.each по серверным коллекциям `users_auth/…`) |
| 4.2.1 Защита от IDOR | ✅ | Сессия ищется по `uid` + `publicId` (`sessions.ts:133-141`); код смены почты сверяется с uid сессии (`account.ts:189`) | `auth-flow.test.ts › a session id of another user → 404 and that session survives`; `account-stage7.test.ts › a code issued for user A cannot be confirmed with user B's session` |
| 4.2.2 Защита от CSRF | ✅ | SameSite=Lax + обязательный разрешённый `Origin` на POST/DELETE (`server/origin.ts:13-25`, `server/router.ts:160`); OAuth-колбэк защищён state+cookie | `origin.test.ts › is rejected without Origin`, `router.test.ts › DELETE from a foreign origin → 403 and the handler does not run`; `oauth-google.test.ts › missing flow cookie (another browser / login CSRF) → oauth_failed` |
| 4.3.1 MFA для административных интерфейсов | ❌ | Админ-страница базы знаний ИИ (`/admins`, `aiDomains`) защищена только обычным входом | — |
| 4.3.3 Доп. проверка для ценных операций | ✅ | См. 3.7.1 | — |

### V5. Проверка ввода

| Требование | Статус | Как сделано (где) | Доказательство (тест) |
|---|---|---|---|
| 5.1.1 Защита от загрязнения параметров | ✅ | Тело — JSON по схеме; в OAuth берётся первый параметр с лимитом длины (`routes/oauth.ts:82-85`) | — |
| 5.1.3 Проверка по белому списку (схемы) | ✅ | zod на каждом теле (`server/validate.ts:7-14`), в ошибке только имена полей | `otp-login.test.ts › rejects a malformed email before touching storage` |
| 5.1.4 Строгие типы и форматы | ✅ | Почта нормализуется (NFKC, lowercase) и проверяется (`server/auth/email.ts`); коды — ровно 6/8 цифр; id сессии — 32 hex (`routes/sessions.ts:10`) | `auth-units.test.ts › emailSchema normalizes then validates` |
| 5.1.5 Редиректы только на разрешённые адреса | ✅ | Только фиксированные `/app` и `/login?error=…` (`routes/oauth.ts:27`, `:74-76`) | `oauth-google.test.ts › unknown provider → back to /login with oauth_failed…` |
| 5.2.x Санитизация HTML | — | Вне объёма ревью авторизации (Tiptap-заметки); письма — только текст | — |
| 5.3.x Кодирование вывода / инъекции | ✅ | React экранирует; Firestore без языка запросов; id документов — хэши, `/` в `sub` запрещён (`server/auth/oauth/accounts.ts:55-58`) | `oauth-linking.test.ts › refuses ids that would escape the collection` |
| 5.5.x Безопасная десериализация | ✅ | Только `JSON.parse`, тело ≤ 16 КБ (`server/http.ts:7`, `:22-60`); JWT ≤ 8 КБ (`server/auth/oauth/jwt.ts:7`) | `http.test.ts › rejects an oversized streamed body with 413…`, `› rejects malformed JSON with 400 and does not echo the body` |

### V7. Ошибки и журналирование

| Требование | Статус | Как сделано (где) | Доказательство (тест) |
|---|---|---|---|
| 7.1.1 В логах нет паролей, токенов, кодов | ✅ | `redact()` по именам ключей, маскирование почты, обрезка длинных токенов (`server/log.ts:7-31`) | `log.test.ts › never writes secrets into the log line`; `auth-flow.test.ts › no secrets in logs during a full flow…`; `account-stage7.test.ts › no secrets in logs across reset, change, email change and deletion…` |
| 7.1.2 Нет лишних персональных данных | ✅ | Почта маскируется; IP — только /24 или /48 (`http.ts:114-121`); User-Agent не хранится (`server/auth/device.ts`) | `router.test.ts › logs one request line with an IP prefix and no full IP`; `auth-units.test.ts › never echoes the raw User-Agent…` |
| 7.1.3 Журнал событий безопасности | ✅ | `security_events` (вход, ошибки, блокировка, выходы, смены, удаление), TTL 180 дней (`server/auth/events.ts`) | `events-journal.test.ts › events written by each flow › …` (14 тестов) |
| 7.1.4 Достаточно данных для расследования | ✅ | `requestId`, время, путь, статус, префикс IP, устройство | `router.test.ts › logs unhandled errors server-side with the same request id` |
| 7.2.1 Логируются решения аутентификации | ✅ | `login_success` / `login_failure` / `login_locked` | `events-journal.test.ts › wrong password → login_failure reason wrong_credentials WITH uid` |
| 7.2.2 Логируются отказы доступа | ⚠️ | Отказы API видны в строке лога (статус 401/403). Отказы правил Firestore нами не логируются. **Баг:** поле `errorCode` в логе заменяется на `[redacted]` (ключ содержит `code`, `log.ts:7`) | — |
| 7.3.1 Защита от инъекций в логи | ✅ | Структурированный JSON | — |
| 7.3.3 Защита и хранение логов | ⚠️ | Логи у Vercel; срок хранения и доступ не настроены отдельно | — |
| 7.4.1 Общее сообщение об ошибке + id | ✅ | `{error:{code, message, requestId}}`, у 500 — «Internal error» (`router.ts:169-184`) | `router.test.ts › a plain Error becomes 500 internal without leaking its message` |
| 7.4.2 Обработка ошибок везде | ✅ | Единый `try/catch` в роутере, журнал событий никогда не ломает вход | `events-journal.test.ts › a failing event sink never breaks auth` |
| 7.4.3 Последний обработчик ошибок | ✅ | `router.ts:169-187`, таймаут 8 с (`:118-126`) | `router.test.ts › answers 503 when a handler hangs…`, `› returns 500 internal (not a crash) when the env is invalid…` |

### V8. Защита данных

| Требование | Статус | Как сделано (где) | Доказательство (тест) |
|---|---|---|---|
| 8.1.1 / 8.2.1 Ответы API не кэшируются | ✅ | `Cache-Control: no-store` (`http.ts:126`, `router.ts:102`); Service Worker не кэширует Firebase/Google (`vite.config.js:101-128`) | `http.test.ts › writes status, security headers and the JSON body` |
| 8.2.2 Минимум чувствительного в хранилище браузера | ⚠️ | Сессия и мост не в storage (`inMemoryPersistence`, `src/firebase/config.js:48`); в `sessionStorage` только почта в процессе регистрации. Но офлайн-кэш Firestore (IndexedDB) хранит данные пользователя | — |
| 8.2.3 Очистка после выхода | ⚠️ | `signOutAndClear` удаляет IndexedDB и старые кэши SW (`src/firebase/account.js:36-61`). Если открыта вторая вкладка — кэш остаётся (выводится предупреждение) | — |
| 8.3.1 Чувствительное не в query | ✅ | Всё в теле JSON; исключение — OAuth `code`/`state` по протоколу; путь в логах без query (`router.ts:90-93`) | `oauth-google.test.ts › logs never contain the code, state, nonce, verifier, tokens, client secret or cookie values` |
| 8.3.2 Пользователь может удалить свои данные | ⚠️ | `POST account/delete` удаляет всё, включая аватар и запись Firebase Auth (`server/auth/accountOps.ts:130-152`). **Но** удаление может оборваться без возможности повторить (риск В2) | `account-stage7.test.ts › account deletion › success: everything of the user is gone…` |
| 8.3.4 Сроки хранения | ⚠️ | TTL на `expiresAt` для кодов, сессий, блокировок, событий — **политики TTL надо включить в консоли** | `events.test.ts › writes the documented shape with a 180-day TTL` |
| 8.3.x Минимизация | ✅ | Никаких полных IP, UA, кодов, токенов в базе | `events-journal.test.ts › every doc: … no email/password/code/token/cookie/UA/IP anywhere` |

### V9. Передача данных

| Требование | Статус | Как сделано (где) | Доказательство (тест) |
|---|---|---|---|
| 9.1.1 Только TLS | ✅ | Vercel HTTPS, HSTS 2 года + preload, `upgrade-insecure-requests` (`vercel.json:15-19`); в проде `APP_ORIGINS` обязаны быть https (`server/env.ts:33-37`) | `env.test.ts › accepts a valid production environment` |
| 9.1.2 Современные шифры | ✅ | Обеспечивает Vercel | — |
| 9.2.1 Исходящие соединения по TLS | ⚠️ | Google, HIBP, Resend — https; OAuth-запросы с `redirect: 'error'` (`google.ts:43`). `UPSTASH_REDIS_REST_URL` проверяется как URL, но **https не требуется** (`env.ts:79`) | `env.test.ts › rejects a non-URL UPSTASH_REDIS_REST_URL` |

### V13. API

| Требование | Статус | Как сделано (где) | Доказательство (тест) |
|---|---|---|---|
| 13.1.3 В URL нет секретов | ✅ | В `sessions/:id` — публичный id, не токен (`sessions.ts:40`) | `auth-flow.test.ts › each login issues a new token; GET sessions lists both … and no secrets` |
| 13.1.4 Авторизация на уровне ресурса | ✅ | Каждый обработчик сам вызывает `currentUser` | — |
| 13.1.5 Неожиданный Content-Type отклоняется | ✅ | Только `application/json`, иначе 415 (`http.ts:22-25`) | `http.test.ts › still enforces content-type on a pre-parsed body` |
| 13.2.1 Только нужные HTTP-методы | ✅ | 405 + `Allow`; HEAD для OAuth запрещён (`router.ts:77-87`) | `router.test.ts › wrong method on a known path → 405`, `› 405 lists the allowed methods in an Allow header` |
| 13.2.2 JSON-схема на входе | ✅ | zod | см. 5.1.3 |
| 13.2.3 CSRF для cookie-API | ✅ | см. 4.2.2 | см. 4.2.2 |
| 13.2.6 Доверие заголовкам | ✅ | IP берётся из `x-vercel-forwarded-for` только на Vercel; иначе — из сокета (`http.ts:83-88`) | `http.test.ts › off Vercel, ignores client-controlled forwarding headers…`, `› on Vercel, uses the edge-set x-vercel-forwarded-for…` |

### V14. Конфигурация

| Требование | Статус | Как сделано (где) | Доказательство (тест) |
|---|---|---|---|
| 14.1.x Автоматическая сборка и проверки | ⚠️ | Есть `typecheck`, `test`, `test:emulator`, `lint`, но **нет CI** (`.github/workflows` отсутствует) | — |
| 14.2.1 Зависимости без известных уязвимостей | ⚠️ | `npm audit --omit=dev`: 37 (5 high: `undici`, `@grpc/grpc-js` через `firebase`) | — |
| 14.2.3 SRI / нет внешних скриптов | ✅ | `script-src 'self'`, внешних скриптов нет (этап 9) | — |
| 14.3.2 Отладка выключена в проде | ✅ | Печать писем в консоль только в режиме эмулятора; режим эмулятора **запрещён** в preview/production (`env.ts:107-112`) | `env.test.ts › rejects FIRESTORE_EMULATOR_HOST together with VERCEL_ENV=production` |
| 14.3.3 Заголовки не раскрывают версии | ✅ | `/health` возвращает только `{ok:true}` (`server/routes/health.ts`) | `router.test.ts › GET /api/auth/health → 200 {ok:true}…` |
| 14.4.1 Content-Type с charset | ✅ | `application/json; charset=utf-8` | `http.test.ts › writes status, security headers and the JSON body` |
| 14.4.3 CSP | ⚠️ | Хорошая база (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`), но `style-src 'unsafe-inline'`, `img-src https:`, `connect-src https://*.googleapis.com` — шире, чем нужно (`vercel.json:15`) | — |
| 14.4.4 `X-Content-Type-Options: nosniff` | ✅ | `vercel.json` + `http.ts:127` | — |
| 14.4.5 HSTS | ✅ | `max-age=63072000; includeSubDomains; preload` | — |
| 14.4.6 Referrer-Policy | ✅ | `strict-origin-when-cross-origin`; на OAuth-редиректах `no-referrer` (`routes/oauth.ts:70`) | — |
| 14.4.7 Защита от встраивания во фрейм | ✅ | `frame-ancestors 'none'` + `X-Frame-Options: DENY` | — |
| 14.5.2 Origin не единственная защита | ✅ | Origin — дополнительный слой к SameSite и сессии, а не способ аутентификации | — |
| 14.5.3 CORS — белый список | ✅ | CORS-заголовков нет вовсе: API только для своего origin | — |

---

## 3. OWASP Top 10 (2021)

| Категория | Статус | Как закрыто |
|---|---|---|
| **A01 Нарушение контроля доступа** | ⚠️ | Deny-by-default в правилах, белый список коллекций, проверка uid на сервере, CSRF через Origin+SameSite, тесты IDOR. Остаток: правила принимают Firebase-токены, выданные не нашим сервером (риск В1); админ-страница без MFA |
| **A02 Криптографические ошибки** | ✅ | argon2id, HMAC с перцем для кодов, SHA-256 для токенов, AES-256-GCM для OAuth-cookie, сравнения за постоянное время, только CSPRNG, HTTPS+HSTS. Пароли без перца (2.4.5) — низкий риск |
| **A03 Инъекции** | ✅ | zod-схемы на всём входе, Firestore без строковых запросов, id документов — хэши, JSON-логи, письма только текстом, React экранирует вывод |
| **A04 Небезопасный дизайн** | ⚠️ | Сильный дизайн: модель угроз в плане миграции, защита от предрегистрации, привязка кодов к браузеру, «версия учётных данных». Остаток: нет MFA, почтовый код — основной фактор, удаление не возобновляется (В2), выход на одном устройстве не гасит мост сразу (С2) |
| **A05 Ошибки конфигурации** | ⚠️ | Env проверяется на старте, эмулятор запрещён в проде, security-заголовки, нет CORS. Остаток: включённые провайдеры Firebase Auth (В1), широкая CSP, TTL-политики и индексы ещё надо включить в консоли |
| **A06 Уязвимые компоненты** | ⚠️ | Минимум своих криптопримитивов, проверенные библиотеки. `npm audit`: 5 high в транзитивных зависимостях `firebase`; нет CI с автоматической проверкой |
| **A07 Ошибки аутентификации** | ⚠️ | Лимиты, блокировка, HIBP, одинаковые ответы, выравнивание времени, ротация сессий, повторная проверка пароля. Остаток: нет MFA/CAPTCHA, минимум 10 символов, долгие сессии, время ответа может «выдать» существование почты при медленной отправке писем (С5) |
| **A08 Целостность ПО и данных** | ✅ | Нет внешних скриптов, OAuth ID-токен проверяется по подписи (RS256 зафиксирован), OAuth-cookie запечатан AES-GCM, импорт пользователей — dry run по умолчанию |
| **A09 Журналирование и мониторинг** | ⚠️ | Журнал событий безопасности, структурированные логи без секретов, requestId. Остаток: нет алертов (например, всплеск `login_locked`), `errorCode` теряется в логах, `hibp_unavailable` не пишется |
| **A10 SSRF** | ✅ | Сервер ходит только на фиксированные адреса (Google, HIBP, Resend, Upstash); пользовательские URL не загружаются; `redirect: 'error'` |

---

## 4. Открытые риски и рекомендации

### 🔴 Высокий приоритет (закрыть до выката)

**В1. Включённые провайдеры Firebase Auth и «любой Firebase-токен» в правилах.**
Пока в Firebase Console включён вход Email/Password (а также Google/Phone/Anonymous), любой может через
публичный API-ключ (`accounts:signUp`) создать Firebase-учётку на **чужую** почту. Наш сервер считает
такую почту «занятой» (`server/auth/users.ts:84-100`, `server/auth/oauth/accounts.ts:61-70`, `:80-82`):
владелец почты получит письмо «у вас уже есть аккаунт», вход через Google вернёт `oauth_account_exists`,
а войти по коду/сбросить пароль нельзя (у нас записи нет). **Итог — владелец почты навсегда заблокирован.**
Кроме того, правила `firestore.rules:15-17`, `:30-33`, `:64-73` пускают к корневому профилю `users/{uid}`
любой Firebase-токен этого uid (не только наш custom token): для импортированных пользователей старый
пароль Firebase позволяет войти напрямую через REST Firebase в обход нашей блокировки и прочитать/изменить/удалить
корневой профиль (имя, телефон, дата рождения). Данные модулей защищены (нужен `bb_ev`).
По плану (`docs/auth-migration-plan.md`, «Порядок выката», шаг 5) провайдеры выключаются только через
1–2 недели после релиза — это окно риска.
*Что сделать:*
1. В день выката: Firebase Console → Authentication → Sign-in method — **выключить** Email/Password,
   Google, Phone, Anonymous (custom token продолжает работать без них). В Settings → User actions
   выключить «Enable create (sign-up)», если доступно.
2. В правилах принимать только наши токены: в `signedIn()` добавить
   `request.auth.token.firebase.sign_in_provider == 'custom'` (и то же в `storage.rules`) + тест.
3. Подумать: в `existsInLegacyAuth` считать «занятыми» только записи, созданные до даты импорта.

**В2. Удаление аккаунта может оборваться и не возобновляется.**
`deleteAccount` (`server/auth/accountOps.ts:130-152`) сначала делает аккаунт «мёртвым» (`status: 'deleting'`,
сдвиг `passwordChangedAt`, освобождение почты — `:97-107`), затем по шагам удаляет данные. У каждого запроса
лимит 8 с (`server/router.ts:118`), у Vercel — свой лимит длительности функции. У пользователя с большим
объёмом данных `recursiveDelete` может не успеть. Тогда клиент получит ошибку 503, а повторить удаление
**нельзя**: сессия уже недействительна (`routes/auth.ts:62`), вход для `status !== 'active'` закрыт, почта
освобождена. Личные данные (`users/{uid}/**`, сессии, события) остаются в базе без владельца — нарушение
«права на удаление».
*Что сделать:* (а) фоновая «доуборка» — Vercel Cron раз в час находит `users_auth` со `status: 'deleting'`
и заканчивает удаление (все шаги уже идемпотентны); и/или (б) для `account/delete` поднять таймаут и
`maxDuration` функции; (в) тест на эмуляторе: прерванное удаление дочищается.

**В3. Внешние сервисы прод-окружения ещё не настроены (Upstash, Resend, сервисный ключ).**
Без них `server/env.ts:75-85` не даст серверу стартовать — каждый запрос получит 500. Это правильное
поведение (fail closed), но блокер выката. Для Resend нужен подтверждённый домен (SPF/DKIM/DMARC),
иначе коды будут попадать в спам.

### 🟠 Средний приоритет (в ближайших итерациях)

**С1. Нет второго фактора (MFA/TOTP).** ASVS L2 (по духу NIST AAL2) ожидает MFA. Сейчас вход по коду из почты
сам по себе даёт полный доступ, а взлом почты = взлом BullBir. *Что сделать:* TOTP (приложение-аутентификатор)
как опция + коды восстановления; обязательно — для админов (`/admins`, 4.3.1).

**С2. Окно Firebase ID-токена после выхода на одном устройстве.** `logout` (`routes/auth.ts:184-195`) и
`DELETE sessions/:id` (`server/auth/sessions.ts:133-141`) удаляют сессию и отзывают refresh-токены, но **не**
повышают версию учётных данных. Украденное устройство, которое пользователь «отключил» в «Мои устройства»,
сохраняет доступ к Firestore до 1 часа (срок ID-токена), а заранее полученный custom token можно обменять в
течение часа. *Что сделать:* в `revokeSession` вызывать `bumpCredentialVersion(uid)` (остальные устройства
сами перевыпустят мост через `recoverBridge`); для обычного `logout` — по желанию, это «будит» другие вкладки.

**С3. Пароль от 10 символов, а ASVS 2.1.1 — от 12.** *Что сделать:* поднять `PASSWORD_MIN` до 12 для **новых**
паролей (вход со старыми 10–11 символами продолжит работать), обновить тексты в трёх языках.

**С4. Нет CAPTCHA — риск «почтовой бомбы» и спама.** Регистрация шлёт письмо на **любой** адрес (код или
«у вас уже есть аккаунт»): лимит 3/15 мин на адрес и 5/ч на IP, но с ботнетом это до ~290 писем в сутки на
одну жертву и удар по репутации домена Resend. *Что сделать:* Cloudflare Turnstile (или аналог) на регистрации,
запросе кода и сбросе пароля после превышения мягкого порога; добавить хост в CSP.

**С5. Выравнивание времени — 1 секунда, а отправка письма может быть дольше.** `withMinDuration`
(`server/auth/pacing.ts:4`, `:14-29`) дополняет ответ до 1 с. Если Resend отвечает дольше секунды, ответ для
существующей почты (`otp/request`, `password/reset-request`) станет заметно дольше, чем для несуществующей.
*Что сделать:* отправлять письмо **после** ответа (`waitUntil` из `@vercel/functions`) или через очередь;
либо мерить p95 Resend в проде и поднять пол.

**С6. Долгие сессии (7 дней без активности, 30 дней максимум).** ASVS L2 (3.3.2) ждёт 12 ч / 30 мин.
Для личного PWA это сознательный компромисс, и опасные действия всё равно требуют пароль. *Что сделать:*
записать решение в ADR; как минимум уведомлять письмом о входе с нового устройства.

**С7. Отказ в обслуживании через чужие лимиты.** Лимиты «на адрес» общие для всех IP: злоумышленник может
израсходовать за владельца сброс пароля (3/ч, `server/limits.ts:26`), коды входа (10/ч, `:18`) и проверки
регистрационного кода (10/ч, `routes/auth.ts:129`), а 5 неверных паролей блокируют вход паролем (обход —
вход по коду). Данные не утекают, но владелец может временно не войти. *Что сделать:* для блокировки по
паролю считать попытки отдельно для «знакомых» устройств; рассмотреть привязку счётчиков к challenge-cookie.

**С8. Зависимости.** `npm audit --omit=dev` — 5 high (`undici`, `@grpc/grpc-js`) через `firebase`.
*Что сделать:* обновить `firebase`/`firebase-admin` до свежих версий, прогнать тесты; добавить CI
(GitHub Actions: `typecheck`, `test`, `test:emulator`, `npm audit --audit-level=high`).

**С9. CSP шире, чем нужно.** `style-src 'unsafe-inline'` (нужен Framer Motion/inline-стилям),
`img-src https:` (любые картинки — канал утечки через запросы), `connect-src https://*.googleapis.com`
(любой поддомен Google API, в т.ч. чужие бакеты `storage.googleapis.com`). *Что сделать:* перечислить точные
хосты (`firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`,
`firebasestorage.googleapis.com`), сузить `img-src` до `'self' data: blob:` + хост Storage; добавить `report-to`.

### 🟢 Низкий приоритет

- **Н1. Пользователи «только с телефоном»** не переносятся (нет почты) — после выката не смогут войти
  (данные сохранятся). Решение владельца; нужен релиз 2b заранее и ручная процедура поддержки.
- **Н2. Политика повторной проверки для аккаунтов без пароля** (Google / код): смена почты и удаление
  требуют сначала задать пароль через сброс. Это строго и безопасно, но неудобно. В `docs/auth-api.md:24`,
  `:51`, `:53` описано **другое** поведение (`reauth_required`, «сессия моложе 10 минут», «аватар удаляет
  клиент») — код этого не делает. Исправить документацию или код.
- **Н3. Логи теряют код ошибки.** Ключ `errorCode` попадает под маску `/code/` (`server/log.ts:7`), поэтому
  в `router.ts:173` и `accountOps.ts:89` вместо кода пишется `[redacted]`. Переименовать поле (например
  `errorKind`) или сделать исключение.
- **Н4. Событие `hibp_unavailable` не пишется** (`server/auth/events.ts:32` объявлено, `password.ts:74-78`
  только логирует), хотя план это обещает. Добавить запись события (без uid).
- **Н5. Общий «кулдаун» у входа по коду и сброса пароля.** Оба используют одно правило `otp-send-cooldown`
  с одинаковым ключом (`routes/otpLogin.ts:65`, `routes/account.ts:81`): запросил код входа, а через 30 с —
  сброс → `429`. Развести имена ключей (`login:` / `reset:`).
- **Н6. Перец паролей (ASVS 2.4.5)** не применяется к хэшам паролей. Можно добавить HMAC-перец перед argon2
  для новых хэшей.
- **Н7. Привязка Google не отвязывается при смене почты** (`accountOps.ts:58-76`). Добавить в профиль список
  способов входа с кнопкой «отвязать».
- **Н8. `UPSTASH_REDIS_REST_URL` может быть `http://`** (`env.ts:79`) — требовать `https:`.
- **Н9. Офлайн-кэш Firestore** остаётся, если при выходе открыта вторая вкладка (`account.js:36-50`).
- **Н10. Устаревшие инструкции для ИИ-агентов.** `AGENTS.md:15-17`, `:40`, `:101-102` и `CLAUDE.md` (раздел
  PWA) пишут, что тестов нет, что `isVerified = emailVerified || (phoneNumber && !email)` и что ответы
  Firebase/Google кэшируются `NetworkFirst`. Всё это неправда и **опасно**: агент, следуя файлу, может вернуть
  обход проверки почты по телефону или кэширование личных данных в Service Worker. Обновить оба файла
  (CLAUDE.md в остальном актуален).
- **Н11. Preview-деплои Vercel** работают с теми же переменными, что и прод, если их не разделить → чужие ветки
  получают доступ к боевой базе. Задать для Preview отдельный Firebase-проект или не давать ему боевых секретов.

---

## 5. Что проверить перед выкатом

**Блокеры (без них не выкатывать)**

- [ ] Firebase Console → Authentication → Sign-in method: выключены Email/Password, Google, Phone, Anonymous; sign-up клиентами запрещён (риск В1).
- [ ] В `firestore.rules` и `storage.rules` добавлена проверка `sign_in_provider == 'custom'`, тесты правил зелёные (риск В1).
- [ ] Удаление аккаунта дочищается при обрыве (cron или повтор), есть тест (риск В2).
- [ ] В Vercel (Production) заданы: `FIREBASE_SERVICE_ACCOUNT_BASE64`, `UPSTASH_REDIS_REST_URL` (https), `UPSTASH_REDIS_REST_TOKEN`, `RESEND_API_KEY`, `MAIL_FROM`, `AUTH_PEPPER` (≥ 32 случайных байта, base64), `APP_ORIGINS` (только https), `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, 4 переменные `FIREBASE_HASH_*`; при Google-входе — `GOOGLE_CLIENT_ID/SECRET`.
- [ ] В Production **нет** `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST`.
- [ ] Домен Resend подтверждён (SPF, DKIM, DMARC); тестовое письмо дошло во «Входящие».
- [ ] `firebase deploy --only firestore:rules,firestore:indexes,storage` выполнен (индекс `security_events (uid ASC, at DESC)`).
- [ ] TTL-политики Firestore включены на поле `expiresAt` для `otp_codes`, `sessions`, `auth_throttle`, `security_events`.

**Проверки после настройки**

- [ ] `npm run typecheck`, `npm test`, `npm run test:emulator`, `npm run lint`, `npm run build` — всё зелёное.
- [ ] `npm audit --omit=dev` — нет high/critical (обновить `firebase`, `firebase-admin`).
- [ ] `GET /api/auth/health` в проде → `{"ok":true}`; заголовки ответа: CSP, HSTS, `nosniff`, `X-Frame-Options`, `Cache-Control: no-store`.
- [ ] Вручную в проде: регистрация → код → вход; неверный пароль 5 раз → 429; вход по коду снимает блокировку; сброс пароля; «выйти везде» — на втором устройстве Firestore отказывает сразу.
- [ ] POST на `/api/auth/login` с чужим `Origin` (curl) → 403 `origin_rejected`.
- [ ] Google OAuth: в Google Cloud Console redirect URI ровно `https://<домен>/api/auth/oauth/google/callback`; приложение опубликовано (не Testing).
- [ ] В логах Vercel после ручного прогона нет паролей, кодов, токенов, cookie, полных почт.
- [ ] Ключ сервисного аккаунта для импорта (stage 3) удалён после импорта (`docs/migration-runbook.md`).
- [ ] Preview-окружение Vercel не использует боевые секреты и базу (Н11).
- [ ] `AGENTS.md` и раздел PWA в `CLAUDE.md` обновлены (Н10); `docs/auth-api.md` совпадает с кодом (Н2).
- [ ] Настроены оповещения: всплеск `login_locked` / `rate_limited`, 503 от лимитера или почты.
- [ ] Пользователям «только телефон» заранее показан баннер (релиз 2b), подготовлен ответ поддержки (Н1).
