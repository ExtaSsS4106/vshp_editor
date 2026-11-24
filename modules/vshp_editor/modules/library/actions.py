"""Действия над материалами библиотеки (/material_sources).

Структура — как в library_repair.Actions: класс со статическими методами
и единым log(); вместо записи в отдельный файл используется общее логирование
(log.get_logger) — консоль + logs/vshp_editor.log.
"""

from __future__ import annotations

import logging
from urllib.parse import urljoin

from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PWTimeout

from ... import config
from ...log import get_logger

log = get_logger(__name__)

# None -> config.WAIT_TIMEOUT (по умолчанию 30 с); 0 — как раньше, ждать бесконечно
DEFAULT_TIMEOUT: int | None = None


def _timeout(timeout: int | None) -> int:
    return config.WAIT_TIMEOUT if timeout is None else timeout


class Actions:
    # ------------------------------------------------------------------ лог
    @staticmethod
    def log(msg: str, level: str = "INFO", start: bool = False) -> None:
        """Совместимость со старым API (включая start=True — начало блока работ)."""
        logger = get_logger("library.actions")
        if start:
            logger.info("=" * 70)
        logger.log(getattr(logging, str(level).upper(), logging.INFO), "%s", msg)

    # ------------------------------------------------------------------ файлы
    @staticmethod
    def getFileName(page: Page, timeout: int | None = DEFAULT_TIMEOUT):
        Actions.log(f"getFileName: читаю имя файла и название ({page.url})", "DEBUG")
        try:
            file_name = page.locator("#material_source_file_name").input_value(
                timeout=_timeout(timeout))
            title = page.locator("#material_source_title").input_value(
                timeout=_timeout(timeout))
            Actions.log(f"getFileName: file_name={file_name!r}, title={title!r}", "DEBUG")
            return (file_name, title)
        except PWTimeout:
            Actions.log(f"getFileName: таймаут ({page.url})", "WARN")
            return (None, None)

    @staticmethod
    def setFile(page: Page, full_path: str, timeout: int | None = DEFAULT_TIMEOUT) -> bool:
        if not full_path:
            Actions.log("setFile: путь к файлу не задан, пропускаю", "WARN")
            return False
        Actions.log(f"setFile: загружаю {full_path}")
        try:
            page.set_input_files(
                'input[name="material_source[file]"]', full_path,
                timeout=_timeout(timeout),
            )
            try:
                page.click('input[name="commit"]', timeout=_timeout(timeout))
            except Exception:
                # клик мог пройти, но Playwright не дождался навигации
                pass
            Actions.log(f"setFile: файл отправлен: {full_path}")
            return True
        except PWTimeout:
            Actions.log(f"setFile: таймаут, файл {full_path}", "ERROR")
            return False
        except Exception as exc:  # например, файла нет на диске
            Actions.log(f"setFile: {type(exc).__name__}: {exc}", "ERROR")
            return False

    # ------------------------------------------------------------------ список
    @staticmethod
    def getLinksForEdit(page: Page, timeout: int | None = DEFAULT_TIMEOUT) -> list[str]:
        Actions.log(f"getLinksForEdit: ищу строки таблицы ({page.url})", "DEBUG")
        table_rows = page.locator("tbody.js-collection tr")
        try:
            table_rows.first.wait_for(state="attached", timeout=_timeout(timeout))
        except PWTimeout:
            Actions.log("getLinksForEdit: таблица пустая или не загрузилась", "WARN")
            return []

        total = table_rows.count()
        rows = page.locator("tbody.js-collection > tr").filter(
            has=page.locator("span.label-danger:visible", has_text="Файл не найден")
        )
        missing = rows.count()
        Actions.log(f"getLinksForEdit: всего строк {total}, «Файл не найден» в {missing}", "DEBUG")

        links = rows.locator('a[href^="/material_sources/"][href$="/edit"]') \
            .evaluate_all("els => els.map(e => e.href)")
        Actions.log(f"getLinksForEdit: ссылок на редактирование: {len(links)}", "DEBUG")
        return links

    @staticmethod
    def goToNextPage(page: Page, timeout: int | None = DEFAULT_TIMEOUT) -> bool:
        old_url = page.url
        next_btn = page.locator("ul.pagination li.next:not(.disabled) a[rel='next']")

        if next_btn.count() == 0:
            Actions.log("goToNextPage: кнопки «След.» нет — последняя страница", "DEBUG")
            return False

        href = next_btn.first.get_attribute("href")
        if not href:
            Actions.log("goToNextPage: у «След.» нет href — стоп", "WARN")
            return False

        full_url = urljoin(old_url, href)
        if full_url == old_url:
            Actions.log("goToNextPage: «След.» ведёт на тот же URL — стоп", "WARN")
            return False

        Actions.log(f"goToNextPage: {old_url} -> {full_url}", "DEBUG")
        page.goto(full_url, wait_until="domcontentloaded", timeout=_timeout(timeout))
        return True
