# modules/vshp_editor/port.py
from .modules.tester import service as tester_service
from .modules.library import service as library_service
from . import config
import json
import os
from pathlib import Path
from dotenv import dotenv_values

import atexit
import multiprocessing as mp
import pickle
import queue as _queue
import threading
import traceback
import psutil


class PortError(Exception):
    """Ошибка операции Port с понятным сообщением для фронта."""


def _entry(func, queue, args, kwargs):
    """Выполняется в дочернем процессе, кладёт результат в очередь."""
    try:
        result = func(*args, **kwargs)
        pickle.dumps(result)   # если результат нельзя передать, ошибка будет понятной
        queue.put(("done", result))
    except BaseException as e:
        queue.put(("error", f"{e}\n{traceback.format_exc()}"))


class ProcRunner:
    def __init__(self, name: str, id: str, func, *args, **kwargs):
        self.name = name           # тип задачи: fill_test, scan, upload ...
        self.id = id               # на что задача направлена (id теста / ресурс библиотеки)
        self.q = mp.Queue()
        self.p = mp.Process(target=_entry, args=(func, self.q, args, kwargs), daemon=True)
        self.state = "idle"        # idle | running | paused | done | error | cancelled
        self.result = None
        self.error = None
        self.ps = None

    def start(self):
        try:
            self.p.start()
            self.ps = psutil.Process(self.p.pid)
            self.state = "running"
            return self
        except Exception as e:
            self.state, self.error = "error", str(e)
            raise PortError(f"Не удалось запустить процесс {self.name}:{self.id}: {e}") from e

    @property
    def active(self) -> bool:
        """Задача ещё работает (или стоит на паузе)."""
        return self.state in ("running", "paused")

    def _all(self):
        """Процесс и все его потомки (браузеры, драйверы)."""
        if self.ps is None:
            return []
        try:
            return [self.ps, *self.ps.children(recursive=True)]
        except psutil.NoSuchProcess:
            return []

    def _each(self, method, procs=None):
        for pr in (procs if procs is not None else self._all()):
            try:
                getattr(pr, method)()
            except psutil.NoSuchProcess:
                pass
            except Exception as e:
                print(f"[port] {self.name}:{self.id} {method} pid={getattr(pr, 'pid', '?')}: {e}")

    def pause(self):
        if self.state == "running":
            self._each("suspend")
            self.state = "paused"

    def resume(self):
        if self.state == "paused":
            self._each("resume")
            self.state = "running"

    def cancel(self):
        try:
            if self.active:
                procs = self._all()                # список снимаем один раз
                self._each("resume", procs)        # замороженный процесс убивается не везде одинаково
                self._each("kill", list(reversed(procs)))   # потомки первыми
            self.state = "cancelled"
            self.p.join(timeout=2)                 # не оставлять зомби-процесс
        except Exception as e:
            print(f"[port] cancel {self.name}:{self.id}: {e}")
            self.state = "cancelled"
        finally:
            try:
                self.q.close()
                self.q.cancel_join_thread()
            except Exception:
                pass

    def refresh(self):
        """Обновить статус: если процесс сам закончился, забираем результат."""
        if not self.active:
            return self.state
        try:
            # сначала читаем очередь: пока результат не прочитан, процесс может не завершиться
            msg = self.q.get_nowait()
        except _queue.Empty:
            if self.p.is_alive():
                return self.state
            try:
                msg = self.q.get(timeout=1)
            except _queue.Empty:
                self.state, self.error = "error", "Процесс завершился без результата"
                return self.state
        except Exception as e:
            self.state, self.error = "error", f"Ошибка чтения очереди: {e}"
            return self.state
        try:
            kind, payload = msg
            if kind == "done":
                self.state, self.result = "done", payload
            else:
                self.state, self.error = "error", payload
            self.p.join(timeout=1)
        except Exception as e:
            self.state, self.error = "error", f"Некорректный ответ процесса: {e}"
        return self.state


