from . import *
from urllib.parse import urljoin

TIMEOUT = 30000

ROWS = "table.table tbody tr"
FORM = "form.tests_question"
QUESTION_TEXTAREA = "#tests_question_content"
ANSWER_BLOCKS = "#questions .nested-fields"
SAVE_BTN = 'input[type="submit"][name="commit"][value="Сохранить"]'
CREATE_LINK = 'a[href$="/questions/new"]'
ADD_ANSWER = 'a.add_fields[data-association="answer"]'

# Кладёт HTML в поле: если CKEditor уже есть - через него,
# иначе напрямую в textarea (CKEditor подхватит значение при инициализации).
SET_FIELD_JS = """
({id, text}) => {
    const ta = document.getElementById(id);
    const ed = window.CKEDITOR && CKEDITOR.instances[id];
    if (ed) {
        ed.setData(text);
        ed.fire('change');
        ed.updateElement();
    } else {
        ta.value = text;
        ta.dispatchEvent(new Event('input',  {bubbles: true}));
        ta.dispatchEvent(new Event('change', {bubbles: true}));
    }
}
"""


class Actions():
    def __init__(self, page):
        self.page = page
        self.timeout = TIMEOUT
        self.wait_time = 1

    # ------------------------------------------------------------------
    def _goto_link(self, locator):
        """Переход по ссылке полной загрузкой (мимо Turbolinks), без ожидания ресурсов."""
        href = locator.get_attribute("href")
        self.page.goto(urljoin(self.page.url, href), wait_until="commit")

    # ------------------------------------------------------------------
    def get_last_question(self):
        rows = self.page.locator(ROWS)
        rows.first.wait_for(state="visible", timeout=self.timeout)

        pagination = self.page.locator("ul.pagination")
        if pagination.count() > 0:
            last_link = pagination.locator("li.last a")
            target = last_link if last_link.count() > 0 else pagination.locator("li.page a").last
            if target.count() > 0:
                self._goto_link(target)
                rows.first.wait_for(state="visible", timeout=self.timeout)

        count = rows.count()
        last_row = rows.nth(count - 1)
        number = last_row.locator("td").nth(0).inner_text().strip()
        question = last_row.locator("td").nth(1).inner_text().strip()
        return number, question

    # ------------------------------------------------------------------
    def click_create_button(self):
        link = self.page.locator(CREATE_LINK).first
        link.wait_for(state="visible", timeout=self.timeout)
        self._goto_link(link)
        # Ждём только форму и поле вопроса
        self.page.locator(FORM).wait_for(state="attached", timeout=self.timeout)
        self.page.locator(QUESTION_TEXTAREA).wait_for(state="attached", timeout=self.timeout)
        return True

    # ------------------------------------------------------------------
    def save_question(self):
        save_btn = self.page.locator(SAVE_BTN)
        save_btn.wait_for(state="attached", timeout=self.timeout)

        # JS-валидация снимает disabled
        try:
            self.page.wait_for_function(
                """() => {
                    const b = document.querySelector('input[type="submit"][name="commit"]');
                    return b && !b.disabled;
                }""",
                timeout=self.timeout,
            )
        except Exception:
            state = self.page.evaluate("""() => {
                const $f = window.jQuery ? jQuery('form.tests_question') : null;
                if (!$f) return 'jQuery/form не найден';
                const answers = $f.find('.nested-fields textarea').map(function(){return this.value;}).get();
                return {
                    blocks: $f.find('.nested-fields').length,
                    checked: $f.find('.nested-fields input[type="checkbox"]:checked').length,
                    answers: answers,
                    ckeditor: typeof window.CKEDITOR
                };
            }""")
            print("Кнопка не разблокировалась. Состояние формы:", state)
            raise

        save_btn.click(no_wait_after=True)

        # Ждём появления таблицы вопросов (а не загрузки страницы)
        self.page.locator(ROWS).first.wait_for(state="visible", timeout=self.timeout)
        print("Сохранено. URL:", self.page.url)

    # ------------------------------------------------------------------
    def fill_question(self, data):
        time.sleep(self.wait_time)
        """data: dict с ключами 'question', 'variants', 'answer'."""
        # --- Вопрос ---
        self.page.locator(QUESTION_TEXTAREA).wait_for(state="attached", timeout=self.timeout)
        self.page.evaluate(SET_FIELD_JS, {"id": "tests_question_content",
                                          "text": data["question"]})
        print("Текст вопроса введён")

        add_btn = self.page.locator(ADD_ANSWER).first
        add_btn.wait_for(state="visible", timeout=self.timeout)

        blocks = self.page.locator(ANSWER_BLOCKS)

        # --- Варианты ---
        for i, variant in enumerate(data["variants"]):
            time.sleep(self.wait_time)
            vtext = variant["text"] if isinstance(variant, dict) else str(variant)
            is_correct = variant in data["answer"]
            time.sleep(self.wait_time)
            before = blocks.count()
            add_btn.click()
            time.sleep(self.wait_time)
            # Ждём только новый блок с textarea
            new_block = blocks.nth(before)
            new_block.wait_for(state="attached", timeout=self.timeout)
            textarea = new_block.locator("textarea").first
            textarea.wait_for(state="attached", timeout=self.timeout)
            
            ta_id = textarea.get_attribute("id")
            time.sleep(self.wait_time)
            self.page.evaluate(SET_FIELD_JS, {"id": ta_id, "text": vtext})

            if is_correct:
                new_block.locator('input[type="checkbox"]').check()
                print("  ✓ верный")

            print(f"Вариант #{i + 1} добавлен: {vtext!r}")

        self.save_question()