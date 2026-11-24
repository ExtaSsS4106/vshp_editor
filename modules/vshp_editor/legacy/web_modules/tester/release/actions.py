from . import *
from urllib.parse import urljoin


class Actions():
    def __init__(self, page):
        self.page = page
        self.wait_time = 1

    def get_last_question(self):
        pagination = self.page.locator("ul.pagination")
        print(pagination.count())
        time.sleep(self.wait_time)
        if pagination.count() == 0:
            print("Пагинации нет — скип")
        else:
            last_link = pagination.locator("li.last a")

            if last_link.count() > 0:
                href = last_link.get_attribute("href")
                print("Жмём 'В конец':", href)
                last_link.click()
            else:
                # ищем последнюю цифру среди li.page a
                pages = pagination.locator("li.page a")
                n = pages.count()
                if n > 0:
                    last_num = pages.nth(n - 1)
                    print("Жмём последнюю цифру:", last_num.inner_text().strip())
                    last_num.click()
                else:
                    print("Кнопок навигации нет — скип")

            self.page.wait_for_load_state("domcontentloaded")
            print("Текущий URL:", self.page.url)

        # Все строки таблицы в tbody
        time.sleep(self.wait_time)
        rows = self.page.locator("table.table tbody tr")
        count = rows.count()
        print("Всего строк:", count)

        # Последняя строка
        last_row = rows.nth(count - 1)
        number = last_row.locator("td").nth(0).inner_text().strip()
        question = last_row.locator("td").nth(1).inner_text().strip()
        return number, question
    def click_create_button(self, timeout=10000):
        """
        Находит и нажимает кнопку «Создать» на странице вопросов теста.
        Возвращает True, если клик удался, иначе False.
        """
        # Пробуем несколько вариантов селектора по приоритету
        selectors = [
            'a.btn.btn-primary.btn-sm[href$="/questions/new"]',  # самый точный
            'a:has-text("Создать")',                              # по тексту
            'a[href*="/questions/new"]',                          # по href
        ]

        for sel in selectors:
            btn = self.page.locator(sel).first
            try:
                btn.wait_for(state="visible", timeout=timeout)
            except Exception:
                continue

            href = btn.get_attribute("href")
            print(f"Найдена кнопка «Создать» по селектору: {sel} -> {href}")

            with self.page.expect_navigation(wait_until="domcontentloaded", timeout=timeout):
                btn.click()

            self.page.wait_for_load_state("domcontentloaded")
            print("Перешли на:", self.page.url)
            return True

        print("Кнопка «Создать» не найдена")
        return False
    
    def save_question(self, timeout=15000):
        """
        Нажимает «Сохранить» после заполнения формы вопроса.
        Ждёт, пока JS-валидация разблокирует кнопку, затем кликает.
        """
        save_btn = self.page.locator('input[type="submit"][name="commit"][value="Сохранить"]')
        save_btn.wait_for(state="attached", timeout=timeout)

        # Ждём, пока JS снимет disabled (validateForm проверяет:
        # >=2 варианта, >=1 верный, все ответы непустые и уникальные)
        try:
            self.page.wait_for_function(
                """() => {
                    const b = document.querySelector('input[type="submit"][name="commit"]');
                    return b && !b.disabled;
                }""",
                timeout=timeout,
            )
        except Exception:
            # Если так и не разблокировалась — выведем, чего не хватает
            state = self.page.evaluate("""() => {
                const $f = window.jQuery ? jQuery('form.tests_question') : null;
                if (!$f) return 'jQuery/form не найден';
                const fields = $f.find('.nested-fields');
                const answers = $f.find('.nested-fields textarea').map(function(){return this.value;}).get();
                const uniq = answers.filter((v, i, a) => i === a.indexOf(v) && v !== '');
                return {
                    blocks: fields.length,
                    checked: $f.find('.nested-fields input[type="checkbox"]:checked').length,
                    answers: answers,
                    uniq_count: uniq.length
                };
            }""")
            print("Кнопка не разблокировалась. Состояние формы:", state)
            raise

        # Кликаем и ждём навигацию (страница списка вопросов или edit)
        with self.page.expect_navigation(wait_until="domcontentloaded", timeout=timeout):
            save_btn.click()

        print("Форма отправлена. Текущий URL:", self.page.url)
        return self.page.url
    
    def fill_question(self, data):
        """
        Заполняет поле вопроса текстом и добавляет answers_count вариантов ответа.

        data: dict с ключом 'content' (текст вопроса) ИЛИ просто строка.
        answers_count: сколько раз нажать «Добавить вариант ответа».
        """
        # --- 1. Достаём текст вопроса ---
        text = data["question"]

        # --- 2. Ждём, пока CKEditor для вопроса инициализируется ---
        self.page.wait_for_function(
            "() => window.CKEDITOR && CKEDITOR.instances['tests_question_content']",
            timeout=15000,
        )

        # --- 3. Ставим текст в редактор и триггерим change ---
        self.page.evaluate(
            """(text) => {
                const ed = CKEDITOR.instances['tests_question_content'];
                ed.setData(text);
                ed.fire('change');
                ed.updateElement();   // синхронизирует textarea для формы
            }""",
            text,
        )
        print("Текст вопроса введён")
        time.sleep(self.wait_time)
        # --- 4. Добавляем варианты ответа ---
        add_btn = self.page.locator('a.add_fields[data-association="answer"]').first
        add_btn.wait_for(state="visible", timeout=10000)

        # --- 3. Цикл по вариантам ---
        for i, variant in enumerate(data["variants"]):
            
            text = variant["text"] if isinstance(variant, dict) else str(variant)

            is_correct = variant in data["answer"] 

            before = self.page.locator("#questions .nested-fields").count()

            add_btn.click()

            # Ждём появления нового .nested-fields
            self.page.wait_for_function(
                "(n) => document.querySelectorAll('#questions .nested-fields').length > n",
                arg=before,
                timeout=10000,
            )

            # Ждём, пока CKEditor создастся внутри нового блока
            # (у нового textarea появится соответствующий CKEDITOR.instances[...])
            self.page.wait_for_function(
                """() => {
                    const areas = document.querySelectorAll('#questions .nested-fields textarea');
                    const last = areas[areas.length - 1];
                    return last && window.CKEDITOR && CKEDITOR.instances[last.id];
                }""",
                timeout=10000,
            )
            time.sleep(self.wait_time)
            # Заполняем последний CKEditor (наш новый вариант)
            self.page.evaluate(
                """(text) => {
                    const areas = document.querySelectorAll('#questions .nested-fields textarea');
                    const last = areas[areas.length - 1];
                    const ed = CKEDITOR.instances[last.id];
                    ed.setData(text);
                    ed.fire('change');
                    ed.updateElement();
                }""",
                text,
            )

            # Отмечаем «Верный ответ» в последнем блоке
            if is_correct:
                last_block = self.page.locator("#questions .nested-fields").nth(before)
                last_block.locator('input[type="checkbox"]').check()
                print(f"  ✓ отмечен как верный")

            after = self.page.locator("#questions .nested-fields").count()
            print(f"Вариант #{i + 1} добавлен и заполнен (всего: {after}): {text!r}")
        time.sleep(self.wait_time)
        self.save_question(self.page)
        return self.page.locator("#questions .nested-fields").count()