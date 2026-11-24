from functools import wraps
import os

import shutil
from pathlib import Path, PurePosixPath
import uuid
import zipfile, tempfile
from flask import Response, jsonify, request
from sqlalchemy.orm import selectinload
import config
from config import settings
from werkzeug.utils import secure_filename
from . import models
from config.extensions import db
from .tools.library import _abs, _file_or_404, _list_dir, _recalc_size, sync_library_files, _extract_zip, _safe_name, _list_tree
from flask import send_file
from . import port
ROOT = Path(settings.LIBRARY_DIR).resolve()

# ------------------------------------------------------------------ helpers
def _body() -> dict:
    return request.get_json(silent=True) or {}


def _handle_errors(f):
    @wraps(f)
    def wrapper(*a, **kw):
        try:
            return f(*a, **kw)
        except (KeyError, FileNotFoundError) as e:
            return jsonify({"error": str(e)}), 404
        except (ValueError, RuntimeError) as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return wrapper


# ================================================================== tests
@_handle_errors
def get_list_tests():
    data = _body()
    test_id = data.get("id") or request.args.get("id", type=int)
    tests = port.get_list_tests()
    if test_id is not None:
        tests = [t for t in tests if str(t.get("id")) == str(test_id)]
    return jsonify({"data": tests})


@_handle_errors
def add_test():
    data = _body()
    if "id" not in data or "questions" not in data:
        return jsonify({"error": "Поля 'id' и 'questions' обязательны"}), 400
    test_data = port.save_test(id=data["id"], questions=data["questions"])
    return jsonify({"ok": True, "file": test_data["path"]}), 201


@_handle_errors
def delete_test(test_id: int):
    path = port.delete_test(test_id)
    return jsonify({"ok": True, "deleted": str(path)})


# ========================================================== materials input
@_handle_errors
def get_materials_input():
    return jsonify({"data": port.get_materials_input()})


@_handle_errors
def set_materials_input():
    materials = _body().get("materials", [])
    path = port.set_materials_input(materials)
    return jsonify({"ok": True, "file": str(path)})


@_handle_errors
def clear_materials_input():
    path = port.clear_materials_input()
    return jsonify({"ok": True, "file": str(path)})


# ============================================================ upload files
@_handle_errors
def get_upload_files():
    return jsonify({"data": port.get_upload_files()})


@_handle_errors
def set_upload_files():
    files = _body().get("files", [])
    path = port.set_upload_files(files)
    return jsonify({"ok": True, "file": str(path)})


@_handle_errors
def add_upload_files():
    files = _body().get("files", [])
    path = port.add_upload_files(files)
    return jsonify({"ok": True, "file": str(path)})


@_handle_errors
def clear_upload_files():
    path = port.clear_upload_files()
    return jsonify({"ok": True, "file": str(path)})


# =========================================================== links for scan
@_handle_errors
def get_links_for_scan():
    return jsonify({"data": port.get_links_for_scan()})


@_handle_errors
def set_links_for_scan():
    links = _body().get("links", [])
    path = port.set_links_for_scan(links)
    return jsonify({"ok": True, "file": str(path)})


@_handle_errors
def clear_links_for_scan():
    path = port.clear_links_for_scan()
    return jsonify({"ok": True, "file": str(path)})


# ================================================================== scan
@_handle_errors
def scan_data():
    return jsonify({"data": port.scan_data()})


# ================================================================== jobs
@_handle_errors
def list_jobs():
    return jsonify({"data": port.list_jobs()})


@_handle_errors
def get_job(job_id: str):
    return jsonify({"data": port.job_status(job_id)})


@_handle_errors
def pause_job(job_id: str):
    return jsonify({"id": job_id, "state": port.pause_job(job_id)})


@_handle_errors
def resume_job(job_id: str):
    return jsonify({"id": job_id, "state": port.resume_job(job_id)})


@_handle_errors
def cancel_job(job_id: str):
    return jsonify(port.cancel_job(job_id))


@_handle_errors
def cancel_all_jobs():
    port.cancel_all()
    return jsonify({"ok": True})


@_handle_errors
def clear_finished_jobs():
    port.clear_finished()
    return jsonify({"ok": True})


# ================================================================ tester
@_handle_errors
def tester_pick():
    return jsonify({"data": port.pick_test()})


@_handle_errors
def tester_fill():
    d = _body()
    job_id = port.fill_test(
        d.get("id"),
        engine=d.get("engine", "release"),
        limit=int(d.get("limit", 0)),
        verify_remote=bool(d.get("verify_remote", True)),
    )
    return jsonify({"job_id": job_id}), 202


@_handle_errors
def tester_local_check():
    job_id = port.local_check(_body().get("id"))
    return jsonify({"job_id": job_id}), 202

@_handle_errors
def tester_scan():
    job_id = port.scan_test(_body().get("id"))
    return jsonify({"job_id": job_id}), 202

@_handle_errors
def tester_get_list_tests():
    return port.get_list_tests()

