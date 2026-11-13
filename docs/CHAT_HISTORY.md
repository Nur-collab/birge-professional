# История рабочей сессии

Дата: **2026-11-13**

Это не дословный экспорт интерфейса, а сохранённая структурированная история
запросов, решений и результатов. Полный контекст проекта — в
`docs/HANDOFF.md`.

## Участники и цель

Пользователь попросил профессионально доработать проект **Birge** (карпулинг
в Бишкеке), не изменяя оригинальные папки. Все изменения должны были идти в
отдельной копии, с проверками и отчётом на русском.

## Хронология

### 1. Профессионализация и отдельная копия

Запрос:

> Прочитать глобальные протоколы, начать внедрение, сохранить исправленную
> версию в другую папку и не трогать оригинал.

Сделано:

- создана копия `birge-professional` рядом с оригиналами;
- оригинальные `birge` и `birge-backend` оставлены без изменений;
- добавлены README, roadmap, migration guide, CI, `.env.example`;
- зависимости зафиксированы;
- удалён мёртвый frontend-код;
- добавлены security guards, CORS из env, refresh JWT, WS tickets,
  серверная загрузка фото;
- внедрён Alembic, baseline и миграция индексов;
- добавлены backend/frontend-тесты;
- исправлен Windows-баг с cp1251 и эмодзи в `print()`.

### 2. Production build, Procfile и первый роутер

Запрос:

> Исправить production-сборку, чтобы она не брала локальный `VITE_API_URL`
> из `.env.local`; вынести `alembic upgrade head` из web-команды Procfile;
> начать выносить роутеры из `main.py`.

Сделано:

- `.env.local` переименован в `.env.development.local`;
- в `vite.config.js` добавлен fail-fast для localhost в production;
- production build проверен: локального URL в `dist` нет;
- dev build по-прежнему использует локальный URL;
- Procfile разделён на `release:` и `web:`;
- создан `routers/auth.py`;
- созданы `config.py`, `dependencies.py`, `time_utils.py`;
- OpenAPI и backend-тесты проверены.

### 3. Проверка статуса P0

Запрос:

> Из P0 всё сделал?

Ответ: нет. 13 пунктов из 14 закрыты, разделение `main.py`/`App.jsx`
оставалось частичным. Отмечены оговорки: CI не запускался на GitHub,
ImgBB/Telegram не проверялись реально, production deploy не выполнялся.

### 4. Users-роутер

Запрос:

> Вынести users-роутер в `routers/users.py`, сохранить API, прогнать тесты
> и проверить OpenAPI.

Сделано:

- создан `routers/users.py` с 8 операциями;
- создан `dependencies.py` для общих auth-зависимостей;
- создан `time_utils.py` для времени Бишкека;
- из `main.py` удалён users-блок;
- обновлены unit-тесты и OpenAPI-тест;
- проверены все users-пути, методы и схемы `User`/`UserPublic`;
- живой `/health` и `/openapi.json` — 200.

### 5. HTTP-регрессия users и trips-роутер

Запрос:

> Добавить HTTP-регрессионные тесты для users-роутов, затем вынести
> trips-роутер, сохранив поведение API.

Сделано:

- добавлен `tests/test_users_http.py` на 5 тестов, покрывающих все 8
  users-операций;
- создан `routers/trips.py` с 10 операциями (поездки, чат, платёжные реквизиты);
- создан `realtime.py` с WebSocket/SSE managers и `is_trip_participant`;
- `main.py` сокращён примерно с 2074 до 1383 строк;
- обновлены импорты тестов;
- добавлены OpenAPI- и HTTP-проверки trips;
- итог: **29 backend-тестов passed**, ruff passed, живые `/health` и
  `/openapi.json` — 200.

### 6. Сохранение контекста

Запрос:

> Сохранить чат и всё сделанное в папку, чтобы продолжить с другого аккаунта,
> и указать, куда сохранена копия Birge.

Сделано:

- создан этот файл;
- создан `docs/HANDOFF.md` с полным состоянием, командами и следующими шагами;
- в README добавлена ссылка на handoff;
- секреты и ключи в документы не включались.

### 7. Закрытие P0: роуты и hooks

Запрос:

> Прочитай `docs/HANDOFF.md`, `docs/CHAT_HISTORY.md` и `docs/ROADMAP.md`.
> Продолжай с незакрытых пунктов P0, не меняя API без необходимости.

Сделано:

- создан `routers/trip_requests.py`: POST/GET/PATCH заявок, статус и оба SSE-стрима;
- создан `routers/chat.py`: WebSocket `/ws/chat/{trip_id}/{user_id}`;
- `main.py` сокращён с 1383 до ~900 строк; в нём остались reviews, Telegram/internal, admin cleanup и lifecycle;
- `App.jsx` сокращён с 812 до 418 строк; логика вынесена в `src/hooks/*` и `src/utils/tripStorage.js`;
- API-пути, методы и response-модели не менялись;
- добавлены OpenAPI-проверки trip-request путей, HTTP-сценарий заявки и проверка регистрации WS;
- проверки: ruff passed, pytest 31 passed, npm test 6 passed, npm run build passed, /health 200, /openapi.json 200.

## Ключевые решения

- Все правки — только в `birge-professional`.
- API-пути и response-модели сохраняются; изменения проверяются HTTP-тестами
  и OpenAPI.
- Схема БД управляется Alembic, без `create_all` в production.
- Access-токен 60 минут, refresh 30 дней; WS использует отдельный ticket.
- CORS — явный allowlist из env.
- Админские операции — только по `ADMIN_PHONES`.
- Internal sync endpoint выключен по умолчанию.
- ImgBB-ключ живёт только на backend.
- Production frontend не должен содержать localhost.
- Realtime пока single-process; Redis — P1.

## Что осталось

- P0 закрыт: WS/SSE, trip-request и `App.jsx` разделены;
- в `main.py` остались reviews, Telegram/internal, admin cleanup и lifecycle;
- следующий этап — P1 (Redis, rate limiting, observability, staging/backup);
- P2 — см. `docs/ROADMAP.md`.
