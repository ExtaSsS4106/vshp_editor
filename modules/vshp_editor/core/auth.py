"""Авторизация на erp.vshp.online.

ensure_login() повторяет принцип login() из Library_return:
сначала открываем страницу, и только если сессия протухла — логинимся
и открываем её ещё раз.
"""

from __future__ import annotations

from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PWTimeout

from .. import config
from ..core.browser import open_url
from ..log import get_logger

log = get_logger(__name__)


class Auth:
    EMAIL_INPUT = 'input[name="user_session[email]"]'
    PASSWORD_INPUT = 'input[name="user_session[password]"]'
    SUBMIT = 'button[type="submit"].header-page_btn'

    def __init__(self, email: str | None = None, password: str | None = None):
        self.email = email or config.EMAIL
        self.password = password or config.PASSWORD

    # ------------------------------------------------------------------ старое API
    def _login(self, page: Page) -> None:
        self.login(page)

    # ------------------------------------------------------------------ логин
    def login(self, page: Page) -> None:
        """Заполняет форму входа; успешным считаем, когда поле пароля исчезло."""
        log.info("вхожу как %s", self.email)
        email_input = page.locator(self.EMAIL_INPUT).first
        password_input = page.locator(self.PASSWORD_INPUT).first

        email_input.wait_for(state="visible", timeout=config.WAIT_TIMEOUT)
        password_input.wait_for(state="visible", timeout=config.WAIT_TIMEOUT)

        email_input.fill(self.email)
        password_input.fill(self.password)
        page.click(self.SUBMIT)
        password_input.wait_for(state="detached", timeout=config.WAIT_TIMEOUT)
        log.info("вход выполнен: %s", page.url)

    @staticmethod
    def needs_login(page: Page) -> bool:
        if "/login" in page.url:
            return True
        try:
            return page.locator(Auth.PASSWORD_INPUT).first.is_visible(timeout=1500)
        except PWTimeout:
            return False
        except Exception:  # страница ещё грузится и т.п.
            return False

    def ensure_login(self, page: Page, url: str, wait_until: str = "commit") -> None:
        """Открывает url и логинится при необходимости (принцип Library_return)."""
        open_url(page, url, wait_until)
        if self.needs_login(page):
            self.login(page)
            open_url(page, url, wait_until)
        log.info("страница готова: %s", page.url)