@_handle_errors
def tester_save_test():
    d = _body()
    test_id   = d.get("id")
    questions = d.get("questions")

    if test_id is None:
        raise ValueError("Поле 'id' обязательно")
    if questions is None:
        raise ValueError("Поле 'questions' обязательно")

    test_data = port.save_test(id=test_id, questions=questions)

    return jsonify({
        "ok": True,
        **test_data,
    })


@_handle_errors
def tester_delete_test():
    d = _body()
    test_id = d.get("id")
    if test_id is None:
        raise ValueError("Поле 'id' обязательно")

    path = port.delete_test(id=test_id)

    return jsonify({
        "ok": True,
        "id": test_id,
        "deleted": str(path),
    })
# ================================================================ library
@_handle_errors
def library_collect():
    job_id = port.collect_materials(_body().get("urls"))
    return jsonify({"job_id": job_id}), 202


@_handle_errors
def library_exchange():
    job_id = port.exchange_materials(_body().get("file_data"))
    return jsonify({"job_id": job_id}), 202


@_handle_errors
def library_scan():
    job_id = port.library_scan(_body().get("urls"))
    return jsonify({"job_id": job_id}), 202


@_handle_errors
def library_upload():
    job_id = port.library_upload()
    return jsonify({"job_id": job_id}), 202


@_handle_errors
def library_set_tasks():
    tasks = _body().get("tasks", [])
    return jsonify(port.library_set_tasks(tasks)), 200
    
@_handle_errors
def library_get_tasks():
    return jsonify(port.library_get_tasks()), 200

@_handle_errors
def library_reorder_tasks():
    d = _body()
    return jsonify(port.library_reorder_tasks(d.get("folder_paths") or [])), 200

# views.py
@_handle_errors
def library_delete_tasks():
    d = _body()
    return jsonify(port.library_delete_tasks(
        folder_paths=d.get("folder_paths"),
        clear_all=bool(d.get("clear_all", False)),
    )), 200

@_handle_errors
def lib_add_folder():
    d = _body()
    folder_name = (d.get("folder_name") or "").strip()
    rel_path = (d.get("path") or "").strip().lstrip("/")   # "/" -> "", "/sub" -> "sub"

    if not folder_name:
        return jsonify({"error": "не указано имя папки"}), 400

    folder_name = _safe_name(folder_name)
    if not folder_name:
        return jsonify({"error": "некорректное имя папки"}), 400

    root = ROOT.resolve()
    folder = (root / rel_path / folder_name).resolve()

    # path traversal: только внутри библиотеки
    if not folder.is_relative_to(root):
        return jsonify({"error": "Небезопасный путь"}), 400

    try:
        folder.mkdir(parents=True, exist_ok=True)
    except FileExistsError:
        return jsonify({"error": f"Уже существует: {folder_name}"}), 409
    except OSError as e:
        # PermissionError, ENOSPC, длинное имя и т.п. -> 400, а не 500
        return jsonify({"error": f"Не удалось создать папку: {e.strerror}"}), 400

    return jsonify({
        "ok": True,
        "path": "/" + folder.relative_to(root).as_posix(),
    }), 201

@_handle_errors
def lib_save():
    files = request.files.getlist("file")
    raw = (request.form.get("folder") or "").strip()
    saved_files = []
    if not files:
        return jsonify({"error": "нет файлов: нужен multipart/form-data с полем 'file'"}), 400
    

        
    if raw != None:
        folder_name = _safe_name(raw)                      # без путей и ../
        folder = ROOT / folder_name
        created = not folder.exists()                  # чужую папку на диске при ошибке не удаляем
        folder.mkdir(parents=True, exist_ok=True)
    else:
        folder = ROOT
    
    created = False
    
    try:
        for file in files:
            if not file.filename:
                continue
            target = folder / _safe_name(file.filename)
            file.save(target)
            if target.suffix.lower() == ".zip" and zipfile.is_zipfile(target):
                zip_files = _extract_zip(target, folder / target.stem)
                target.unlink()
                for f in zip_files:
                    saved_files.append(f)
            else:
                saved_files.append({
                    "file_name": target.name,
                    "path": "/" + target.relative_to(folder).as_posix(),
                    "size": target.stat().st_size,
                })
    except Exception:
        if created:
            shutil.rmtree(folder, ignore_errors=True)
        raise

    return jsonify({"ok": True, "files": saved_files}), 201

@_handle_errors
def lib_move():
    d = _body()
    file_path, target_folder = d.get("file_path"), d.get("target_folder")      # folder_id целевой библиотеки
    if not file_path or not target_folder:
        return jsonify({"error": "Поля 'file_path' и 'target_folder' обязательны"}), 400

    
    src = (ROOT / file_path.lstrip("/")).resolve()
    target = (ROOT / target_folder.lstrip("/")).resolve()
    target.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(target / src.name))
    return jsonify({"ok": True, "new_path": str(target / src.name)}), 200

