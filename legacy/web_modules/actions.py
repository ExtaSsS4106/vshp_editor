from . import *

DEFAULT_TIMEOUT = 0  # мс

LOG = "library_return.log"


class Actions:
    @staticmethod
    def log(msg, level="INFO", start=False):
        line = f"{datetime.now():%Y-%m-%d %H:%M:%S} [{level}] {msg}"
        with open(LOG, "a", encoding="utf-8") as f:
            if start:
                f.write("\n\n\n"+line + "\n")
            else:
                f.write(line + "\n")
        print(line, flush=True)

    @staticmethod
    def getFileName(page, timeout=DEFAULT_TIMEOUT):
        Actions.log(f"getFileName: читаю имя файла и название ({page.url})")
        try:
            file_name = page.locator("#material_source_file_name").input_value(timeout=timeout)
            title = page.locator("#material_source_title").input_value(timeout=timeout)
            Actions.log(f"getFileName: file_name={file_name!r}, title={title!r}")
            return (file_name, title)
        except PWTimeout:
            Actions.log(f"getFileName: таймаут {timeout} мс ({page.url})", "WARN")
            return (None, None)

    @staticmethod
    def setFile(page, full_path, timeout=DEFAULT_TIMEOUT):
        if not full_path:
            Actions.log("setFile: путь к файлу не задан, пропускаю", "WARN")
            return False
        Actions.log(f"setFile: загружаю {full_path}")
        try:
            page.set_input_files(
                'input[name="material_source[file]"]', full_path, timeout=timeout
            )
            # Сохранить
            try:
                page.click('input[name="commit"]', timeout=timeout)
            except Exception:
                # клик мог пройти, но Playwright не дождался навигации
                pass
            Actions.log(f"setFile: файл загружен: {full_path}")
            return True
        except PWTimeout:
            Actions.log(f"setFile: таймаут {timeout} мс, файл {full_path}", "ERROR")
            return False
        except Exception as e:
            # например, файла нет на диске
            Actions.log(f"setFile: {type(e).__name__}: {e}", "ERROR")
            return False

    @staticmethod
    def getLinksForEdit(page, timeout=DEFAULT_TIMEOUT):
        Actions.log(f"getLinksForEdit: ищу строки таблицы ({page.url})")
        table_rows = page.locator("tbody.js-collection tr")
        try:
            # ждём, пока в таблице появится хотя бы одна строка
            table_rows.first.wait_for(state="attached", timeout=timeout)
        except PWTimeout:
            Actions.log("getLinksForEdit: таблица пустая или не загрузилась", "WARN")
            return []

        total = table_rows.count()
        rows = page.locator("tbody.js-collection > tr").filter(
            has=page.locator("span.label-danger:visible", has_text="Файл не найден")
        )
        missing = rows.count()
        Actions.log(f"getLinksForEdit: всего строк {total}, 'Файл не найден' в {missing}")

        links = rows.locator('a[href^="/material_sources/"][href$="/edit"]') \
                    .evaluate_all("els => els.map(e => e.href)")
        Actions.log(f"getLinksForEdit: найдено ссылок на редактирование: {len(links)}")
        return links

    @staticmethod
    def goToNextPage(page, timeout=DEFAULT_TIMEOUT):
        old_url = page.url
        next_btn = page.locator("ul.pagination li.next:not(.disabled) a[rel='next']")

        if next_btn.count() == 0:
            Actions.log("goToNextPage: кнопки 'След.' нет, это последняя страница")
            return False

        href = next_btn.first.get_attribute("href")
        if not href:
            Actions.log("goToNextPage: у 'След.' нет href — стоп", "WARN")
            return False

        from urllib.parse import urljoin
        full_url = urljoin(old_url, href)

        if full_url == old_url:
            Actions.log(f"goToNextPage: 'След.' ведёт на тот же URL — стоп", "WARN")
            return False

        Actions.log(f"goToNextPage: {old_url} → {full_url}")
        page.goto(full_url, wait_until="domcontentloaded", timeout=timeout)
        return True