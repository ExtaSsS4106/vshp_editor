"""Стабильная (release) реализация заливки вопросов в тест.

Принцип организации — как в library_repair.Actions / Library_return:
  * один класс Actions со всеми шагами,
  * каждое действие логируется,
  * после каждого шага страница перечитывается и сверяется с локальными данными,
  * жёсткие паузы (config.Timing): поле создаётся -> ждём 1-2 с -> пишем в него,
    вариант заполнен -> ждём 1-2 с -> проверяем всю форму.

Порядок работы fill_question():
    1) форма уже создана (open_create_form) -> пауза form_ready
    2) текст вопроса -> пауза question_settle (минимум 1-2 с)
    3) цикл по вариантам: создать поле -> пауза field_settle -> записать текст ->
       поставить галочку -> пауза variant_settle -> ПОЛНАЯ проверка страницы
    4) сохранение отдельным шагом (save_question) — его вызывает сервис
"""

from __future__ import annotations

import html
import logging
import re
import time
from urllib.parse import urljoin

from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PWTimeout

from ... import config
from ...core.browser import open_url
from ...log import get_logger

log = get_logger(__name__)

# ---------------------------------------------------------------- селекторы страницы
ROWS = "table.table tbody tr"
FORM = "form.tests_question"
QUESTION_TEXTAREA = "#tests_question_content"
QUESTION_FIELD_ID = "tests_question_content"
ANSWER_BLOCKS = "#questions .nested-fields"
ADD_ANSWER = 'a.add_fields[data-association="answer"]'
CREATE_LINK = 'a[href$="/questions/new"]'
SAVE_BTN = 'input[type="submit"][name="commit"][value="Сохранить"]'

# Кладёт текст: если CKEditor уже есть — через него, иначе напрямую в textarea
# (CKEditor подхватит значение при своей инициализации).
SET_FIELD_JS = """
({id, text}) => {
    const ta = document.getElementById(id);
    if (!ta) { return false; }
    const ed = (window.CKEDITOR && CKEDITOR.instances[id]) || null;
    if (ed) {
        ed.setData(text);
        ed.fire('change');
        ed.updateElement();   // синхронизирует textarea для формы
    } else {
        ta.value = text;
        ta.dispatchEvent(new Event('input',  {bubbles: true}));
        ta.dispatchEvent(new Event('change', {bubbles: true}));
    }
    return true;
}
"""

# Читает фактическое состояние формы: вопрос + все блоки вариантов.
READ_FORM_JS = """
() => {
    const read = (el) => {
        if (!el) return null;
        const inst = (window.CKEDITOR && CKEDITOR.instances[el.id]) || null;
        return inst ? inst.getData() : el.value;
    };
    const q = document.getElementById("tests_question_content");
    const blocks = Array.from(document.querySelectorAll("#questions .nested-fields"))
        .map(b => {
            const ta = b.querySelector("textarea");
            const cb = b.querySelector('input[type="checkbox"]');
            return {
                id: ta ? ta.id : null,
                text: ta ? read(ta) : null,
                correct: !!(cb && cb.checked),
                editor: !!(ta && window.CKEDITOR && CKEDITOR.instances[ta.id]),
                visible: b.offsetParent !== null
            };
        });
    return {url: location.href, question: read(q), blocks: blocks};
}
"""

# Снимок формы на случай, если кнопка «Сохранить» так и не разблокировалась.
DIAG_JS = """
() => {
    const $f = window.jQuery ? jQuery('form.tests_question') : null;
    if (!$f) return {error: 'jQuery/form не найден'};
    const answers = $f.find('.nested-fields textarea').map(function(){return this.value;}).get();
    return {
        blocks: $f.find('.nested-fields').length,
        checked: $f.find('.nested-fields input[type="checkbox"]:checked').length,
        answers: answers,
        ckeditor: typeof window.CKEDITOR
    };
}
"""

WAIT_ENABLED_JS = """
() => {
    const b = document.querySelector('input[type="submit"][name="commit"]');
    return b && !b.disabled;
}
"""

_TAGS = re.compile(r"<[^>]+>")


def norm(value) -> str:
    """Текст из CKEditor (HTML) -> сравнимая строка."""
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = _TAGS.sub(" ", text)
    text = text.replace("\xa0", " ")
    return " ".join(text.split())


