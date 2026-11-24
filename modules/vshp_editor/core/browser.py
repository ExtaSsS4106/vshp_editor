"""Запуск браузера и переходы по URL.

Единая точка: любой сценарий (тесты, библиотека, загрузка PDF) получает
строку через browser_session() — контекст сам закрывает браузер.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from playwright.sync_api import Page, sync_playwright

from .. import config
from ..log import get_logger

log = get_logger(__name__)

# Режем только то, что скриптам точно не нужно
BLOCKED_RESOURCES = {"image", "media"}


def block_heavy_resources(route) -> None:
    if route.request.resource_type in BLOCKED_RESOURCES:
        route.abort()
    else:
        route.continue_()


@contextmanager
def browser_session(headless: bool | None = None, block_media: bool | None = None) -> Iterator[Page]:
    """Открытая страница с отключёнными картинками/видео; браузер закрывается сам."""
    headless = config.HEADLESS if headless is None else headless
    block_media = config.BLOCK_MEDIA if block_media is None else block_media
    log.debug("браузер: headless=%s, блокировка медиа=%s", headless, block_media)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        try:
            context = browser.new_context(accept_downloads=True)
            if block_media:
                context.route("**/*", block_heavy_resources)
            yield context.new_page()
        finally:
            browser.close()
            log.debug("браузер закрыт")


def open_url(page: Page, url: str, wait_until: str = "commit") -> None:
    """Переход на URL. commit/domcontentloaded — не ждём тяжёлые ресурсы."""
    log.debug("goto [%s]: %s", wait_until, url)
    page.goto(url, wait_until=wait_until, timeout=config.WAIT_TIMEOUT)
