# Вход через Google — настройка ключей

Наш сервер сам проводит вход через Google (OAuth 2.0 / OpenID Connect с PKCE). Для этого нужны
два значения из Google Cloud Console: **Client ID** и **Client Secret**. Ниже — пошагово.

## 1. Проект в Google Cloud

1. Откройте <https://console.cloud.google.com/> и войдите в Google-аккаунт, которым владеет проект.
2. Сверху выберите проект (можно тот же, что у Firebase — он там уже есть) или создайте новый.

## 2. Экран согласия (OAuth consent screen)

1. Меню → **APIs & Services → OAuth consent screen** (в новой консоли: **Google Auth Platform → Branding**).
2. Тип пользователей: **External** (Внешние).
3. Заполните:
   - **App name**: `BullBir`
   - **User support email**: ваша почта
   - **App logo** — по желанию (логотип потребует проверки Google, можно позже)
   - **App domain / Home page**: `https://<ваш-домен>`
   - **Privacy policy** и **Terms of service** — ссылки на страницы на вашем домене
   - **Authorized domains**: ваш домен, например `bullbir.app` (без `https://`)
   - **Developer contact**: ваша почта
4. **Scopes (Data access)** → Add or remove scopes → отметьте только три:
   - `openid`
   - `.../auth/userinfo.email` (`email`)
   - `.../auth/userinfo.profile` (`profile`)

   Это «несекретные» scopes — проверка приложения Google для них не нужна.
5. **Test users**: пока приложение в статусе *Testing*, войти смогут только добавленные сюда
   адреса. Добавьте свои для проверки.
6. Когда всё проверено — **Publish app** (статус *In production*), чтобы войти мог любой.

## 3. Создать OAuth Client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   (в новой консоли: **Google Auth Platform → Clients → Create client**).
2. **Application type**: **Web application**. Имя: `BullBir web`.
3. **Authorized JavaScript origins** — можно оставить пустым (вход идёт через сервер).
4. **Authorized redirect URIs** — добавьте **точно** (до символа, без слэша в конце):
   - прод: `https://<ваш-домен>/api/auth/oauth/google/callback`
   - локальная разработка: `http://localhost:5173/api/auth/oauth/google/callback`
5. **Create** → появится окно с **Client ID** и **Client Secret**. Скопируйте оба.
   Secret потом можно посмотреть/перевыпустить на странице клиента.

> Google разрешает `http://` только для `localhost`. Для превью-доменов Vercel
> (`*.vercel.app`) каждый адрес надо добавлять отдельно — маски не поддерживаются.

## 4. Куда положить ключи

| Переменная | Значение |
|---|---|
| `GOOGLE_CLIENT_ID` | `…apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | секрет клиента |
| `OAUTH_REDIRECT_BASE` | *(необязательно)* адрес сайта, например `https://bullbir.app`. Должен быть одним из `APP_ORIGINS`. Если не задан — берётся первый адрес из `APP_ORIGINS`. |

**Vercel (прод):** Project → **Settings → Environment Variables** → добавить три переменные для
окружения **Production** (и **Preview**, если там тоже нужен вход через Google) → **Redeploy**.

**Локально:** в файл `.env.local` в корне проекта (он в `.gitignore`):

```
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
```

Для локальной разработки удобно завести **отдельный** OAuth-клиент только с `localhost`
в redirect URIs — тогда прод-секрет никогда не попадает на ваш компьютер.

Если ключей нет, кнопка «Войти через Google» просто вернёт на страницу входа с сообщением
«вход через Google временно недоступен» — остальной вход работает.

## 5. Чего НЕ делать

- **Не** коммитьте `GOOGLE_CLIENT_SECRET` в git и не вставляйте его в код клиента, в `VITE_*`
  переменные, в чаты и скриншоты. Утёк — сразу **Reset secret** в консоли и обновите Vercel.
- **Не** добавляйте лишние redirect URIs «на всякий случай» и не используйте чужие домены —
  каждый лишний адрес — потенциальная точка перехвата кода.
- **Не** включайте дополнительные scopes (Gmail, Drive, контакты) — нам нужны только
  `openid email profile`; лишние scopes требуют проверки Google и пугают пользователей.
- **Не** используйте тип клиента *Android/iOS/Desktop* — только **Web application**.
- **Не** переиспользуйте клиент от Firebase Auth (`…firebaseapp.com/__/auth/handler`) для нового
  входа — после миграции его удалим; заведите отдельный клиент.
- **Не** выключайте проверку почты: сервер привязывает Google к существующему аккаунту только если
  почта подтверждена **и** у Google, **и** у нас. Это защита от захвата аккаунта.

## 6. Проверка

1. Запустите `npm run dev`, откройте `http://localhost:5173/login`, нажмите «Войти через Google».
2. Должна открыться страница выбора аккаунта Google, затем — возврат в `/app`.
3. Ошибки приходят как `/login?error=…`:
   `oauth_cancelled` (отменили), `oauth_link_unverified` (почта не подтверждена у нас),
   `oauth_unavailable` (нет ключей), `oauth_failed` (прочее — смотрите логи сервера по `requestId`).
   Ошибка Google `redirect_uri_mismatch` значит, что адрес в шаге 3.4 не совпадает символ в символ.
