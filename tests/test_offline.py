"""Офлайн-тест логики fill_question/verify — фейковая страница, сеть не используется.

Запуск:  python tests/test_offline.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config
from modules.vshp_editor.modules.tester.release import (
    ADD_ANSWER, ANSWER_BLOCKS, CREATE_LINK, QUESTION_TEXTAREA, READ_FORM_JS, SAVE_BTN,
    SET_FIELD_JS, Actions, VerifyError, norm,
)

QUESTION_FIELD_ID = "tests_question_content"


# ----------------------------------------------------------------- фейковый DOM
class Loc:
    def __init__(self, form, sel, index=None):
        self.form, self.sel, self.index = form, sel, index

    @property
    def first(self):
        return self if self.index is not None else self.nth(0)

    def nth(self, i):
        return Loc(self.form, self.sel, i)

    def locator(self, sub):
        if self.sel == ANSWER_BLOCKS and sub == "textarea":
            return Loc(self.form, "textarea", self.index)
        if sub == 'input[type="checkbox"]':
            return Loc(self.form, "checkbox", self.index)
        return Loc(self.form, sub, self.index)

    def wait_for(self, state=None, timeout=None):
        if self.sel == ANSWER_BLOCKS and self.index is not None:
            assert self.index < len(self.form["blocks"]), f"нет блока {self.index}"

    def count(self):
        if self.sel == ANSWER_BLOCKS:
            return len(self.form["blocks"])
        if self.sel == CREATE_LINK:
            return 1
        return 0

    def click(self, **kwargs):
        if self.sel == ADD_ANSWER:
            i = len(self.form["blocks"])
            self.form["blocks"].append(
                {"id": f"a{i}", "text": "", "correct": False, "visible": True}
            )
            self.form["events"].append(("add_block", i))
        elif self.sel == SAVE_BTN:
            self.form["events"].append(("save",))

    def get_attribute(self, name, timeout=None):
        if self.sel == "textarea":
            return self.form["blocks"][self.index]["id"]
        if self.sel == CREATE_LINK:
            return "/questions/new"
        return None

    def check(self, timeout=None):
        self.form["blocks"][self.index]["correct"] = True

    def uncheck(self, timeout=None):
        self.form["blocks"][self.index]["correct"] = False

    def inner_text(self):
        return ""


class Page:
    def __init__(self, form):
        self.form = form
        self.pauses = []
        self.url = "https://erp.vshp.online/tests/tests/1/questions"

    def locator(self, sel):
        return Loc(self.form, sel)

    def wait_for_timeout(self, ms):
        self.pauses.append(ms)

    def wait_for_function(self, expr, arg=None, timeout=None):
        if isinstance(arg, int):
            assert len(self.form["blocks"]) > arg, "новый блок не появился"

    def evaluate(self, expr, arg=None):
        if expr is READ_FORM_JS or expr == READ_FORM_JS:
            return {
                "url": self.url,
                "question": self.form["question"],
                "blocks": [dict(b) for b in self.form["blocks"]],
            }
        if isinstance(arg, dict) and "text" in arg:            # SET_FIELD_JS
            fid, text = arg["id"], arg["text"]
            if fid == QUESTION_FIELD_ID:
                self.form["question"] = text
            else:
                for block in self.form["blocks"]:
                    if block["id"] == fid:
                        block["text"] = text
            return True
        if isinstance(arg, str):                               # чтение одного поля
            if arg == QUESTION_FIELD_ID:
                return self.form["question"]
            for block in self.form["blocks"]:
                if block["id"] == arg:
                    return block["text"]
            return None
        raise AssertionError("неожиданный JS")


def new_form():
    return {"question": "", "blocks": [], "events": []}


DATA = {
    "question": "Какой вопрос?",
    "variants": ["Алый", "Синий", "Зелёный"],
    "answer": ["Синий"],
}


def test_fill_sequence():
    form = new_form()
    page = Page(form)

    class Spy(Actions):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.checked = []

        def verify(self, data, upto=None, retries=0, stage=""):
            self.checked.append(upto)
            return super().verify(data, upto=upto, retries=retries, stage=stage)

    actions = Spy(page, list_url="http://x", timing=config.Timing(
        form_ready=10, question_settle=20, field_settle=30, variant_settle=40,
        after_save=50, short=5,
    ))
    stats = actions.fill_question(DATA)

    # после вопроса и после каждого варианта + финальная проверка
    assert actions.checked == [0, 1, 2, 3, None], actions.checked
    # порядок пауз: форма -> (вопрос: запись) -> вопрос -> [поле -> запись -> вариант] x3
    expected_pauses = [10, 5, 20, 30, 5, 40, 30, 5, 40, 30, 5, 40]
    assert page.pauses == expected_pauses, page.pauses
    # форма заполнена верно
    assert norm(form["question"]) == norm(DATA["question"])
    assert [norm(b["text"]) for b in form["blocks"]] == [norm(v) for v in DATA["variants"]]
    assert [b["correct"] for b in form["blocks"]] == [False, True, False]
    assert stats["variants"] == 3 and stats["correct"] == 1
    print("  fill_sequence OK: проверки", actions.checked, "| паузы", page.pauses)


def test_detects_and_repairs():
    form = new_form()
    page = Page(form)
    actions = Actions(page, list_url="http://x")
    # руками кладём «неправильное» состояние
    form["question"] = DATA["question"]
    for i, v in enumerate(DATA["variants"]):
        form["blocks"].append({"id": f"b{i}", "text": v, "correct": False, "visible": True})

    problems = actions.verify(DATA, upto=3, retries=0)
    assert problems and "галочка" in problems[0], problems
    assert len(problems) == 1, problems

    fixed = actions.verify(DATA, upto=3, retries=2)   # должен сам починить галочку
    assert fixed == [], fixed
    assert form["blocks"][1]["correct"] is True
    print("  detect/repair OK: сначала", problems, "-> починено")

    # сломанный текст тоже ловится
    form["blocks"][2]["text"] = "Фиолетовый"
    problems = actions.verify(DATA, upto=3, retries=0)
    assert any("не совпал" in p for p in problems), problems
    print("  detect text OK:", problems)


def test_rejects_bad_data():
    page = Page(new_form())
    actions = Actions(page, list_url="http://x")
    for bad in (
        {"question": "Q", "variants": ["A"], "answer": ["A"]},
        {"question": "Q", "variants": ["A", "B"], "answer": ["C"]},
        {"question": "Q", "variants": ["A", "B"], "answer": []},
    ):
        try:
            actions.fill_question(bad)
        except VerifyError as exc:
            print("  reject OK:", exc)
        else:
            raise AssertionError(f"приняли бы данные: {bad}")


test_fill_sequence()
test_detects_and_repairs()
test_rejects_bad_data()
print("ВСЕ ОФЛАЙН-ТЕСТЫ ЛОГИКИ ПРОШЛИ")
