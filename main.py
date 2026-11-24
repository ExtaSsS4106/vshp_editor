#!/usr/bin/env python3
"""vshp_editor — единая консольная программа: тесты, библиотека, загрузка PDF.

Запуск:  python main.py
Всё взаимодействие — через questionary-меню; логи пишутся в logs/vshp_editor.log.

Правила безопасности:
  * «проверить файл локально» вообще не ходит в сеть;
  * «залить вопросы» и «заменить файлы»/«загрузить PDF» требуют явного
    подтверждения с указанием, что именно уйдёт на сайт.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import questionary
from questionary import Choice

from . import config
from log import get_logger, setup_logging, tail

from .modules.library import service as library_service
from .modules.tester import ENGINE_CHOICES
from .modules.tester import service as tester_service

log = get_logger(__name__)


# --------------------------------------------------------------------- утилиты UI
def _banner(title: str) -> None:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def _pause() -> None:
    try:
        input("\nEnter — вернуться в меню... ")
    except (EOFError, KeyboardInterrupt):
        pass


def _pick_test() -> Path | None:
    tests = tester_service.list_tests()
    if not tests:
        print(f"В {config.QUESTIONS_DIR} нет файлов вопросов (*.json).")
        return None
    choices = [
        Choice(f"{t['id']}  —  {t['count']} вопр.  —  {t['path'].name}", str(t["path"]))
        for t in tests
    ]
    answer = questionary.select("Файл с вопросами:", choices=choices).ask()
    return Path(answer) if answer else None


def _print_json(payload) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


# --------------------------------------------------------------------- тесты
def flow_test_local() -> None:
    """Только локальная проверка файла — сеть не используется."""
    _banner("Тесты / проверка файла (БЕЗ сети)")
    path = _pick_test()
    if not path:
        return
    summary = tester_service.local_check(path)
    print(f"\nФайл:            {summary['file']}")
    print(f"Тест:             {summary['url']}")
    print(f"Вопросов:         {summary['count']}")
    print(f"Мультиответных:   {summary['multi_answer']}")
    print(f"Вариантов/вопрос: {summary['variants_hist']}")
    print(f"Проблем:          {len(summary['problems'])}")
    for problem in summary["problems"]:
        print(f"  ! {problem}")
    if not summary["problems"]:
        print("\nФайл в порядке — ничего на сайт не отправлялось.")


def flow_test_scan() -> None:
    """Только чтение: сколько вопросов уже есть на сайте."""
    _banner("Тесты / сканирование теста (ТОЛЬКО ЧТЕНИЕ)")
    path = _pick_test()
    if not path:
        return
    if not questionary.confirm(
        "Открыть сайт и прочитать состояние теста? (записи не будет)", default=True,
    ).ask():
        print("Отменено.")
        return
    result = tester_service.scan_test(path)
    _print_json(result)


def flow_test_fill() -> None:
    """Единственный сценарий, который отправляет данные на сайт."""
    _banner("Тесты / заливка вопросов")
    path = _pick_test()
    if not path:
        return

    # 1) сначала всё проверяем локально
    local = tester_service.local_check(path)
    print(f"\nФайл: {local['file']} — вопросов {local['count']}, "
          f"проблем {len(local['problems'])}")
    if local["problems"] and not questionary.confirm(
        "В файле есть проблемы. Всё равно продолжить?", default=False,
    ).ask():
        print("Отменено.")
        return

    # 2) движок
    engine = questionary.select(
        "Движок заливки:",
        choices=[Choice(title, value) for title, value in ENGINE_CHOICES],
    ).ask()
    if not engine:
        print("Отменено.")
        return

    # 3) resume
    progress = tester_service.get_progress(local["id"])
    if progress:
        print(f"\nПрошлый запуск: {progress.get('state', '?')}, "
              f"последний вопрос №{progress.get('last_done')}, "
              f"залито {progress.get('done')}, обновлён {progress.get('updated')}")
    resume = questionary.confirm(
        "Продолжить с места остановки (рекомендуется)?", default=True,
    ).ask()
    if resume is None:
        print("Отменено.")
        return
    if not resume:
        print("Внимание: уже существующие вопросы в тесте будут продублированы.")
        if not questionary.confirm("Начать всё с первого вопроса?", default=False).ask():
            print("Отменено.")
            return

    # 4) объём
    limit = questionary.select(
        "Сколько вопросов заливать:",
        choices=[
            Choice("Все оставшиеся", 0),
            Choice("Только 3 — пробный запуск", 3),
            Choice("Только 1", 1),
        ],
    ).ask()
    if limit is None:
        print("Отменено.")
        return

    # 5) проверка после сохранения
    verify_remote = questionary.confirm(
        "Перечитывать список после каждого сохранения (дольше, но надёжнее)?",
        default=True,
    ).ask()
    if verify_remote is None:
        print("Отменено.")
        return

    # 6) явное подтверждение отправки
    _banner("ПОДТВЕРЖДЕНИЕ ОТПРАВКИ")
    print(f"Сайт:          {local['url']}")
    print(f"Файл:          {local['file']} ({local['count']} вопросов)")
    print(f"Движок:        {engine}")
    print(f"Старт:         {'продолжить с места остановки' if resume else 'с начала (дубли!)'}")
    print(f"Объём:         {'все оставшиеся' if not limit else f'максимум {limit}'}")
    print("Что уйдёт:     новые вопросы теста (вопрос + варианты + отметки верных)")
    if not questionary.confirm("Отправлять на сайт?", default=False).ask():
        print("Отменено — ничего не отправлено.")
        return

    result = tester_service.fill_test(
        path, engine=engine, resume=bool(resume),
        limit=int(limit), verify_remote=bool(verify_remote),
    )

    _banner("ИТОГ ЗАЛИВКИ")
    print(f"Файл:        {result['file']}")
    print(f"Залито:      {result['done']} из {result['planned']} запланированных "
          f"(в файле {result['total']})")
    print(f"Позиция:     старт {result['start']}")
    if result["unverified"]:
        print(f"Не подтвердились: {result['unverified']}")
    for error in result["errors"]:
        print(f"  ! вопрос №{error['index']}: {error['error']}")
    if result["stopped"]:
        print("\nОстановлено досрочно — прогресс сохранён, можно продолжить.")


# --------------------------------------------------------------------- библиотека
def flow_library_collect() -> None:
    _banner("Библиотека / сбор ссылок на материалы без файла")
    links = library_service.load_links()
    print(f"Поисковых ссылок в {library_service.LINKS_FILE.name}: {len(links)}")
    if not questionary.confirm("Запустить сбор? (запись только в JSON, сайт читаем)",
                               default=True).ask():
        print("Отменено.")
        return
    _print_json(library_service.collect())


def flow_library_scan() -> None:
    _banner("Библиотека / сканирование библиотеки")
    collect_files = questionary.confirm(
        "Сразу собрать имя файла и заголовок по каждой ссылке (материалы_out.json)?",
        default=True,
    ).ask()
    if collect_files is None:
        return
    if not questionary.confirm("Запустить сканирование? (сайт только читается)",
                               default=True).ask():
        print("Отменено.")
        return
    result = library_service.scan_library(collect_files=bool(collect_files))
    print(f"Уникальных ссылок: {result['count']}, вхождений: {result['total']}")


def flow_library_exchange() -> None:
    _banner("Библиотека / замена файлов")
    path = library_service.INPUT_FILE
    materials = library_service.load_exchange_tasks()
    print(f"Файл задач: {path.name} — материалов {len(materials)}")
    if not materials:
        print("Задач нет: заполните data/materials_input.json "
              '([{"url": "...", "file_path": "..."}]).')
        return
    print("\nЧто будет отправлено на сайт:")
    for i, item in enumerate(materials[:10], start=1):
        print(f"  {i}. {item.get('url')}  <-  {item.get('file_path')}")
    if len(materials) > 10:
        print(f"  ... и ещё {len(materials) - 10}")
    if not questionary.confirm("Заменить файлы на сайте?", default=False).ask():
        print("Отменено — ничего не отправлено.")
        return
    _print_json(library_service.exchange_files())


def flow_library_upload() -> None:
    _banner("Библиотека / загрузка PDF-презентаций")
    tasks = library_service.load_UPLOAD_FILES()
    print(f"Задач в {library_service.UPLOAD_FILES.name}: {len(tasks)}")
    if not tasks:
        print("Задач нет.")
        return

    # предпросмотр: что именно и с какими заголовками уйдёт (без сети)
    preview = library_service.preview_upload(tasks)
    print(f"\nФайлов к загрузке: {preview['total_files']}, "
          f"уникальных заголовков: {preview['total_titles']}")
    for error in preview["errors"]:
        print(f"  ! {error}")
    for row in preview["tasks"]:
        mark = "ok " if row["status"] == "ok" else "err"
        lecture = row["lecture"] or ("презентация" if row["presentation"] else "№ файла")
        print(f"  [{mark}] {row['discipline']}  (лекция {lecture}) — "
              f"PDF: {row['files']}  {row['folder']}")
    if preview["collisions"]:
        print("\nКоллизии заголовков (вторая загрузка будет пропущена как «уже есть»):")
        for item in preview["collisions"][:10]:
            print(f"  {item['title']}")
            for file in item["files"]:
                print(f"      ← {file}")
    print("\nПредпросмотр заголовков (первые 15):")
    for row in preview["rows"][:15]:
        print(f"  {row['file']}  ->  {row['title']}")
    if len(preview["rows"]) > 15:
        print(f"  ... и ещё {len(preview['rows']) - 15}")

    if not preview["total_files"]:
        print("\nЗагружать нечего — поправьте UPLOAD_FILES.json.")
        return
    if preview["errors"] and not questionary.confirm(
        "Есть ошибки задач. Всё равно продолжить?", default=False,
    ).ask():
        print("Отменено.")
        return

    if not questionary.confirm("Загрузить PDF на сайт?", default=False).ask():
        print("Отменено — ничего не отправлено.")
        return
    results = library_service.upload_from_file(tasks)
    print(f"Обработано записей: {len(results)}")


# --------------------------------------------------------------------- система
def flow_show_log() -> None:
    _banner(f"Журнал: {config.LOG_FILE}")
    print(tail(lines=40))


def flow_show_config() -> None:
    _banner("Конфигурация")
    masked = "*" * max(len(config.PASSWORD) - 4, 0) + config.PASSWORD[-4:]
    print(f"Сайт:        {config.BASE_URL}")
    print(f"Логин:       {config.EMAIL}")
    print(f"Пароль:      {masked} (из окружения/.env, не из кода)")
    print(f"Данные:      {config.DATA_DIR}")
    print(f"Вопросы:     {config.QUESTIONS_DIR}")
    print(f"Журнал:      {config.LOG_FILE} (уровень {config.LOG_LEVEL})")
    print(f"Браузер:     headless={config.HEADLESS}, блок медиа={config.BLOCK_MEDIA}")
    print(f"Ожидания:    {config.WAIT_TIMEOUT} мс")
    print("Тайминги (мс):")
    for field in ("form_ready", "question_settle", "field_settle",
                  "variant_settle", "after_save", "short"):
        print(f"  {field:<16} {getattr(config.TIMING, field)}")


# --------------------------------------------------------------------- меню
MENU = [
    Choice("Тесты — залить вопросы в тест", "fill"),
    Choice("Тесты — проверить файл локально (без сети)", "local"),
    Choice("Тесты — сканировать тест (только чтение)", "scan"),
    Choice("Библиотека — собрать ссылки на материалы без файла", "collect"),
    Choice("Библиотека — заменить файлы", "exchange"),
    Choice("Библиотека — сканировать библиотеку", "library_scan"),
    Choice("Библиотека — загрузить PDF-презентации", "upload"),
    Choice("Показать журнал", "log"),
    Choice("Показать конфигурацию", "config"),
    Choice("Выход", "exit"),
]

ACTIONS = {
    "fill": flow_test_fill,
    "local": flow_test_local,
    "scan": flow_test_scan,
    "collect": flow_library_collect,
    "exchange": flow_library_exchange,
    "library_scan": flow_library_scan,
    "upload": flow_library_upload,
    "log": flow_show_log,
    "config": flow_show_config,
}


def main() -> int:
    setup_logging()

    # меню questionary требует терминал — без него выходим сразу и понятно
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print("Меню требует интерактивный терминал (stdin/stdout не TTY).")
        log.warning("запуск без терминала — меню недоступно")
        return 1

    log.info("vshp_editor: данные %s, журнал %s", config.DATA_DIR, config.LOG_FILE)

    while True:
        try:
            choice = questionary.select(
                "VSHP editor — что делаем?", choices=MENU, qmark="»",
            ).ask()
        except KeyboardInterrupt:
            choice = None
        except (EOFError, OSError):
            print("\nТерминал недоступен — выхожу.")
            return 1

        if choice is None or choice == "exit":
            print("Выход.")
            return 0

        action = ACTIONS.get(choice)
        if action is None:
            log.warning("неизвестный пункт меню: %r", choice)
            continue

        try:
            action()
        except KeyboardInterrupt:
            print("\nДействие прервано пользователем.")
        except (EOFError, OSError):
            print("\nТерминал недоступен — выхожу.")
            return 1
        except Exception as exc:
            log.exception("сценарий %r завершился ошибкой", choice)
            print(f"\nОшибка: {type(exc).__name__}: {exc}")
            print(f"Подробности: {config.LOG_FILE}")
        _pause()


if __name__ == "__main__":
    sys.exit(main())
