# vshp_redactor

Веб-приложение для работы с библиотекой материалов и тестами (загрузка, предпросмотр, редактирование) с автоматизацией через модуль `vshp_editor`.

В этом README описано, какие **паттерны** применены в проекте и **в каких файлах** их искать. Список паттернов взят из презентации «Паттерны»: 5 паттернов ведения кода и 5 паттернов проектирования системы.

---

## Структура проекта (кратко)

```
apps/
  frontend/          # интерфейс: шаблоны, статика, views/urls
    static/js/library/   # клиентская логика страницы «Библиотека»
    static/js/tester/    # клиентская логика страницы «Тестер»
    templates/           # HTML-шаблоны
  main/              # серверная часть: модели, views, tools
    tools/library.py     # мост между веб-приложением и модулем vshp_editor
config/              # настройки, расширения, команды
migrations/          # миграции БД (Alembic)
modules/vshp_editor/ # автономный модуль автоматизации
  core/                  # auth.py, browser.py
  modules/library/       # actions, service, uploader
  modules/tester/        # beta, release, service
  legacy/                # старые версии кода
```

---

# Часть 1. Паттерны проектирования системы

## 1. MVC (Model–View–Controller)

Применяется в обоих приложениях: `apps/main` и `apps/frontend`.

| Роль | Где в проекте |
|---|---|
| **Model** | `apps/main/models.py`, `apps/frontend/models.py`, миграции в `migrations/versions/` |
| **View** | HTML-шаблоны `apps/frontend/templates/` (`index.html`, `library.html`, `tester.html`, базовый `extensions/base.html`) + стили и скрипты в `apps/frontend/static/` |
| **Controller** | `apps/main/views.py`, `apps/frontend/views.py`; маршрутизация — `apps/main/urls.py`, `apps/frontend/urls.py` |

Поток: запрос → `urls.py` → функция в `views.py` (контроллер) → обращение к моделям → отрисовка шаблона.

## 2. MVP (Model–View–Presenter)

Применяется на клиенте, в JS-коде страниц `library` и `tester`. Каждая страница разбита на файлы по ролям:

| Роль | `static/js/tester/` | `static/js/library/` |
|---|---|---|
| **Model** (состояние) | `state.js` | `state.js` |
| **View** (отрисовка DOM) | `render.js`, `editor.js` | `preview.js` |
| **Presenter** (реакция на действия, связь Model и View) | `actions.js` | `fs.js`, `uploader.js` |
| Точка входа / настройки | `init.js`, `conf.js` | `init.js`, `conf.js` |

Общий код для обеих страниц — `static/js/cammon.js`.

Поток: пользователь жмёт кнопку → `actions.js` меняет `state.js` и обращается к серверу через `api.js` → вызывает `render.js`, чтобы обновить интерфейс. View сама с состоянием не работает.

## 3. Адаптер

Адаптеры скрывают «неудобный» интерфейс внешней системы за простым интерфейсом проекта.

| Адаптер | Что оборачивает | Где |
|---|---|---|
| Браузерный адаптер | Управление браузером (открытие страниц, клики, ввод) | `modules/vshp_editor/core/browser.py` |
| Адаптер авторизации | Вход на внешний сайт | `modules/vshp_editor/core/auth.py` |
| Сервисы модулей | Низкоуровневые действия сайта → понятные операции «загрузить файл», «обновить тест» | `modules/vshp_editor/modules/library/service.py`, `modules/vshp_editor/modules/tester/service.py` |
| Мост «приложение ↔ модуль» | Вызовы `vshp_editor` из веб-приложения | `apps/main/tools/library.py` |
| Клиентский API-слой | HTTP-запросы к серверу → обычные JS-функции | `apps/frontend/static/js/tester/api.js` |

Версии `beta.py` и `release.py` в `modules/tester/` работают с разными версиями сайта, но предоставляют одинаковый интерфейс — остальной код не знает, какая из них используется.

---

# Часть 2. Паттерны ведения кода

Эти паттерны относятся к **JavaScript-коду** (`apps/frontend/static/js/`).

## 1. Базовая деструктуризация объекта

**apps/frontend/static/js/library/fs.js**

```js
import { API } from './conf.js';

const { list, deleteFiles, rename, move, addFolder, download } = API;
```

**apps/frontend/static/js/tester/api.js**

```js
import { apiFetch } from '../cammon.js';

import {API} from './conf.js';

const {list, create, update, remove, run} = API;

export async function apiList() {

const d = await apiFetch(list);

if (Array.isArray(d)) return d;

return d?.data || d?.tests || d?.items || [];

}

export const apiSave = p => apiFetch(create, { method: 'POST', body: { id: p.id, questions: p.questions } });

export const apiCreate = p => apiFetch(update, { method: 'POST', body: { id: p.id, questions: p.questions } });

export const apiDelete = id => apiFetch(remove, { method: 'DELETE', body: { id } });

export const apiRun = id => apiFetch(run, { method: 'POST', body: { id } });
```



