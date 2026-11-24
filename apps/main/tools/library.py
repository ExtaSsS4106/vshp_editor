import shutil, uuid, zipfile
from pathlib import Path, PurePosixPath
from sqlalchemy.orm import selectinload
from .. import models
import re
import shutil
import unicodedata
import uuid
import zipfile
from pathlib import Path

MAX_FILES = 5000
MAX_TOTAL = 500 * 1024 * 1024   # 500 МБ после распаковки


def _safe_name(filename: str) -> str:
    """Имя файла -> безопасное имя без путей.

    Возвращает "" (пустую строку), если после санитизации не осталось валидного имени.
    Решение, что делать с пустым результатом, — на вызывающем коде.
    """
    name = Path(filename.replace("\\", "/")).name
    name = unicodedata.normalize("NFC", name)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name[:200]

def _list_tree(path) -> list[dict]:
    if not path:
        return []
    result = []
    for p in path.rglob("*"):
        rel = p.relative_to(path)
        result.append({
            "name": p.name,
            "path": "/" + rel.as_posix(),
            "is_dir": p.is_dir(),
            "size": p.stat().st_size if p.is_file() else 0,
            "date_added": p.stat().st_ctime,
            "date_modified": p.stat().st_mtime
        })
    return result

def _list_dir(path) -> list[dict]:
    if not path:
        return []
    result = []
    for p in path.iterdir():
        result.append({
            "name": p.name,
            "path": "/" + p.relative_to(path).as_posix(),
            "is_dir": p.is_dir(),
            "size": p.stat().st_size if p.is_file() else 0,
            "date_added": p.stat().st_ctime,
            "date_modified": p.stat().st_mtime
        })
    return result

def _extract_zip(zip_path, dest) -> list:
    """Распаковывает zip в dest с защитой от zip-бомб и путей вида ../../x."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    extracted = []

    with zipfile.ZipFile(zip_path, "r") as zf:
        infos = zf.infolist()
        # защита от zip-бомбы: лимит на число файлов и общий размер после распаковки
        if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_TOTAL:
            raise ValueError("Архив слишком большой")

        for i in infos:
            name = i.filename
            # старые Windows-архивы хранят имена не в UTF-8 -> перекодируем, иначе кракозябры
            if not (i.flag_bits & 0x800):
                try:
                    name = name.encode("cp437").decode("cp866")
                except UnicodeError:
                    pass

            # служебный мусор macOS
            if name.startswith("__MACOSX/") or name.endswith(".DS_Store"):
                continue

            # zip slip: итоговый путь обязан остаться внутри dest
            target = (root / name).resolve()
            if not target.is_relative_to(root):
                raise ValueError(f"Небезопасный путь в архиве: {name}")

            if i.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue

            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(i) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
            # файл успешно записан -> добавляем в результат
            rel = target.relative_to(root)          # Path: "sub/file.txt"
            extracted.append({
                "file_name": target.name,           # "file.txt"
                "path": "/" + rel.as_posix(),       # "/sub/file.txt"
                "size": target.stat().st_size
            })

    return extracted

def _abs(lib, rel=""):
    """Абсолютный путь внутри библиотеки; выйти за её пределы нельзя (защита от ../)."""
    root = Path(lib.path).resolve()
    p = (root / rel).resolve()
    if not p.is_relative_to(root):
        raise ValueError("Путь вне библиотеки")
    return p


def _file_or_404(file_id):
    f = models.LibraryFile.query.filter_by(file_id=file_id).first()
    if not f:
        raise FileNotFoundError(f"Файл {file_id} не найден")   # _handle_errors превратит в 404
    return f


def _recalc_size(lib):
    """Общий размер библиотеки = сумма размеров её файлов из БД."""
    lib.size = (models.db.session.query(models.db.func.coalesce(models.db.func.sum(models.LibraryFile.size), 0))
                .filter(models.LibraryFile.library_id == lib.id).scalar())


def sync_library_files(lib):
    """Сканирует папку и приводит таблицу файлов в соответствие с диском.
    Существующие файлы сохраняют свой file_id, новые получают новый."""
    root = Path(lib.path)
    existing = {f.rel_path: f for f in lib.files}
    found = {p.relative_to(root).as_posix(): p.stat().st_size
             for p in root.rglob("*") if p.is_file()}

    for rel, size in found.items():
        rec = existing.get(rel)
        if rec:
            rec.size = size
        else:
            models.db.session.add(models.LibraryFile(
                library=lib,
                name=Path(rel).name, rel_path=rel, size=size))

    for rel, rec in existing.items():
        if rel not in found:
            models.db.session.delete(rec)

    lib.size = sum(found.values())
    lib.date_modified = models.db.func.now()
    return len(found)