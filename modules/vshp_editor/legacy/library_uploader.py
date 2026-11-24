import os, re
import time
from urllib.parse import quote
from playwright.sync_api import sync_playwright

class MaterialUploader():
    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self.BASE = "https://erp.vshp.online"
        self.NEW_URL = f"{self.BASE}/material_sources/new"
        self.LIST_URL = f"{self.BASE}/material_sources"
        self.timeout = 0

        self.organizations = {
            1: "ЧУВО «ВШП»",
            2: "ЧУПО «ВШП»",
            3: "ЧОУ «ВШП»",
            4: "Sàrl «SIIL»",
            5: "ООО «ВШП»",
            6: 'АНО ВО "Синергия"',
        }

        self.locales = {
            1: "RU",
            2: "EN",
            3: "FR",
            4: "ZH-CN",
            5: "ES",
            6: "DE",
        }

        self.locale_codes = {
            1: "ru",
            2: "en",
            3: "fr",
            4: "zh-CN",
            5: "es",
            6: "de",
        }

        self.titles = {
            1: {
                self.locales[1]: "Лекция",
                self.locales[2]: "Lecture",
                self.locales[3]: "Conférence",
                self.locales[4]: "讲座",
                self.locales[5]: "Conferencia",
                self.locales[6]: "Vorlesung",
            },
            2: {
                self.locales[1]: "Конспект",
                self.locales[2]: "Summary",
                self.locales[3]: "Résumé",
                self.locales[4]: "摘要",
                self.locales[5]: "Resumen",
                self.locales[6]: "Zusammenfassung",
            },
            3: {
                self.locales[1]: "Часть",
                self.locales[2]: "Part",
                self.locales[3]: "Partie",
                self.locales[4]: "部分",
                self.locales[5]: "Parte",
                self.locales[6]: "Teil",
            },
        }

        self.data = {}

    def _norm(self, s: str) -> str:
        return " ".join(s.split())

    def material_exists(self, page, title: str) -> bool:
        """Проверяет, есть ли на сайте материал с точно таким заголовком."""
        page.goto(f"{self.LIST_URL}?q={quote(title)}", wait_until="domcontentloaded")
        try:
            page.wait_for_selector("table.table", timeout=self.timeout)
        except Exception:
            return False

        found_titles = page.eval_on_selector_all(
            "tbody.js-collection tr td:nth-child(2)",
            """els => els.map(el => {
                const first = el.firstChild;
                return first && first.nodeType === 3 ? first.textContent.trim() : '';
            })"""
        )
        target = self._norm(title)
        return any(self._norm(t) == target for t in found_titles)

    
    def natural_key(self, s):
        return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]

    def upload_file(self, page):
        files = sorted(os.listdir(self.data["folder_path"]), key=self.natural_key)
        if not files:
            print("No files found in the specified folder.")
            return

        locale_name = self.locales[self.data["locale"]]
        locale_code = self.locale_codes[self.data["locale"]]

        with open("list_files.txt", "a", encoding="utf-8") as f:
            f.write(f"\n{self.data['discipline']}:\n")

        for count, file in enumerate(files, start=1):
            if not file.lower().endswith(".pdf"):
                print(f"Skipping non-PDF file: {file}")
                continue

            full_path = os.path.join(self.data["folder_path"], file)

            # Формируем заголовок через локализацию
            additional = (self.data.get("additional_name") or "").strip()
            discipline = self.data["discipline"].strip()
            if not self.data["lecture_count"]:
                if self.data["presentation"]:
                    parts = [self.titles[1][locale_name], str(count), additional]
                    title = f"{discipline.rstrip('.')}. " + " ".join(p for p in parts if p)
                else:
                    parts = [discipline, "Лекция", str(count), additional]
                    title = f"{self.titles[2][locale_name]}: " + " ".join(p for p in parts if p)
            else:
                if self.data["presentation"]:
                    parts = [self.titles[1][locale_name], str(self.data["lecture_count"]), additional,self.titles[3][locale_name],str(count)]
                    title = f"{discipline.rstrip('.')}. " + " ".join(p for p in parts if p)
                else:
                    parts = [discipline, "Лекция", str(self.data["lecture_count"]), additional, self.titles[3][locale_name] ,str(count)]
                    title = f"{self.titles[2][locale_name]}: " + " ".join(p for p in parts if p)
            print(f"[{count}] {file} -> {title}")

            # --- ПРОВЕРКА: уже есть такой материал? ---
            try:
                if self.material_exists(page, title):
                    print(f"    ↳ УЖЕ СУЩЕСТВУЕТ, пропускаем: {title}")
                    with open("list_files.txt", "a", encoding="utf-8") as f:
                        f.write(f"{file} -> [SKIP, уже есть] {title}\n")
                    continue
            except Exception as e:
                print(f"    ↳ Ошибка проверки: {e}. Продолжаем загрузку.")

            # --- Открываем форму создания (мы сейчас на /material_sources) ---
            page.goto(self.NEW_URL, wait_until="domcontentloaded")
            page.wait_for_selector('input[name="material_source[title]"]', timeout=self.timeout)

            # Название
            page.fill('input[name="material_source[title]"]', title)

            # Организация
            page.select_option(
                'select[name="material_source[organization_id]"]',
                value=str(self.data["organization"]),
            )

            # Локаль документа
            if locale_code != "ru":
                page.select_option(
                    'select[name="material_source[locale]"]',
                    value=locale_code,
                )

            # Автор
            page.fill('input[name="material_source[author]"]', self.data["author"])

            # Сам файл
            page.set_input_files('input[name="material_source[file]"]', full_path)

            page.wait_for_timeout(self.timeout)
            print(f"Файл {file} готов к загрузке. Заголовок: {title}")

            # Сохранить
            try:
                page.click('input[name="commit"]', timeout=self.timeout)
            except Exception:
                # клик мог пройти, но Playwright не дождался навигации
                pass

            # Ждём, пока форма уйдёт
            page.wait_for_selector(
                'input[name="material_source[title]"]',
                state="detached",
                timeout=0,
            )

            with open("list_files.txt", "a", encoding="utf-8") as f:
                f.write(f"{file} -> {title}\n")

            time.sleep(2)


        print("Готово.")

    def run(self, tasks=None):
        if tasks is None:
            return 0

        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            page = browser.new_page(accept_downloads=True)
            page.goto(self.NEW_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(self.timeout)
            # Логин
            page.fill('input[name="user_session[email]"]', self.email)
            page.fill('input[name="user_session[password]"]', self.password)
            page.click('button[type="submit"].header-page_btn')
            page.wait_for_selector(
                'input[name="user_session[password]"]',
                state="detached", timeout=self.timeout,
            )
            print("Успешный вход:", page.url)
            for task in tasks:
                self.data.update(task)
                self.upload_file(page)
                
            browser.close()


material_uploader = MaterialUploader(
    email = "v.gornostaev@siil.ch",
    password = "bW6XynFFKUZVS86",
)

material_uploader.run([
            {
                "discipline": "Анализ больших данных",
                "presentation": True,
                "folder_path": "/home/exti/Desktop/HDD/vshp/Печатные материалы/pdf/презентации/1",
                "locale": 1,
                "organization": 4,
                "author": "-",
                "additional_name": None,
                "lecture_count": 1
            },
            {
                "discipline": "Анализ больших данных",
                "presentation": True,
                "folder_path": "/home/exti/Desktop/HDD/vshp/Печатные материалы/pdf/презентации/2",
                "locale": 1,
                "organization": 4,
                "author": "-",
                "additional_name": None,
                "lecture_count": 2
            },
                        {
                "discipline": "Анализ больших данных",
                "presentation": True,
                "folder_path": "/home/exti/Desktop/HDD/vshp/Печатные материалы/pdf/презентации/3",
                "locale": 1,
                "organization": 4,
                "author": "-",
                "additional_name": None,
                "lecture_count": 3
            },
                        {
                "discipline": "Анализ больших данных",
                "presentation": True,
                "folder_path": "/home/exti/Desktop/HDD/vshp/Печатные материалы/pdf/презентации/4",
                "locale": 1,
                "organization": 4,
                "author": "-",
                "additional_name": None,
                "lecture_count": 4
            },
                        {
                "discipline": "Анализ больших данных",
                "presentation": True,
                "folder_path": "/home/exti/Desktop/HDD/vshp/Печатные материалы/pdf/презентации/5",
                "locale": 1,
                "organization": 4,
                "author": "-",
                "additional_name": None,
                "lecture_count": 5
            },
            
        ])