class VerifyError(RuntimeError):
    """Страница не совпала с локальными данными — заливать дальше нельзя."""


class Actions:
    """Шаги над страницей вопросов теста."""

    # release ждёт инициализации CKEditor перед записью (бета отключает — быстрее)
    wait_ckeditor = True

    def __init__(self, page: Page, list_url: str | None = None,
                 timing: config.Timing | None = None, verify_retries: int = 3):
        self.page = page
        self.list_url = list_url
        self.timing = timing or config.TIMING
        self.timeout = config.WAIT_TIMEOUT
        self.verify_retries = verify_retries

    # ------------------------------------------------------------- служебное
    def _log(self, msg: str, level: str = "INFO") -> None:
        log.log(getattr(logging, str(level).upper(), logging.INFO), "%s", msg)

    def pause(self, ms: int | None = None) -> None:
        """Пауза по часам браузера; по умолчанию — мелкая техническая."""
        self.page.wait_for_timeout(self.timing.short if ms is None else ms)

    # ------------------------------------------------------------- навигация
    def goto(self, url: str, wait_until: str = "domcontentloaded") -> None:
        self._log(f"переход: {url}", "DEBUG")
        open_url(self.page, url, wait_until)

    def goto_link(self, locator, wait_until: str = "domcontentloaded") -> None:
        """Переход по ссылке полной загрузкой (мимо Turbolinks). Бета ускоряет."""
        href = locator.get_attribute("href")
        if not href:
            raise VerifyError("у ссылки нет href")
        self.goto(urljoin(self.page.url, href), wait_until)

    def open_list(self) -> None:
        if not self.list_url:
            raise VerifyError("не задан list_url со списком вопросов")
        self.goto(self.list_url)
        self.page.locator(ROWS).first.wait_for(state="visible", timeout=self.timeout)

    def open_create_form(self) -> str:
        """Открывает пустую форму нового вопроса (создаёт новые поля)."""
        link = self.page.locator(CREATE_LINK).first
        link.wait_for(state="visible", timeout=self.timeout)
        self.goto_link(link)
        self.page.locator(FORM).wait_for(state="attached", timeout=self.timeout)
        self.page.locator(QUESTION_TEXTAREA).wait_for(state="attached", timeout=self.timeout)
        self._log(f"форма создания открыта: {self.page.url}", "DEBUG")
        return self.page.url

    def click_create_button(self) -> bool:
        """Совместимость со старым API."""
        self.open_create_form()
        return True

    def _last_row(self) -> dict | None:
        rows = self.page.locator(ROWS)
        if rows.count() == 0:
            return None
        cells = rows.nth(rows.count() - 1).locator("td")
        number = cells.nth(0).inner_text().strip() if cells.count() > 0 else ""
        question = cells.nth(1).inner_text().strip() if cells.count() > 1 else ""
        return {"number": number, "question": question}

    def get_last_question(self) -> tuple[int, str]:
        """Номер и текст последнего вопроса в тесте (уходит на последнюю страницу)."""
        if self.list_url:
            self.goto(self.list_url)

        rows = self.page.locator(ROWS)
        rows.first.wait_for(state="visible", timeout=self.timeout)

        pagination = self.page.locator("ul.pagination")
        if pagination.count() > 0:
            target = pagination.locator("li.last a")
            if target.count() == 0:
                pages = pagination.locator("li.page a")
                target = pages.last if pages.count() > 0 else None
            if target is not None and target.count() > 0:
                self._log("переход на последнюю страницу пагинации", "DEBUG")
                self.goto_link(target)
                rows.first.wait_for(state="visible", timeout=self.timeout)
        else:
            self._log("пагинации нет — все вопросы на одной странице", "DEBUG")

        row = self._last_row()
        if not row:
            self._log("строк в таблице нет", "WARNING")
            return 0, ""
        try:
            number = int(row["number"])
        except (TypeError, ValueError):
            number = 0
        return number, row["question"]

    # ------------------------------------------------------------- чтение формы
    def _read_form(self) -> dict:
        return self.page.evaluate(READ_FORM_JS)

    def _read_field(self, field_id: str) -> str | None:
        return self.page.evaluate(
            """(id) => {
                const ta = document.getElementById(id);
                if (!ta) return null;
                const inst = (window.CKEDITOR && CKEDITOR.instances[id]) || null;
                return inst ? inst.getData() : ta.value;
            }""",
            field_id,
        )

    # ------------------------------------------------------------- запись формы
    def _set_field(self, field_id: str, text: str, wait_editor: bool | None = None) -> None:
        wait_editor = self.wait_ckeditor if wait_editor is None else wait_editor
        if wait_editor:
            try:
                self.page.wait_for_function(
                    "(id) => !!(window.CKEDITOR && CKEDITOR.instances[id])",
                    arg=field_id, timeout=self.timeout,
                )
            except PWTimeout:
                self._log(
                    f"CKEditor для {field_id} не поднялся за {self.timeout} мс — "
                    "пишу в textarea напрямую", "WARNING",
                )
        self.page.evaluate(SET_FIELD_JS, {"id": field_id, "text": text})
        self.pause()

    def _set_field_verified(self, field_id: str, text: str, label: str) -> None:
        """Ставит текст и добивается совпадения (с повторами)."""
        want = norm(text)
        last_seen = None
        for attempt in range(1, self.verify_retries + 1):
            self._set_field(field_id, text)
            last_seen = norm(self._read_field(field_id))
            if last_seen == want:
                return
            self._log(
                f"{label}: текст не совпал (попытка {attempt}/{self.verify_retries}) "
                f"получено {last_seen[:60]!r}", "WARNING",
            )
            self.pause(self.timing.variant_settle)
        raise VerifyError(f"{label}: не удалось записать текст ({last_seen!r})")

    # ------------------------------------------------------------- проверки
    @staticmethod
    def _diff(state: dict, want_question: str, want_variants: list[str],
              answers: set[str], strict_extra: bool = False) -> list[str]:
        problems: list[str] = []

        got_question = norm(state.get("question"))
        if not got_question:
            problems.append("поле вопроса пустое")
        elif got_question != want_question:
            problems.append(f"текст вопроса не совпал: {got_question[:60]!r}")

        blocks = [b for b in (state.get("blocks") or []) if b.get("visible", True)]
        if len(blocks) < len(want_variants):
            problems.append(f"блоков вариантов {len(blocks)}, ожидалось {len(want_variants)}")

        for i, want in enumerate(want_variants):
            if i >= len(blocks):
                break
            block = blocks[i]
            got = norm(block.get("text"))
            if not got:
                problems.append(f"вариант #{i + 1} пустой")
            elif got != want:
                problems.append(f"вариант #{i + 1} не совпал: {got[:60]!r}")
            expect_correct = want in answers
            if bool(block.get("correct")) != expect_correct:
                problems.append(
                    f"вариант #{i + 1}: галочка={bool(block.get('correct'))}, "
                    f"ожидалось {expect_correct}"
                )

        # блоки сверх ожидаемых: залитые — всегда ошибка; пустые — только на
        # финальной проверке (иначе мешают заглушке, которую сайт рисует по умолчанию)
        extras = blocks[len(want_variants):]
        filled_extras = [b for b in extras if norm(b.get("text"))]
        if filled_extras:
            problems.append(f"лишних заполненных блоков: {len(filled_extras)}")
        elif extras and strict_extra:
            problems.append(f"лишних пустых блоков: {len(extras)}")
        return problems

    def verify(self, data: dict, upto: int | None = None, retries: int = 0,
               stage: str = "") -> list[str]:
        """Перечитывает страницу и сверяет её с данными вопроса.

        upto — сколько вариантов уже должно быть (проверка после каждого шага).
        retries > 0 — попытка автоматически починить расхождение и проверить снова.
        """
        raw_question = str(data["question"]).strip()
        raw_variants = [str(v).strip() for v in data["variants"]]
        upto = len(raw_variants) if upto is None else upto

        want_question = norm(raw_question)
        want_variants = [norm(v) for v in raw_variants[:upto]]
        answers = {norm(a) for a in data["answer"]}

        problems: list[str] = []
        for attempt in range(retries + 1):
            state = self._read_form()
            problems = self._diff(
                state, want_question, want_variants, answers,
                strict_extra=(upto == len(raw_variants)),
            )
            if not problems:
                self._log(f"проверка{stage} пройдена: вопрос + {upto} вариант(ов)", "DEBUG")
                return []
            self._log(
                f"проверка{stage}: {'; '.join(problems)} "
                f"(попытка {attempt + 1}/{retries + 1})", "WARNING",
            )
            if attempt == retries:
                break
            self._repair(raw_question, raw_variants, want_question, want_variants,
                         answers, state)
            self.pause(self.timing.variant_settle)
        return problems

    def _repair(self, raw_question: str, raw_variants: list[str], want_question: str,
                want_variants: list[str], answers: set[str], state: dict) -> None:
        """Чинит расхождения, найденные verify(): переписывает сбитые поля/галочки."""
        if norm(state.get("question")) != want_question:
            self._log("починка: переписываю текст вопроса", "WARNING")
            self._set_field(QUESTION_FIELD_ID, raw_question)

        blocks = state.get("blocks") or []
        for i, want in enumerate(want_variants):
            if i >= len(blocks) or i >= len(raw_variants):
                break
            if not blocks[i].get("visible", True):
                continue
            block = blocks[i]
            if norm(block.get("text")) != want and block.get("id"):
                self._log(f"починка: переписываю вариант #{i + 1}", "WARNING")
                self._set_field(block["id"], raw_variants[i])

            expect_correct = want in answers
            if bool(block.get("correct")) != expect_correct:
                self._log(
                    f"починка: галочка варианта #{i + 1} -> {expect_correct}", "WARNING",
                )
                checkbox = self.page.locator(ANSWER_BLOCKS).nth(i).locator(
                    'input[type="checkbox"]'
                )
                try:
                    if expect_correct:
                        checkbox.check(timeout=self.timeout)
                    else:
                        checkbox.uncheck(timeout=self.timeout)
                except Exception as exc:  # блок мог быть перерисован
                    self._log(f"починка галочки не удалась: {exc}", "ERROR")

    def _add_variant_block(self, index: int) -> str:
        """Гарантирует поле варианта под index, возвращает id textarea.

        Если форма уже содержит пустую заглушку — занимаем её, а не плодим блоки.
        """
        state = self._read_form()
        blocks = state.get("blocks") or []

        if index < len(blocks) and not norm(blocks[index].get("text")):
            field_id = blocks[index].get("id")
            if field_id:
                self.page.locator(ANSWER_BLOCKS).nth(index).locator("textarea") \
                    .first.wait_for(state="attached", timeout=self.timeout)
                self._log(f"поле варианта #{index + 1} уже существует — использую", "DEBUG")
                return field_id

        add_btn = self.page.locator(ADD_ANSWER).first
        add_btn.wait_for(state="visible", timeout=self.timeout)
        before = len(blocks)
        add_btn.click()

        self.page.wait_for_function(
            "(n) => document.querySelectorAll('#questions .nested-fields').length > n",
            arg=before, timeout=self.timeout,
        )
        block = self.page.locator(ANSWER_BLOCKS).nth(before)
        block.wait_for(state="attached", timeout=self.timeout)
        textarea = block.locator("textarea").first
        textarea.wait_for(state="attached", timeout=self.timeout)
        field_id = textarea.get_attribute("id")
        if not field_id:
            raise VerifyError("у нового поля варианта нет id textarea")
        return field_id

    # ------------------------------------------------------------- заполнение
    def fill_question(self, data: dict) -> dict:
        """Заполняет открытую форму: вопрос -> пауза -> варианты с проверками.

        НЕ сохраняет — сохранение делает save_question() (вызывает сервис).
        """
        started = time.monotonic()
        question = str(data["question"]).strip()
        variants = [str(v).strip() for v in data["variants"]]
        answers = {norm(a) for a in data["answer"]}
        variant_set = {norm(v) for v in variants}

        if len(variants) < 2:
            raise VerifyError("нужно минимум 2 варианта ответа")
        missing = sorted(answers - variant_set)
        if missing:
            raise VerifyError(f"ответ(ы) не входят в варианты: {missing}")
        if not answers:
            raise VerifyError("не отмечен ни один верный ответ")

        # 1. форма уже создана — даём полям устояться (минимум 1-2 с)
        self.page.locator(QUESTION_TEXTAREA).wait_for(state="attached", timeout=self.timeout)
        self.pause(self.timing.form_ready)
        self._log(f"вопрос: {question[:70]!r}")

        # 2. текст вопроса -> пауза перед вариантами
        self._set_field_verified(QUESTION_FIELD_ID, question, "вопрос")
        self.pause(self.timing.question_settle)
        problems = self.verify(data, upto=0, retries=self.verify_retries, stage=" (вопрос)")
        if problems:
            raise VerifyError("текст вопроса не подтвердился: " + "; ".join(problems))

        # 3. варианты: поле -> пауза -> текст -> галочка -> пауза -> проверка страницы
        for i, variant in enumerate(variants):
            is_correct = norm(variant) in answers

            field_id = self._add_variant_block(i)
            self.pause(self.timing.field_settle)          # поле создано, ждём 1-2 с

            self._set_field_verified(field_id, variant, f"вариант #{i + 1}")

            if is_correct:
                block = self.page.locator(ANSWER_BLOCKS).nth(i)
                block.locator('input[type="checkbox"]').check(timeout=self.timeout)
                self._log(f"  вариант #{i + 1}: отмечен как верный", "DEBUG")

            self.pause(self.timing.variant_settle)        # даём UI отработать

            # после КАЖДОГО добавления проходимся по всей форме
            problems = self.verify(
                data, upto=i + 1, retries=self.verify_retries,
                stage=f" (вариант #{i + 1}/{len(variants)})",
            )
            if problems:
                raise VerifyError(f"вариант #{i + 1}: " + "; ".join(problems))
            self._log(f"  вариант #{i + 1}/{len(variants)} записан и проверен", "DEBUG")

        # 4. финальная сквозная проверка
        problems = self.verify(data, retries=self.verify_retries, stage=" (финальная)")
        if problems:
            raise VerifyError("финальная проверка: " + "; ".join(problems))

        stats = {
            "question": question,
            "variants": len(variants),
            "correct": len(answers),
            "seconds": round(time.monotonic() - started, 1),
        }
        self._log(
            f"форма заполнена: {stats['variants']} вариантов "
            f"({stats['correct']} верных), {stats['seconds']} с", "INFO",
        )
        return stats

    # ------------------------------------------------------------- сохранение
    def _save_button_ready(self):
        button = self.page.locator(SAVE_BTN)
        button.wait_for(state="attached", timeout=self.timeout)
        try:
            self.page.wait_for_function(WAIT_ENABLED_JS, timeout=self.timeout)
        except PWTimeout:
            state = self.page.evaluate(DIAG_JS)
            self._log(f"кнопка «Сохранить» не разблокировалась: {state}", "ERROR")
            raise VerifyError("форма не прошла JS-валидацию (нет вариантов/ответов)")
        self.pause()
        return button

    def _after_save(self):
        if self._wait_any([(ROWS, "visible")]) is None:
            if self.list_url:
                self._log("список вопросов не появился — открываю его напрямую", "WARNING")
                self.goto(self.list_url)
            if self._wait_any([(ROWS, "visible")]) is None:
                raise VerifyError("после сохранения не открылся список вопросов")
        self.pause(self.timing.after_save)
        saved = self._last_row()
        self._log(f"сохранено, вернулись к списку: {saved}", "INFO")
        return saved

    def save_question(self):
        """Ждёт JS-валидации, сохраняет и возвращает первую строку списка."""
        button = self._save_button_ready()
        try:
            with self.page.expect_navigation(wait_until="domcontentloaded",
                                             timeout=self.timeout):
                button.click(no_wait_after=True)
        except PWTimeout:
            # сохранение ушло через AJAX/Turbolinks — навигации как таковой нет
            self._log("навигации после сохранения не было — жду таблицу вопросов", "DEBUG")
        return self._after_save()

    def _wait_any(self, checks: list[tuple[str, str]], timeout: int | None = None):
        """Ждёт появления любого из (селектор, state); возвращает индекс или None."""
        deadline = time.monotonic() + (self.timeout if timeout is None else timeout) / 1000
        while time.monotonic() < deadline:
            for index, (selector, state) in enumerate(checks):
                try:
                    self.page.locator(selector).first.wait_for(state=state, timeout=250)
                    return index
                except PWTimeout:
                    continue
            self.page.wait_for_timeout(250)
        return None