class Port:
    # id ресурсов библиотеки (с префиксом, чтобы не пересекались с id тестов)
    LIB_MATERIALS = "library:materials"
    LIB_LINKS = "library:links"
    LIB_UPLOAD = "library:upload"

    def __init__(self):
        self.LS_materials_input = library_service.INPUT_FILE
        self.LS_UPLOAD_FILES = library_service.UPLOAD_FILES
        self.LS_links_for_scan = library_service.LINKS_FILE
        self.jobs: dict[str, ProcRunner] = {}
        self._jobs_lock = threading.Lock()
        self.UPLOAD_TASKS_FILE = config.DATA_DIR / "UPLOAD_FILES.json"   # одно имя во всём проекте
        self.TASK_FIELDS = (
            "additional_name", "author", "discipline", "folder_path",
            "lecture_count", "locale", "organization", "presentation",
        )
        atexit.register(self.shutdown)   # не оставлять браузеры и драйверы при выходе

    # helpers ========================================================
    @staticmethod
    def _test_path(id) -> Path:
        return config.QUESTIONS_DIR / f"test_{id}.json"

    @staticmethod
    def _read_json_list(path, what: str = "файл") -> list:
        """Читает JSON-массив. Нет файла -> []. Битый файл -> RuntimeError."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return []
        except (json.JSONDecodeError, OSError) as exc:
            raise RuntimeError(f"не удалось прочитать {path}: {exc}") from exc
        if not isinstance(data, list):
            raise ValueError(f"{path} должен содержать JSON-массив")
        return data

    @staticmethod
    def _write_json(path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return path

    @staticmethod
    def _write_json_atomic(path: Path, data):
        tmp = path.with_suffix(path.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)

    # locks ==========================================================
    def _busy_by(self, id) -> str | None:
        """job_id активной задачи, которая работает с этим id, или None."""
        id = str(id)
        for job_id, job in list(self.jobs.items()):
            job.refresh()                      # завершившиеся задачи освобождают id
            if job.active and job.id == id:
                return job_id
        return None

    def _assert_free(self, id):
        job_id = self._busy_by(id)
        if job_id:
            raise RuntimeError(
                f"«{id}» занят задачей {job_id}. "
                f"Дождитесь завершения или отмените её."
            )

    # jobs ===========================================================
    def _start_job(self, name: str, id, func, *args, **kwargs) -> str:
        """name и id обязательны. Один id: одна активная задача."""
        if not name or id in (None, ""):
            raise ValueError("Для задачи нужны name и id.")
        id = str(id)
        with self._jobs_lock:
            self._assert_free(id)
            job_id = f"{name}:{id}"
            runner = ProcRunner(name, id, func, *args, **kwargs)
            runner.start()
            self.jobs[job_id] = runner     # завершённая запись с тем же ключом заменяется
        return job_id

    def _get_job(self, job_id: str) -> ProcRunner:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(f"Задача {job_id} не найдена.")
        return job

    def pause_job(self, job_id: str):
        try:
            job = self._get_job(job_id)
            job.pause()
            return job.state
        except KeyError:
            raise
        except Exception as e:
            raise PortError(f"pause_job {job_id}: {e}") from e

    def resume_job(self, job_id: str):
        try:
            job = self._get_job(job_id)
            job.resume()
            return job.state
        except KeyError:
            raise
        except Exception as e:
            raise PortError(f"resume_job {job_id}: {e}") from e

    def cancel_job(self, job_id: str):
        try:
            job = self.jobs.pop(job_id, None)   # сразу убираем из списка, id освобождается
            if job is None:
                raise KeyError(f"Задача {job_id} не найдена.")
            job.cancel()
            return {"id": job_id, "removed": True}
        except KeyError:
            raise
        except Exception as e:
            raise PortError(f"cancel_job {job_id}: {e}") from e

    def cancel_all(self):
        for job_id in list(self.jobs):
            try:
                self.cancel_job(job_id)
            except Exception as e:
                print(f"[port] cancel_all {job_id}: {e}")

    def shutdown(self):
        try:
            self.cancel_all()
        except Exception as e:
            print(f"[port] shutdown: {e}")

    def job_status(self, job_id: str) -> dict:
        try:
            j = self._get_job(job_id)
            state = j.refresh()
            return {
                "id": job_id,
                "name": j.name,
                "target": j.id,
                "state": state,
                "locked_id": j.id if j.active else None,
                "result": j.result,
                "error": j.error,
            }
        except KeyError:
            raise
        except Exception as e:
            raise PortError(f"job_status {job_id}: {e}") from e

    def list_jobs(self) -> list[dict]:
        out = []
        for job_id in list(self.jobs):
            try:
                out.append(self.job_status(job_id))
            except Exception as e:
                out.append({"id": job_id, "state": "error", "error": str(e)})
        return out

    def clear_finished(self):
        try:
            for job_id in list(self.jobs):
                if self.jobs[job_id].refresh() in ("done", "error"):
                    del self.jobs[job_id]
        except Exception as e:
            raise PortError(f"clear_finished: {e}") from e

    # tests (файлы) ==================================================
    def get_list_tests(self) -> list[dict]:
        tests = []
        try:
            test_files = os.listdir(config.QUESTIONS_DIR)
        except Exception as e:
            raise PortError(f"get_list_tests: {e}") from e
        for tf in sorted(test_files, reverse=True):
            path = config.QUESTIONS_DIR / tf
            if path.is_file():
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        tests.append(json.load(f))
                except Exception as e:
                    print(f"[tester] {tf}: {e}")
        return tests

    def save_test(self, id, questions: list[dict]):
        try:
            if not id:
                raise ValueError("Не указан идентификатор теста.")
            if not questions:
                raise ValueError("Список вопросов пуст.")
            self._assert_free(id)       # нельзя перезаписать, пока с тестом работает задача
            test_file = self._test_path(id)
            test_data = {
                "id": id,
                "url": f"{config.BASE_URL}/tests/tests/{id}/questions",
                "questions": questions,
                "path": str(test_file),
            }
            self._write_json(test_file, test_data)
            return test_data
        except (ValueError, RuntimeError):
            raise
        except Exception as e:
            raise PortError(f"save_test {id}: {e}") from e

    def delete_test(self, id):
        try:
            self._assert_free(id)       # нельзя удалить, пока с тестом работает задача
            test_file = self._test_path(id)
            if not test_file.exists():
                raise FileNotFoundError(f"Файл {test_file.name} не найден.")
            test_file.unlink()
            return test_file
        except (FileNotFoundError, RuntimeError):
            raise
        except Exception as e:
            raise PortError(f"delete_test {id}: {e}") from e

    # tester (задачи) ================================================
    def pick_test(self):
        try:
            tests = tester_service.list_tests()
            if not tests:
                print(f"В {config.QUESTIONS_DIR} нет файлов вопросов (*.json).")
                return None
            return tests
        except Exception as e:
            raise PortError(f"pick_test: {e}") from e

    def fill_test(self, id, engine: str = "release",
                  limit: int = 0, verify_remote: bool = True) -> str:
        try:
            if not id:
                raise ValueError("Не указан тест для заполнения.")
            return self._start_job(
                "fill_test", id, tester_service.fill_test, self._test_path(id),
                engine=engine, limit=int(limit), verify_remote=bool(verify_remote),
            )
        except (ValueError, RuntimeError):
            raise
        except Exception as e:
            raise PortError(f"fill_test {id}: {e}") from e

    def local_check(self, id) -> str:
        try:
            if not id:
                raise ValueError("Не указан тест для проверки.")
            return self._start_job(
                "local_check", id, tester_service.local_check, self._test_path(id)
            )
        except (ValueError, RuntimeError):
            raise
        except Exception as e:
            raise PortError(f"local_check {id}: {e}") from e

    def scan_test(self, id) -> str:
        try:
            if not id:
                raise ValueError("Не указан тест для сканирования.")
            return self._start_job(
                "scan_test", id, tester_service.scan_test, self._test_path(id)
            )
        except (ValueError, RuntimeError):
            raise
        except Exception as e:
            raise PortError(f"scan_test {id}: {e}") from e

    # library (задачи) ===============================================
    def collect_materials(self, urls: list[str] | None = None) -> str:
        try:
            return self._start_job("collect", self.LIB_LINKS,
                                   library_service.collect, urls=urls)
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"collect_materials: {e}") from e

    def exchange_materials(self, file_data: str | Path | None = None) -> str:
        try:
            return self._start_job("exchange", self.LIB_MATERIALS,
                                   library_service.exchange_files, file_data=file_data)
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"exchange_materials: {e}") from e

    def library_scan(self, urls: list[str] | None = None) -> str:
        try:
            return self._start_job("scan", self.LIB_LINKS,
                                   library_service.scan, urls=urls)
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"library_scan: {e}") from e

    def library_upload(self) -> str:
        try:
            return self._start_job("upload", self.LIB_UPLOAD,
                                   library_service.upload_from_file)
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"library_upload: {e}") from e

    # materials input ================================================
    def get_materials_input(self) -> list:
        try:
            if not os.path.exists(self.LS_materials_input):
                return []
            with open(self.LS_materials_input, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise PortError(f"get_materials_input: {e}") from e

    def set_materials_input(self, materials: list[dict]):
        try:
            self._assert_free(self.LIB_MATERIALS)
            return self._write_json(self.LS_materials_input, materials)
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"set_materials_input: {e}") from e

    def clear_materials_input(self):
        try:
            self._assert_free(self.LIB_MATERIALS)
            return self._write_json(self.LS_materials_input, [])
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"clear_materials_input: {e}") from e

    # upload files ===================================================
    def set_upload_files(self, files: list[dict]):
        try:
            self._assert_free(self.LIB_UPLOAD)
            return self._write_json(self.LS_UPLOAD_FILES, files)
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"set_upload_files: {e}") from e

    def get_upload_files(self) -> list:
        try:
            if not os.path.exists(self.LS_UPLOAD_FILES):
                return []
            with open(self.LS_UPLOAD_FILES, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise PortError(f"get_upload_files: {e}") from e

    def add_upload_files(self, files: list[dict]):
        try:
            self._assert_free(self.LIB_UPLOAD)
            upload_files = self.get_upload_files()
            upload_files.extend(files)
            return self._write_json(self.LS_UPLOAD_FILES, upload_files)
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"add_upload_files: {e}") from e

    def clear_upload_files(self):
        try:
            self._assert_free(self.LIB_UPLOAD)
            return self._write_json(self.LS_UPLOAD_FILES, [])
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"clear_upload_files: {e}") from e

    # links for scan =================================================
    def get_links_for_scan(self) -> list:
        try:
            if not os.path.exists(self.LS_links_for_scan):
                return []
            with open(self.LS_links_for_scan, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise PortError(f"get_links_for_scan: {e}") from e

    def set_links_for_scan(self, links: list[str]):
        try:
            self._assert_free(self.LIB_LINKS)
            return self._write_json(self.LS_links_for_scan, links)
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"set_links_for_scan: {e}") from e

    def clear_links_for_scan(self):
        try:
            self._assert_free(self.LIB_LINKS)
            return self._write_json(self.LS_links_for_scan, [])
        except RuntimeError:
            raise
        except Exception as e:
            raise PortError(f"clear_links_for_scan: {e}") from e

    # upload tasks (очередь загрузки) ================================
    def _normalize_task(self, t: dict) -> dict:
        """Все поля из TASK_FIELDS, отсутствующие -> None (для строк) / False (presentation)."""
        out = {}
        for k in self.TASK_FIELDS:
            v = t.get(k)
            if k == "presentation":
                out[k] = bool(v)
            elif k in ("locale", "organization", "lecture_count"):
                out[k] = int(v) if v not in (None, "") else None
            else:
                s = str(v).strip() if v is not None else ""
                out[k] = s or None
        return out

    def library_set_tasks(self, tasks: list[dict]) -> dict:
        try:
            if not tasks:
                return {"added": 0, "updated": 0, "total": 0}
            self._assert_free(self.LIB_UPLOAD)

            existing = self._read_json_list(self.UPLOAD_TASKS_FILE)

            # сохраняем существующий порядок; новые — в конец
            by_path, order = {}, []
            for t in existing:
                p = str(t.get("folder_path") or "")
                if p and p not in by_path:
                    by_path[p] = self._normalize_task(t)
                    order.append(p)

            added = updated = 0
            for t in tasks:
                if not isinstance(t, dict):
                    continue
                norm = self._normalize_task(t)
                p = norm["folder_path"]
                if not p:
                    continue
                if p in by_path:
                    by_path[p] = norm          # обновление «на месте»
                    updated += 1
                else:
                    by_path[p] = norm
                    order.append(p)            # новая — в конец
                    added += 1

            ordered = [by_path[p] for p in order]
            self._write_json_atomic(self.UPLOAD_TASKS_FILE, ordered)
            return {"existing": ordered, "added": added, "updated": updated,
                    "total": len(ordered)}
        except (ValueError, RuntimeError):
            raise
        except Exception as e:
            raise PortError(f"library_set_tasks: {e}") from e

    def library_get_tasks(self) -> dict:
        try:
            existing = self._read_json_list(self.UPLOAD_TASKS_FILE)
            return {"existing": existing, "total": len(existing)}
        except (ValueError, RuntimeError):
            raise
        except Exception as e:
            raise PortError(f"library_get_tasks: {e}") from e

    def library_delete_tasks(self, folder_paths: list[str] | None = None,
                             *, clear_all: bool = False) -> dict:
        """Удаляет задачи из очереди по folder_path (или очищает всю очередь).

        Возвращает {removed, remaining, total}.
        """
        try:
            self._assert_free(self.LIB_UPLOAD)
            existing = self._read_json_list(self.UPLOAD_TASKS_FILE)

            if clear_all:
                remaining = []
            else:
                if not folder_paths:
                    raise ValueError(
                        "не указано, что удалять: передайте folder_paths=[...] или clear_all=True"
                    )
                drop = {str(p) for p in folder_paths if p}
                remaining = [
                    t for t in existing
                    if str(t.get("folder_path") or "") not in drop
                ]

            removed = len(existing) - len(remaining)
            self._write_json_atomic(self.UPLOAD_TASKS_FILE, remaining)
            return {"removed": removed, "remaining": remaining, "total": len(remaining)}
        except (ValueError, RuntimeError):
            raise
        except Exception as e:
            raise PortError(f"library_delete_tasks: {e}") from e

    def library_reorder_tasks(self, folder_paths: list[str]) -> dict:
        """Перезаписывает очередь в порядке folder_paths.

        Задачи, которых нет в folder_paths, дописываются в конец.
        """
        try:
            if not folder_paths:
                raise ValueError("не указан порядок: передайте folder_paths=[...]")
            self._assert_free(self.LIB_UPLOAD)

            existing = self._read_json_list(self.UPLOAD_TASKS_FILE)
            if not existing:
                return {"existing": [], "total": 0}

            by_path = {str(t.get("folder_path") or ""): t
                       for t in existing if t.get("folder_path")}

            ordered, seen = [], set()
            for p in folder_paths:
                p = str(p)
                if p and p in by_path and p not in seen:
                    ordered.append(by_path[p])
                    seen.add(p)

            # осиротевшие задачи (были на диске, но не пришли в списке) — в конец
            for p, t in by_path.items():
                if p not in seen:
                    ordered.append(t)

            self._write_json_atomic(self.UPLOAD_TASKS_FILE, ordered)
            return {"existing": ordered, "total": len(ordered)}
        except (ValueError, RuntimeError):
            raise
        except Exception as e:
            raise PortError(f"library_reorder_tasks: {e}") from e

    # scan data ======================================================
    @staticmethod
    def _read_entry(path: Path) -> dict:
        try:
            if path.suffix == ".json":
                with open(path, "r", encoding="utf-8") as f:
                    content = json.load(f)
            else:
                content = path.read_text(encoding="utf-8")
            return {"file": path.name, "size": path.stat().st_size, "content": content}
        except Exception as e:
            return {"file": path.name, "error": str(e)}

    def scan_data(self):
        try:
            data_dir = [
                self._read_entry(p) for p in Path(config.DATA_DIR).iterdir()
                if p.is_file() and p.suffix in (".json", ".txt")
            ]
            log_path = Path(config.LOG_DIR)
            logs = log_path.read_text(encoding="utf-8") if log_path.is_file() else ""
            questions_dir = [self._read_entry(p)
                             for p in Path(config.QUESTIONS_DIR).glob("*.json")]
            return [{"data_dir": data_dir}, {"logs": logs}, {"questions_dir": questions_dir}]
        except Exception as e:
            raise PortError(f"scan_data: {e}") from e

    # config =========================================================
    def get_config(self) -> str:
        try:
            env = dict(dotenv_values(config.BASE_DIR / ".env"))
            return json.dumps(env, ensure_ascii=False, indent=2)
        except Exception as e:
            raise PortError(f"get_config: {e}") from e

    def set_config(self, new_config: dict | str):
        try:
            if isinstance(new_config, str):
                new_config = json.loads(new_config)   # JSON-строка -> dict
            if not isinstance(new_config, dict):
                raise ValueError("Конфиг должен быть JSON-объектом.")

            env_path = config.BASE_DIR / ".env"
            existing_config = dict(dotenv_values(env_path))
            updated_config = {**existing_config, **new_config}

            tmp = env_path.with_suffix(".env.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                for key, value in updated_config.items():
                    f.write(f"{key}={value}\n")
            tmp.replace(env_path)
            return env_path
        except ValueError:
            raise
        except Exception as e:
            raise PortError(f"set_config: {e}") from e