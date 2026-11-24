# vshp_api

Автоматизация работы с ERP `erp.vshp.online`:

* **заливка вопросов в тесты** (`fill_test`);
* **проверка файлов вопросов локально и на сайте** (`local_check`, `scan_test`);
* **работа с библиотекой материалов** (`collect`, `exchange`, `scan_library`, `upload`);
* **загрузка PDF-презентаций**.

Проект состоит из двух слоёв:

1. **CLI** (`main.py`) — интерактивное меню `questionary` для ручной работы;
2. **HTTP API** (Flask) — те же сценарии, доступные по REST, с фоновыми задачами
   (pause / resume / cancel) и общей блокировкой файлов вопросов.

Оба слоя используют один и тот же слой бизнес-логики — `Port`
(`modules/vshp_editor/port.py`), который запускает `ProcRunner` в отдельном
процессе, следит за очередью и ведёт реестр задач в памяти.

---

## Содержание

- [Структура проекта](#структура-проекта)
- [Установка](#установка)
- [Настройка (`.env`)](#настройка-env)
- [Запуск CLI](#запуск-cli)
- [Запуск HTTP API](#запуск-http-api)
- [API: эндпоинты](#api-эндпоинты)
  - [Задачи (jobs)](#задачи-jobs)
  - [Тесты](#тесты)
  - [Библиотека — материалы на вход](#библиотека--материалы-на-вход)
  - [Библиотека — файлы на загрузку](#библиотека--файлы-на-загрузку)
  - [Библиотека — ссылки на скан](#библиотека--ссылки-на-скан)
  - [Tester (движки)](#tester-движки)
  - [Library (движки)](#library-движки)
  - [Конфигурация](#конфигурация)
- [Формат файлов вопросов](#формат-файлов-вопросов)
- [Модель задач и блокировок](#модель-задач-и-блокировок)
- [Данные в `data/`](#данные-в-data)
- [Тесты без сети](#тесты-без-сети)
- [Безопасность](#безопасность)

---

## Структура проекта

```
main.py                     # точка входа CLI (questionary)
run.py                      # точка входа Flask (create_app → app.run)
config.py                   # конфиг CLI: сайт, доступы, тайминги, пути
log.py                      # единое логирование: консоль + logs/vshp_editor.log

core/
  browser.py                # browser_session() — запуск/закрытие браузера
  auth.py                   # Auth.ensure_login() — логин, если сессия протухла

modules/
  tester/
    release.py              # стабильный движок заливки (Actions)
    beta.py                 # beta: наследник release, ускоренная навигация
    service.py              # сценарии: local_check / scan_test / fill_test
  library/
    actions.py              # действия с библиотекой материалов
    uploader.py             # MaterialUploader — загрузка PDF
    service.py              # сценарии: collect / exchange / scan / upload
  vshp_editor/
    port.py                 # Port + ProcRunner — единый слой бизнес-логики
    views.py                # HTTP-вьюхи (тонкая обёртка над Port)
    urls.py                 # Blueprint, регистрация URL-правил
    __init__.py             # bp + get_port()

apps/
  __init__.py
  main/
    views.py                # те же вьюхи (Django-style: apps/main)
    urls.py                 # bp для apps/main

data/
  questions/*.json          # файлы вопросов (вход для заливки)
  library_links.json        # ссылки для collect
  materials_input.json      # задачи для exchange
  upload_tasks.json         # задачи для upload
  tests_progress.json       # прогресс заливки (обновляется автоматически)
  tests_out.json            # результат scan_test

tests/
  test_offline.py           # офлайн-проверка логики (без сети)

migrations/                 # Alembic (если используется БД)
.env                        # конфиг среды (создаётся из .env.example)
requirements.txt
```

---

## Установка

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt
playwright install chromium      # один раз — скачивает браузер

cp .env.example .env             # задать логин/пароль/тайминги
```

> **Python ≥ 3.11** — из-за `str | Path` и `Path | None` в сигнатурах.

Для быстрого развёртывания каркаса (без бизнес-логики) есть
`setup_project.sh` / `setup_project.bat`: создаёт `config/`, `apps/`,
`run.py`, генерирует `.env`, ставит `flask flask-sqlalchemy flask-migrate
python-dotenv`, добавляет команды `flask startapp`, `flask makemigrations`,
`flask migrate`, `flask rollback`, `flask showmigrations`, `flask help`.

---

## Настройка (`.env`)

Все настройки — в `.env` (см. `.env.example`):

```ini
# сайт
VSHP_BASE_URL=https://erp.vshp.online
VSHP_LOGIN=...
VSHP_PASSWORD=...

# поведение
VSHP_HEADLESS=true
VSHP_LOG_LEVEL=INFO

# тайминги (мс)
VSHP_T_FORM=1800         # пауза после открытия формы
VSHP_T_QUESTION=2000     # пауза после ввода текста вопроса
VSHP_T_FIELD=1500        # пауза после создания поля варианта
VSHP_T_VARIANT=1500      # пауза после ввода варианта
```

`Port.get_config()` и `Port.set_config()` читают/пишут `.env` — это позволяет
менять настройки через `GET/PUT /api/get_config`, `PUT /api/set_config`
(применяются после рестарта процесса).

---

## Запуск CLI

```bash
python main.py
```

Меню:

```
VSHP editor — что делаем?
» Тесты — залить вопросы в тест
» Тесты — проверить файл локально (без сети)
» Тесты — сканировать тест (только чтение)
» Библиотека — собрать ссылки на материалы без файла
» Библиотека — заменить файлы
» Библиотека — сканировать библиотеку
» Библиотека — загрузить PDF-презентации
» Показать журнал
» Показать конфигурацию
» Выход
```

**Сценарии, которые пишут на сайт** (`fill_test`, `exchange`, `upload`)
показывают, что именно уйдёт, и требуют подтверждения `default=False`.
Перед заливкой можно выбрать «только 1 / только 3 вопроса» — пробный запуск.

---

## Запуск HTTP API

```bash
python run.py
# или
flask --app run run --host 127.0.0.1 --port 5000
```

`run.py`:

```python
from config import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host=app.config["HOST"], port=app.config["PORT"], debug=app.config["DEBUG"])
```

Префикс всех эндпоинтов — **`/api/`**.

---

## API: эндпоинты

Все POST/PUT принимают `application/json`.
Ошибки `Port` → HTTP:

| Исключение `Port` | HTTP |
|---|---|
| `KeyError`, `FileNotFoundError` | **404** |
| `ValueError`, `RuntimeError` (файл занят) | **400** |
| всё остальное | **500** |

Асинхронные операции (запуск задачи) возвращают **202** + `{"job_id": "..."}`.

### Задачи (jobs)

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/api/list_jobs` | список всех задач с текущим состоянием |
| `GET` | `/api/get_job/<job_id>` | статус одной задачи (`state`, `result`, `error`) |
| `POST` | `/api/pause_job/<job_id>` | `SIGSTOP` процессу и потомкам |
| `POST` | `/api/resume_job/<job_id>` | `SIGCONT` |
| `POST` | `/api/cancel_job/<job_id>` | kill + удаление из реестра |
| `DELETE` | `/api/cancel_job/<job_id>` | то же |
| `POST` | `/api/cancel_all_jobs` | убить все активные задачи |
| `POST` | `/api/clear_finished_jobs` | удалить записи о `done`/`error` |

Состояния задачи: `running` → `paused` → `running` → `done` / `error` / `cancelled`.

### Тесты

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/api/get_list_tests` | все `data/questions/*.json` с содержимым |
| `GET` | `/api/get_list_tests?id=5` | конкретный `test_5.json` |
| `POST` | `/api/get_list_tests` `{"id": 5}` | то же, через тело |
| `POST` | `/api/add_test` | `{"id": 5, "questions": [...]}` — создать/перезаписать |
| `DELETE` | `/api/delete_test/<test_id>` | удалить файл |

> ⚠️ `add_test` и `delete_test` не сработают, если с файлом уже работает
> какая-то задача (`fill_test`, `local_check`, `scan_test`) — вернётся **400**.

### Библиотека — материалы на вход

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/api/get_materials_input` | содержимое `data/materials_input.json` |
| `PUT` | `/api/set_materials_input` | `{"materials": [...]}` — перезаписать |
| `DELETE` | `/api/clear_materials_input` | очистить (`[]`) |

### Библиотека — файлы на загрузку

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/api/get_upload_files` | `data/upload_tasks.json` |
| `PUT` | `/api/set_upload_files` | `{"files": [...]}` — перезаписать |
| `POST` | `/api/add_upload_files` | `{"files": [...]}` — дописать |
| `DELETE` | `/api/clear_upload_files` | очистить |

### Библиотека — ссылки на скан

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/api/get_links_for_scan` | `data/library_links.json` |
| `PUT` | `/api/set_links_for_scan` | `{"links": ["url1", "url2"]}` |
| `DELETE` | `/api/clear_links_for_scan` | очистить |

### Tester (движки)

Все возвращают **202** с `{"job_id": "..."}`.

| Метод | URL | Тело | Движок |
|---|---|---|---|
| `GET` | `/api/tester/pick` | — | список доступных файлов вопросов |
| `POST` | `/api/tester/fill` | `{"path": "test_5.json", "engine": "release", "resume": true, "limit": 3, "verify_remote": true}` | `release` / `beta` |
| `POST` | `/api/tester/local_check` | `{"path": "test_5.json"}` | без сети |
| `POST` | `/api/tester/scan` | `{"path": "test_5.json"}` | только чтение |

### Library (движки)

| Метод | URL | Тело | Описание |
|---|---|---|---|
| `POST` | `/api/library/collect` | `{"urls": [...]}` | собрать материалы |
| `POST` | `/api/library/exchange` | `{"file_data": "..."}` | заменить файлы |
| `POST` | `/api/library/scan` | `{"urls": [...]}` | сканировать библиотеку |
| `POST` | `/api/library/upload` | `{"files": [...]}` | загрузить PDF |

### Конфигурация

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/api/get_config` | `.env` в виде JSON |
| `PUT` | `/api/set_config` | обновить ключи `.env` (применяется после рестарта) |

### Примеры `curl`

```bash
# список тестов
curl http://127.0.0.1:5000/api/get_list_tests

# конкретный тест
curl "http://127.0.0.1:5000/api/get_list_tests?id=5"

# добавить тест
curl -X POST http://127.0.0.1:5000/api/add_test \
     -H 'Content-Type: application/json' \
     -d '{"id":5,"questions":[{"question":"2+2?","variants":["3","4"],"answer":["4"]}]}'

# залить первые 3 вопроса
curl -X POST http://127.0.0.1:5000/api/tester/fill \
     -H 'Content-Type: application/json' \
     -d '{"path":"test_5.json","limit":3,"resume":true}'
# → {"job_id":"fill_test_1"}

# следить за задачей
curl http://127.0.0.1:5000/api/get_job/fill_test_1

# поставить на паузу / снять
curl -X POST http://127.0.0.1:5000/api/pause_job/fill_test_1
curl -X POST http://127.0.0.1:5000/api/resume_job/fill_test_1

# отменить
curl -X DELETE http://127.0.0.1:5000/api/cancel_job/fill_test_1
```

---

## Формат файлов вопросов

`data/questions/test_*.json`:

```json
{
  "id": "test_1398",
  "url": "https://erp.vshp.online/tests/tests/1398/questions",
  "questions": [
    {
      "question": "Текст вопроса?",
      "answer": ["Верный вариант"],
      "variants": ["Неверный", "Верный вариант", "Ещё"]
    }
  ]
}
```

Проверяется **до** отправки (`validate_test`):

* ≥ 2 вариантов ответа;
* нет пустых вариантов;
* нет дубликатов вариантов;
* верный ответ входит в варианты;
* нет дубликатов вопросов.

Если файл не проходит проверку — `fill_test` падает с `VerifyError`, ничего не
отправляя на сайт.

---

## Модель задач и блокировок

`Port` — единый менеджер задач:

* `jobs: dict[str, ProcRunner]` — реестр активных задач;
* `_counter: itertools.count(1)` — генератор id (`fill_test_1`, `scan_2`, …);
* `atexit.register(self.shutdown)` — при выходе процесса убивает всех детей.

Каждая задача — отдельный `mp.Process` (daemon). `ProcRunner`:

* `start()` — запуск + `psutil.Process` для управления потомками;
* `pause()`/`resume()` — `SIGSTOP`/`SIGCONT` **всему дереву** процессов
  (браузер, драйверы Playwright);
* `cancel()` — `SIGKILL` дереву, `join(timeout=2)`, закрытие очереди;
* `refresh()` — неблокирующее чтение `mp.Queue` (`get_nowait`), результат
  `("done", value)` или `("error", traceback)`;
* `active` — `True` пока `running` или `paused`.

### Блокировки файлов

`Port._start_job(..., lock=path)`:

1. `_assert_free(lock)` — если файл занят другой активной задачей, поднимает
   `RuntimeError` («Файл занят задачей X»);
2. `_norm(path)` — канонизирует путь, чтобы `test_5.json` и абсолютный путь
   считались одним файлом;
3. `runner.lock = lock_path` — блокировка действует с момента запуска.

Это не даёт запустить два `fill_test` на один и тот же `test_5.json` и не даёт
`delete_test` / `add_test` перезаписать файл, пока с ним работает задача.

---

## Данные в `data/`

| Файл | Кто пишет | Что внутри |
|---|---|---|
| `questions/*.json` | вручную / `add_test` | вход для `fill_test` |
| `library_links.json` | `set_links_for_scan` | ссылки для `collect` |
| `materials_input.json` | `set_materials_input` | задачи для `exchange` |
| `upload_tasks.json` | `set_upload_files` / `add_upload_files` | задачи для `upload` |
| `tests_progress.json` | `service._save_progress` | прогресс заливки (по `id` теста) |
| `tests_out.json` | `service.scan_test` | результат скана: локально/на сайте |

`tests_progress.json` обновляется **после каждого сохранённого вопроса**, поэтому
при падении/остановке заливка продолжится с того же места при следующем запуске
(`resume: true`).

---

## Тесты без сети

```bash
python tests/test_offline.py
```

Проверяет логику `fill_question` / `verify` на фейковой странице:

* порядок действий и пауз (форма → вопрос → пауза → поле варианта → пауза → текст → пауза → проверка);
* детекция расхождений (`verify` → `_repair`) с повторными попытками;
* отклонение некорректных данных (`< 2 вариантов`, верный ответ не в вариантах,
  пустой `answer`).

Ни одного обращения к сайту. В конце печатает `ВСЕ ОФЛАЙН-ТЕСТЫ ЛОГИКИ ПРОШЛИ`.

---

## Безопасность

* «Проверить файл локально» **не ходит в сеть** вообще.
* «Сканировать» — только чтение с сайта.
* Сценарии, которые **пишут** на сайт (`fill_test`, `exchange`, `upload`),
  всегда показывают, что именно уйдёт, и требуют подтверждения с `default=False`.
* `Port` не запускает задачу, если файл уже занят другой задачей — параллельная
  перезапись `test_5.json` невозможна.
* `.env` содержит пароль — он в `.gitignore`. `.env.example` — безопасный шаблон.

---

## Известные ограничения

* `Port.jobs` живёт **в памяти процесса**. При `gunicorn --workers N` без
  `--preload` каждый воркер получит свой `Port` — задачи и блокировки
  не будут общими. Для продакшена — один воркер (`--workers 1 --threads N`)
  или вынести состояние в Redis.
* `refresh()` не потокобезопасен: два одновременных `GET /list_jobs` могут
  «съесть» результат друг у друга. В dev-сервере Flask (`threaded=True`)
  это теоретически возможно; при необходимости — оберните в `threading.Lock`.
* `set_config` пишет `.env`, но процесс не перечитывает его автоматически —
  изменения применятся после рестарта.
* `get_list_tests(id=5)` на несуществующий файл возвращает **200** со списком
  `[{"file": "test_5.json", "error": "Файл не найден"}]`, а не 404.
  Так удобнее для UI; если нужен строгий 404 — проверяйте явно.