@_handle_errors
def lib_rename():
    d = _body()
    path = (d.get("path") or "").strip()
    new_name = (d.get("new_name") or "").strip()
    if not path or not new_name:
        return jsonify({"error": "Поля 'path' и 'new_name' обязательны"}), 400

    root = ROOT.resolve()
    src_raw = root / path.lstrip("/")          # literal — для rename
    src = src_raw.resolve()                    # resolved — для проверок

    # 1) path traversal: цель обязана быть внутри root
    if not src.is_relative_to(root):
        return jsonify({"error": "Небезопасный путь"}), 400

    # 2) существует ли (учитывая битые симлинки)?
    if not src_raw.exists() and not src_raw.is_symlink():
        return jsonify({"error": f"Путь {path} не найден"}), 404

    safe = _safe_name(new_name)
    target = src_raw.parent / safe

    # 3) target тоже внутри root
    if not target.resolve().is_relative_to(root):
        return jsonify({"error": "Небезопасный путь"}), 400

    # 4) no-op
    if target == src_raw:
        return jsonify({"ok": True,
                        "new_path": "/" + src_raw.relative_to(root).as_posix()}), 200

    # 5) коллизия: файл, папка или битый симлинк
    if target.exists() or target.is_symlink():
        kind = "папка" if target.is_dir() else "файл"
        return jsonify({"error": f"Уже существует {kind} «{safe}»"}), 409

    # 6) rename одинаково работает и для файлов, и для папок
    try:
        src_raw.rename(target)
    except FileNotFoundError:
        return jsonify({"error": f"Путь {path} не найден"}), 404
    except OSError as e:
        return jsonify({"error": f"Не удалось переименовать: {e.strerror}"}), 400

    return jsonify({"ok": True, "new_path": "/" + target.relative_to(root).as_posix()}), 200

@_handle_errors
def lib_get_full_library():
    data = []
    root_list = _list_tree(ROOT)
    for item in root_list:
        data.append(item)
    return jsonify({
        "current_path": "/",
        "data": data
        }), 200

@_handle_errors
def lib_get_current_list_dir():
    d = _body()
    current_path = (d.get("current_path") or "").strip()
    rel = current_path.lstrip("/")
    root = ROOT.resolve()
    current_dir = (root / rel).resolve() if rel else root

    if not current_dir.is_relative_to(root):
        return jsonify({"error": "Небезопасный путь"}), 400
    if not current_dir.exists() or not current_dir.is_dir():
        return jsonify({"error": f"Папка {current_path or '/'} не найдена"}), 404

    dir_list = _list_dir(current_dir)
    if rel:
        for item in dir_list:
            item["path"] = "/" + rel.rstrip("/") + "/" + item["path"].lstrip("/")

    return jsonify({
        "current_path": "/" + rel if rel else "/",
        "data": dir_list,
        "library_root": str(root),          # ← добавили
    }), 200



@_handle_errors
def lib_delete():
    d = _body()
    paths = d.get("paths", [])
    if not paths:
        return jsonify({"error": "Поля 'paths' обязательны"}), 400
    print(f"Deleting paths: {paths}")
    deleted = []
    for rel_path in paths:
        target = (ROOT / rel_path.lstrip("/")).resolve()
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
            deleted.append(str(target))
    return jsonify({"ok": True, "deleted": deleted}), 200

@_handle_errors
def lib_download():
    paths = request.args.getlist("path")                 # может быть несколько
    as_attachment = request.args.get("download") == "1"  # 1 — скачать, иначе показать в браузере
    if not paths:
        return jsonify({"error": "не указан path"}), 400

    root = Path(settings.LIBRARY_DIR).resolve()
    targets = []
    for p in paths:
        t = (root / p.lstrip("/")).resolve()
        if not t.is_relative_to(root) or not t.exists():   # защита от ../
            raise FileNotFoundError(p)
        targets.append(t)

    # Один файл — отдаём как есть
    if len(targets) == 1 and targets[0].is_file():
        return send_file(targets[0], as_attachment=as_attachment, download_name=targets[0].name)

    # Папка или несколько элементов — собираем zip
    tmp = tempfile.SpooledTemporaryFile(max_size=50 * 1024 * 1024)   # до 50 МБ в памяти, дальше на диске
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for t in targets:
            if t.is_file():
                zf.write(t, t.name)
            else:
                for f in t.rglob("*"):
                    if f.is_file():
                        zf.write(f, (Path(t.name) / f.relative_to(t)).as_posix())
    tmp.seek(0)
    name = (targets[0].name if len(targets) == 1 else "files") + ".zip"
    return send_file(tmp, mimetype="application/zip", as_attachment=True, download_name=name)


# ================================================================== config
@_handle_errors
def get_config():
    return Response(port.get_config(), mimetype="application/json")


@_handle_errors
def set_config():
    path = port.set_config(_body())
    return jsonify({"ok": True, "file": str(path)})