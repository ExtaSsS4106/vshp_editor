"""Загрузка PDF-презентаций в библиотеку (/material_sources/new).

Логика перенесена из library_uploader.py, но:
  * нет кода, выполняющегося при импорте — только класс;
  * вход — список задач из data/upload_tasks.json (см. service.upload_from_file);
  * логин через core.auth.Auth, запуск через core.browser.browser_session.
"""

from __future__ import annotations

import re
import time
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import Page

from ... import config
from ...core.auth import Auth
from ...core.browser import browser_session
from ...log import get_logger

log = get_logger(__name__)

LIST_FILE = config.DATA_DIR / "list_files.txt"


class MaterialUploader:
    # поля, без которых задача загрузки бессмысленна (раньше «дотягивались»
    # из предыдущей задачи из-за self.data.update(task) и уезжали молча)
    REQUIRED = ("discipline", "folder_path", "organization", "locale", "author")

    def __init__(self, email: str | None = None, password: str | None = None):
        self.auth = Auth(email, password)
        self.BASE = config.BASE_URL
        self.NEW_URL = f"{self.BASE}/material_sources/new"
        self.LIST_URL = f"{self.BASE}/material_sources"
        self.timeout = config.WAIT_TIMEOUT
        self.data: dict = {}

        self.organizations = {
            1: "ЧУВО «ВШП»",
            2: "ЧУПО «ВШП»",
            3: "ЧОУ «ВШП»",
            4: "Sàrl «SIIL»",
            5: "ООО «ВШП»",
            6: 'АНО ВО "Синергия"',
        }

        self.locales = {1: "RU", 2: "EN", 3: "FR", 4: "ZH-CN", 5: "ES", 6: "DE"}
        self.locale_codes = {1: "ru", 2: "en", 3: "fr", 4: "zh-CN", 5: "es", 6: "de"}

        self.titles = {
            1: {"RU": "Лекция", "EN": "Lecture", "FR": "Conférence",
                "ZH-CN": "讲座", "ES": "Conferencia", "DE": "Vorlesung"},
            2: {"RU": "Конспект", "EN": "Summary", "FR": "Résumé",
                "ZH-CN": "摘要", "ES": "Resumen", "DE": "Zusammenfassung"},
            3: {"RU": "Часть", "EN": "Part", "FR": "Partie",
                "ZH-CN": "部分", "ES": "Parte", "DE": "Teil"},
        }

    # ------------------------------------------------------------------ служебное
    @staticmethod
    def _norm(s: str) -> str:
        return " ".join(s.split())

    @staticmethod
    def natural_key(s: str):
        return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]

    def material_exists(self, page: Page, title: str) -> bool:
        """Есть ли на сайте материал с точно таким заголовком."""
        page.goto(f"{self.LIST_URL}?q={quote(title)}", wait_until="domcontentloaded",
                  timeout=self.timeout)
        try:
            page.wait_for_selector("table.table", timeout=self.timeout)
        except Exception:
            return False

        found_titles = page.eval_on_selector_all(
            "tbody.js-collection tr td:nth-child(2)",
            """els => els.map(el => {
                const first = el.firstChild;
                return first && first.nodeType === 3 ? first.textContent.trim() : '';
            })""",
        )
        target = self._norm(title)
        return any(self._norm(t) == target for t in found_titles)

    # ------------------------------------------------------------------ заголовки
    def build_title(self, count: int) -> str:
        """Заголовок для count-го файла текущей задачи (self.data)."""
        locale_name = self.locales[self.data["locale"]]
        additional = str(self.data.get("additional_name") or "").strip()
        discipline = str(self.data["discipline"]).strip()
        part = str(self.data.get("lecture_count") or "")

        if not part:
            if self.data.get("presentation"):
                parts = [self.titles[1][locale_name], str(count), additional]
                return f"{discipline.rstrip('.')}. " + " ".join(p for p in parts if p)
            parts = [discipline, "Лекция", str(count), additional]
            return f"{self.titles[2][locale_name]}: " + " ".join(p for p in parts if p)

        if self.data.get("presentation"):
            parts = [self.titles[1][locale_name], part, additional,
                     self.titles[3][locale_name], str(count)]
            return f"{discipline.rstrip('.')}. " + " ".join(p for p in parts if p)
        parts = [discipline, "Лекция", part, additional, self.titles[3][locale_name], str(count)]
        return f"{self.titles[2][locale_name]}: " + " ".join(p for p in parts if p)

    # ------------------------------------------------------------------ файлы
    @staticmethod
    def pdf_entries(folder: str | Path) -> list[tuple[int, str]]:
        """(позиция, имя PDF) для папки.

        Нумерация совпадает с upload_file: счётчик идёт по всем файлам папки
        в natural-порядке, но отдаются только *.pdf — иначе предпросмотр
        заголовков разошёлся бы с реальной загрузкой.
        """
        path = Path(folder)
        if not path.is_dir():
            return []
        files = sorted((p.name for p in path.iterdir()), key=MaterialUploader.natural_key)
        return [(count, name) for count, name in enumerate(files, start=1)
                if name.lower().endswith(".pdf")]

    # ------------------------------------------------------------------ предпросмотр
    def preview(self, tasks: list[dict]) -> dict:
        """Локальный предпросмотр: какие файлы и с какими заголовками уйдут.

        Ни логина, ни браузера, ни обращений к сайту — только чтение диска.
        Коллизия = одинаковый заголовок у двух файлов внутри одного прогона:
        вторая загрузка будет пропущена как «уже существует».
        """
        task_rows: list[dict] = []
        rows: list[dict] = []
        errors: list[str] = []
        seen: dict[str, list[str]] = {}

        for index, task in enumerate(tasks, start=1):
            task = task if isinstance(task, dict) else {}
            discipline = str(task.get("discipline") or "?").strip() or "?"
            info = {
                "task": index,
                "discipline": discipline,
                "presentation": bool(task.get("presentation")),
                "lecture": str(task.get("lecture_count") or "") or None,
                "additional": str(task.get("additional_name") or "") or None,
                "folder": str(task.get("folder_path") or ""),
            }

            missing = [key for key in self.REQUIRED
                       if not str(task.get(key) or "").strip()]
            if missing:
                reason = f"нет полей: {', '.join(missing)}"
            elif task.get("locale") not in self.locales:
                reason = f"locale {task.get('locale')!r} не поддерживается"
            elif not Path(str(task.get("folder_path") or "")).is_dir():
                reason = "папка не найдена"
            else:
                reason = ""
            if reason:
                errors.append(f"задача {index} ({discipline}): {reason}")
                task_rows.append({**info, "status": "error", "reason": reason, "files": 0})
                continue

            entries = self.pdf_entries(task["folder_path"])
            if not entries:
                reason = "в папке нет PDF"
                errors.append(f"задача {index} ({discipline}): {reason}")
                task_rows.append({**info, "status": "error", "reason": reason, "files": 0})
                continue

            task_rows.append({**info, "status": "ok", "reason": "", "files": len(entries)})
            for count, file in entries:
                self.data = dict(task)          # чистый словарь, без «хвостов» задач
                try:
                    title = self.build_title(count)
                except (KeyError, ValueError) as exc:
                    errors.append(f"задача {index}: не собрать заголовок {file} ({exc})")
                    continue
                rows.append({"task": index, "discipline": discipline,
                             "file": file, "title": title})
                seen.setdefault(title, []).append(f"{discipline}/{file}")

        collisions = [{"title": title, "files": files}
                      for title, files in seen.items() if len(files) > 1]
        return {
            "tasks": task_rows,
            "rows": rows,
            "collisions": collisions,
            "errors": errors,
            "total_files": len(rows),
            "total_titles": len(seen),
        }

    # ------------------------------------------------------------------ цикл
    def upload_file(self, page: Page) -> list[dict]:
        results: list[dict] = []
        folder = Path(self.data["folder_path"])
        discipline = str(self.data.get("discipline") or "?")

        def write(text: str) -> None:
            with open(LIST_FILE, "a", encoding="utf-8") as handle:
                handle.write(text)

        write(f"\n{discipline}:\n")

        if not folder.is_dir():
            reason = f"папка не найдена: {folder}"
            log.error(reason)
            write(f"[ERROR] {reason}\n")
            return [{"file": None, "title": None, "status": "error", "reason": reason}]

        files = sorted((p.name for p in folder.iterdir()), key=self.natural_key)
        if not files:
            reason = f"в папке нет файлов: {folder}"
            log.error(reason)
            write(f"[ERROR] {reason}\n")
            return [{"file": None, "title": None, "status": "error", "reason": reason}]

        for count, file in enumerate(files, start=1):
            if not file.lower().endswith(".pdf"):
                log.debug("пропускаю не-PDF: %s", file)
                write(f"{file} -> [SKIP, не PDF]\n")
                results.append({"file": file, "title": None, "status": "skip_non_pdf"})
                continue

            full_path = folder / file
            title = self.build_title(count)
            log.info("[%d] %s -> %s", count, file, title)

            try:
                if self.material_exists(page, title):
                    log.warning("    ↳ УЖЕ СУЩЕСТВУЕТ, пропускаю: %s", title)
                    with open(LIST_FILE, "a", encoding="utf-8") as handle:
                        handle.write(f"{file} -> [SKIP, уже есть] {title}\n")
                    results.append({"file": file, "title": title, "status": "skip"})
                    continue
            except Exception as exc:
                log.warning("    ↳ ошибка проверки: %s. продолжаем", exc)

            page.goto(self.NEW_URL, wait_until="domcontentloaded", timeout=self.timeout)
            page.wait_for_selector('input[name="material_source[title]"]',
                                   timeout=self.timeout)
            page.fill('input[name="material_source[title]"]', title)
            page.select_option('select[name="material_source[organization_id]"]',
                               value=str(self.data["organization"]))
            if self.locale_codes[self.data["locale"]] != "ru":
                page.select_option('select[name="material_source[locale]"]',
                                   value=self.locale_codes[self.data["locale"]])
            page.fill('input[name="material_source[author]"]', self.data["author"])
            page.set_input_files('input[name="material_source[file]"]', str(full_path))

            try:
                page.click('input[name="commit"]', timeout=self.timeout)
            except Exception:
                # клик прошёл, но навигация не дождалась
                pass
            page.wait_for_selector('input[name="material_source[title]"]',
                                   state="detached", timeout=0)

            with open(LIST_FILE, "a", encoding="utf-8") as handle:
                handle.write(f"{file} -> {title}\n")
            results.append({"file": file, "title": title, "status": "uploaded"})
            time.sleep(2)

        return results

    def run(self, tasks: list[dict] | None = None) -> list[dict]:
        """Прогоняет список задач; результаты пишутся в data/list_files.txt."""
        if not tasks:
            log.warning("список задач пуст — загружать нечего")
            return []

        results: list[dict] = []
        with browser_session() as page:
            self.auth.ensure_login(page, self.NEW_URL, wait_until="domcontentloaded")
            for number, task in enumerate(tasks, start=1):
                task = task if isinstance(task, dict) else {}
                discipline = str(task.get("discipline") or "?")
                log.info("--- задача %d/%d: %s", number, len(tasks), discipline)

                # раньше было self.data.update(task): поля предыдущей задачи
                # перетекали в следующую и «лечили» уже в чужой файл
                self.data = dict(task)

                missing = [key for key in self.REQUIRED
                           if not str(self.data.get(key) or "").strip()]
                if missing:
                    reason = f"нет полей: {', '.join(missing)}"
                elif self.data.get("locale") not in self.locales:
                    reason = f"locale {self.data.get('locale')!r} не поддерживается"
                else:
                    reason = ""
                if reason:
                    log.error("задача %d пропущена — %s", number, reason)
                    results.append({"task": number, "discipline": discipline,
                                    "file": None, "title": None,
                                    "status": "error", "reason": reason})
                    continue

                results.extend(self.upload_file(page))

        uploaded = sum(1 for item in results if item.get("status") == "uploaded")
        skipped = sum(1 for item in results if str(item.get("status", "")).startswith("skip"))
        errors = sum(1 for item in results if item.get("status") == "error")
        log.info("загрузка завершена: записей %d (загружено %d, пропущено %d, ошибок %d)",
                 len(results), uploaded, skipped, errors)
        return results
