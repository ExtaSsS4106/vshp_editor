"""Сценарии работы с библиотекой — по образцу Library_return.py.

Функции-сценарии (вызываются из главного меню):
  * collect()          — по поисковым ссылкам найти материалы без файла;
  * scan_library()     — пройти всю библиотеку постранично (счётчики + материалы);
  * exchange_files()   — заменить файлы по данным из materials_input.json;
  * upload_from_file() — загрузка PDF из UPLOAD_FILES.json.

Вход/выход — JSON в data/, как в оригинале: library_links.json,
materials_input.json, materials_out.json, library_out.json.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from ... import config
from ...core.auth import Auth
from ...core.browser import browser_session
from ...log import get_logger
from .actions import Actions
from .uploader import MaterialUploader

log = get_logger(__name__)

LINKS_FILE = config.DATA_DIR / "library_links.json"
INPUT_FILE = config.DATA_DIR / "materials_input.json"
MATERIALS_OUT = config.DATA_DIR / "materials_out.json"
LIBRARY_OUT = config.DATA_DIR / "library_out.json"

UPLOAD_FILES = config.DATA_DIR / "UPLOAD_FILES.json"

DEFAULT_LIST_URL = f"{config.BASE_URL}/material_sources"


def _load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("%s не прочитан (%s) — использую значение по умолчанию", path.name, exc)
        return default


def _save_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("сохранено: %s", path)


def load_links() -> list[str]:
    data = _load_json(LINKS_FILE, {})
    links = data.get("links") if isinstance(data, dict) else data
    return [str(u) for u in (links or [])]


# ------------------------------------------------------------------------ collect
def collect(urls: list[str] | None = None) -> dict:
    """Ищет по поисковым ссылкам материалы с «Файл не найден», пишет materials_out.json."""
    urls = urls if urls is not None else load_links()
    if not urls:
        log.warning("нет поисковых ссылок (%s)", LINKS_FILE.name)
        return {"count": 0, "links": [], "materials": 0}

    urls_edit: list[str] = []
    materials: list[dict] = []
    Actions.log(f"collect: старт, поисковых ссылок: {len(urls)}", start=True)
    log.info("=== collect: поисковых ссылок: %d", len(urls))

    with browser_session() as page:
        auth = Auth()

        # 1) поисковые ссылки -> ссылки на редактирование
        for number, link in enumerate(urls, start=1):
            log.info("collect: [%d/%d] %s", number, len(urls), link)
            auth.ensure_login(page, link)
            found = Actions.getLinksForEdit(page)
            log.info("collect: [%d/%d] найдено ссылок для правки: %d",
                     number, len(urls), len(found))
            urls_edit.extend(found)

        log.info("всего ссылок для правки: %d", len(urls_edit))

        # 2) по каждой ссылке — имя файла и заголовок
        for i, url in enumerate(urls_edit, start=1):
            log.info("collect: [%d/%d] %s", i, len(urls_edit), url)
            auth.ensure_login(page, url)
            file_name, title = Actions.getFileName(page)
            if file_name is None and title is None:
                log.warning("данные не получены: %s", url)
            materials.append({
                "material_source_file_name": file_name,
                "material_source_title": title,
                "url": url,
            })

    _save_json(MATERIALS_OUT, materials)
    log.info("collect завершён: %d ссылок, %d материалов -> %s",
             len(urls_edit), len(materials), MATERIALS_OUT.name)
    return {"count": len(urls_edit), "links": urls_edit, "materials": len(materials)}


# ------------------------------------------------------------------------ scan
def scan_library(link: str | None = None, collect_files: bool = True,
                 headless: bool = True) -> dict:
    """Постраничный обход библиотеки: library_out.json (+ materials_out.json)."""
    link = link or DEFAULT_LIST_URL
    urls_edit: list[str] = []
    log.info("=== scan_library: %s", link)
    Actions.log(f"scan_library: старт: {link}", start=True)

    with browser_session(headless=headless) as page:
        auth = Auth()
        auth.ensure_login(page, link)
        page_no = 0
        while True:
            page_no += 1
            found = Actions.getLinksForEdit(page)
            log.info("scan_library: страница %d, ссылок для правки: %d", page_no, len(found))
            urls_edit.extend(found)
            if not Actions.goToNextPage(page):
                break

        counts = Counter(urls_edit)
        links = [{"url": url, "count": cnt} for url, cnt in counts.items()]
        result = {"count": len(links), "total": len(urls_edit), "links": links,
                  "scan_url": link}
        _save_json(LIBRARY_OUT, result)
        log.info("scan_library: сохранено %d уникальных ссылок (всего вхождений %d)",
                 len(links), len(urls_edit))

        if not collect_files or not urls_edit:
            if not collect_files:
                log.info("сбор материалов отключён — выходим")
            return result

        materials: list[dict] = []
        for i, url in enumerate(urls_edit, start=1):
            log.info("scan_library: [%d/%d] %s", i, len(urls_edit), url)
            auth.ensure_login(page, url)
            file_name, title = Actions.getFileName(page)
            if file_name is None and title is None:
                log.warning("данные не получены: %s", url)
            materials.append({
                "material_source_file_name": file_name,
                "material_source_title": title,
                "url": url,
            })
        _save_json(MATERIALS_OUT, materials)

    return result


# ------------------------------------------------------------------------ exchange
def load_exchange_tasks() -> list[dict]:
    """Задачи замены файлов: [{"url": ..., "file_path": ...}, ...]."""
    data = _load_json(INPUT_FILE, [])
    return data if isinstance(data, list) else []


def exchange_files(file_data: str | Path | None = None) -> dict:
    """Заменяет файлы по материалам из materials_input.json ({"file_path", "url"})."""
    path = Path(file_data) if file_data else INPUT_FILE
    materials = _load_json(path, []) if file_data else load_exchange_tasks()
    if not isinstance(materials, list):
        materials = []
    if not materials:
        log.error("%s пуст или не найден — заменять нечего", path)
        return {"uploaded": 0, "failed": 0}

    log.info("=== exchange_files: %s, материалов: %d", path.name, len(materials))
    Actions.log(f"exchange_files: старт, материалов {len(materials)}", start=True)

    uploaded = failed = 0
    with browser_session() as page:
        auth = Auth()
        for i, item in enumerate(materials, start=1):
            url = item.get("url")
            file_path = item.get("file_path")
            if not url:
                log.warning("[%d/%d] нет url — пропуск", i, len(materials))
                failed += 1
                continue
            log.info("[%d/%d] %s <- %s", i, len(materials), url, file_path)
            auth.ensure_login(page, url)
            ok = Actions.setFile(page, file_path)
            uploaded += int(ok)
            failed += int(not ok)

    log.info("exchange_files завершён: загружено %d, ошибок %d", uploaded, failed)
    return {"uploaded": uploaded, "failed": failed}


# ------------------------------------------------------------------------ upload
def load_UPLOAD_FILES() -> list[dict]:
    tasks = _load_json(UPLOAD_FILES, [])
    return tasks if isinstance(tasks, list) else []


def preview_upload(tasks: list[dict] | None = None) -> dict:
    """Предпросмотр загрузки PDF: файлы → заголовки, коллизии, ошибки задач.

    Только чтение диска — сеть и браузер не используются.
    """
    if tasks is None:
        tasks = load_UPLOAD_FILES()
    return MaterialUploader().preview(tasks)


def upload_from_file(tasks: list[dict] | None = None) -> list[dict]:
    """Загрузка PDF по задачам из data/UPLOAD_FILES.json."""
    if tasks is None:
        tasks = load_UPLOAD_FILES()
    if not tasks:
        log.warning("нет задач для загрузки (%s)", UPLOAD_FILES.name)
        return []
    log.info("=== upload: задач %d", len(tasks))
    return MaterialUploader().run(tasks)
