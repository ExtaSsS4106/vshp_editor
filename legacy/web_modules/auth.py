from . import *

TIMEOUT = 30000


class Auth():
    def __init__(self, login: str, password: str):
        self.login = login
        self.password = password
        self.token = None

    def _login(self, page):
        email_input = page.locator('input[name="user_session[email]"]')
        password_input = page.locator('input[name="user_session[password]"]')

        # Ждём только поля формы
        email_input.wait_for(state="visible", timeout=TIMEOUT)
        password_input.wait_for(state="visible", timeout=TIMEOUT)

        email_input.fill(self.login)
        password_input.fill(self.password)

        page.click('button[type="submit"].header-page_btn', no_wait_after=True)

        # Поле пароля исчезло -> вход выполнен
        password_input.wait_for(state="detached", timeout=TIMEOUT)