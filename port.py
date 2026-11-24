from .modules.tester import service as tester_service
from .modules.library import service as library_service
from . import config
import json, os
from pathlib import Path
from dotenv import dotenv_values

import atexit
import itertools
import multiprocessing as mp
import pickle
import queue as _queue
import traceback
import psutil


def _entry(func, queue, args, kwargs):
    """Выполняется в дочернем процессе, кладёт результат в очередь."""
    try:
        result = func(*args, **kwargs)
        pickle.dumps(result)   # если результат нельзя передать, ошибка будет понятной
        queue.put(("done", result))
    except BaseException as e:
        queue.put(("error", f"{e}\n{traceback.format_exc()}"))


class ProcRunner:
    def __init__(self, func, *args, **kwargs):
        self.q = mp.Queue()
        self.p = mp.Process(target=_entry, args=(func, self.q, args, kwargs), daemon=True)
        self.state = "idle"        # idle | running | paused | done | error | cancelled
        self.result = None
        self.error = None
        self.ps = None
        self.name = None           # имя задачи (заполняет Port)
        self.lock = None           # Path заблокированного файла (заполняет Port)

    def start(self):
        self.p.start()
        self.ps = psutil.Process(self.p.pid)
        self.state = "running"
        return self

    @property
    def active(self) -> bool:
        """Задача ещё работает (или стоит на паузе)."""
        return self.state in ("running", "paused")

    def _all(self):
        """Процесс и все его потомки (браузеры, драйверы)."""
        try:
            return [self.ps, *self.ps.children(recursive=True)]
        except psutil.NoSuchProcess:
            return []

    def _each(self, method):
        for pr in self._all():
            try:
                getattr(pr, method)()
            except psutil.NoSuchProcess:
                pass

    def pause(self):
        if self.state == "running":
            self._each("suspend")
            self.state = "paused"

    def resume(self):
        if self.state == "paused":
            self._each("resume")
            self.state = "running"

    def cancel(self):
        if self.active:
            self._each("resume")   # на всякий случай: замороженный процесс убивается не везде одинаково
            self._each("kill")
        self.state = "cancelled"
        self.p.join(timeout=2)     # не оставлять зомби-процесс
        self.q.close()
        self.q.cancel_join_thread()

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
        kind, payload = msg
        if kind == "done":
            self.state, self.result = "done", payload
        else:
            self.state, self.error = "error", payload
        self.p.join(timeout=1)
        return self.state


class Port():
    def __init__(self):
        self.LS_materials_input = library_service.INPUT_FILE
        self.LS_UPLOAD_FILES = library_service.UPLOAD_FILES
        self.LS_links_for_scan = library_service.LINKS_FILE
        self.jobs: dict[str, ProcRunner] = {}
        self._counter = itertools.count(1)
        atexit.register(self.shutdown)   # не оставлять браузеры и драйверы при выходе

    # locks ==========================================================
    @staticmethod
    def _norm(path) -> Path:
        """Единый вид пути, чтобы 'test_5.json' и полный путь считались одним файлом."""
        p = Path(path)
        if not p.is_absolute() and not p.exists():
            p = Path(config.QUESTIONS_DIR) / p
        return p.resolve()

    def _busy_by(self, path) -> str | None:
        """id активной задачи, которая работает с этим файлом, или None."""
        target = self._norm(path)
        for job_id, job in list(self.jobs.items()):
            job.refresh()                      # завершившиеся задачи освобождают файл
            if job.active and job.lock == target:
                return job_id
        return None

    def _assert_free(self, path):
        job_id = self._busy_by(path)
        if job_id:
            raise RuntimeError(
                f"Файл {Path(path).name} занят задачей {job_id}. "
                f"Дождитесь завершения или отмените её."
            )

    # jobs ===========================================================
    def _start_job(self, name: str, func, *args, lock=None, **kwargs) -> str:
        """lock: путь к файлу, который нельзя менять, пока задача работает."""
        lock_path = None
        if lock is not None:
            self._assert_free(lock)            # один файл: одна задача
            lock_path = self._norm(lock)
        job_id = f"{name}_{next(self._counter)}"
        runner = ProcRunner(func, *args, **kwargs)
        runner.name, runner.lock = name, lock_path   # блокировка действует с момента запуска
        runner.start()
        self.jobs[job_id] = runner
        return job_id

    def _get_job(self, job_id: str) -> ProcRunner:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(f"Задача {job_id} не найдена.")
        return job

    def pause_job(self, job_id: str):
        job = self._get_job(job_id)
        job.pause()
        return job.state

    def resume_job(self, job_id: str):
        job = self._get_job(job_id)
        job.resume()
        return job.state

    def cancel_job(self, job_id: str):
        job = self.jobs.pop(job_id, None)   # сразу убираем из списка, файл освобождается
        if job is None:
            raise KeyError(f"Задача {job_id} не найдена.")
        job.cancel()
        return {"id": job_id, "removed": True}

    def cancel_all(self):
        for job_id in list(self.jobs):
            self.cancel_job(job_id)

    def shutdown(self):
        self.cancel_all()

    def job_status(self, job_id: str) -> dict:
        j = self._get_job(job_id)
        return {
            "id": job_id,
            "name": j.name,
            "state": j.refresh(),
            "locked_file": str(j.lock) if j.lock and j.active else None,
            "result": j.result,
            "error": j.error,
        }

    def list_jobs(self) -> list[dict]:
        return [self.job_status(job_id) for job_id in list(self.jobs)]

    def clear_finished(self):
        for job_id in list(self.jobs):
            if self.jobs[job_id].refresh() in ("done", "error"):
                del self.jobs[job_id]
    # data ========================================================

    # tests =====================================================
    def get_list_tests(self, id: int = None) -> list[dict]:
        tests = []
        if id is not None:
            test_file = config.QUESTIONS_DIR / f"test_{id}.json"
            if test_file.exists():
                try:
                    with open(test_file, "r", encoding="utf-8") as f:
                        test_data = json.load(f)
                    tests.append({
                        "file": test_file.name,
                        "size": os.path.getsize(test_file),
                        "content": test_data
                    })
                except Exception as e:
                    tests.append({
                        "file": test_file.name,
                        "error": str(e)
                    })
            else:
                tests.append({
                    "file": test_file.name,
                    "error": "Файл не найден"
                })
        else:
            for file in os.listdir(config.QUESTIONS_DIR):
                if file.endswith(".json"):
                    file_path = config.QUESTIONS_DIR / file
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            test_data = json.load(f)
                        tests.append({
                            "file": file,
                            "size": os.path.getsize(file_path),
                            "content": test_data
                        })
                    except Exception as e:
                        tests.append({
                            "file": file,
                            "error": str(e)
                        })
        return tests

    def add_test(self, id: int, questions: list[dict]):
        if not id:
            raise ValueError("Не указан идентификатор теста.")
        if not questions:
            raise ValueError("Список вопросов пуст.")

        test_file = config.QUESTIONS_DIR / f"test_{id}.json"
        self._assert_free(test_file)           # нельзя перезаписать файл, пока с ним работает задача
        test_data = {
            "id": id,
            "link": f"{config.BASE_URL}/tests/tests/{id}/questions",
            "questions": questions
        }
        with open(test_file, "w", encoding="utf-8") as f:
            json.dump(test_data, f, ensure_ascii=False, indent=2)
        return test_file

    def delete_test(self, id: int):
        test_file = config.QUESTIONS_DIR / f"test_{id}.json"
        self._assert_free(test_file)           # нельзя удалить файл, пока с ним работает задача
        if not test_file.exists():
            raise FileNotFoundError(f"Файл {test_file.name} не найден.")
        test_file.unlink()
        return test_file

    # library =====================================================

    # materials input =========================================================
    def get_materials_input(self) -> list:
        if not os.path.exists(self.LS_materials_input):
            return []
        with open(self.LS_materials_input, "r", encoding="utf-8") as f:
            return json.load(f)

    def set_materials_input(self, materials: list[dict]):
        with open(self.LS_materials_input, "w", encoding="utf-8") as f:
            json.dump(materials, f, ensure_ascii=False, indent=2)
        return self.LS_materials_input

    def clear_materials_input(self):
        with open(self.LS_materials_input, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, indent=2)
        return self.LS_materials_input

    # upload files ============================================================

    def set_upload_files(self, files: list[dict]):
        with open(self.LS_UPLOAD_FILES, "w", encoding="utf-8") as f:
            json.dump(files, f, ensure_ascii=False, indent=2)
        return self.LS_UPLOAD_FILES

    def get_upload_files(self) -> list:
        if not os.path.exists(self.LS_UPLOAD_FILES):
            return []
        with open(self.LS_UPLOAD_FILES, "r", encoding="utf-8") as f:
            return json.load(f)

    def add_upload_files(self, files: list[dict]):
        upload_files = self.get_upload_files()
        upload_files.extend(files)
        with open(self.LS_UPLOAD_FILES, "w", encoding="utf-8") as f:
            json.dump(upload_files, f, ensure_ascii=False, indent=2)
        return self.LS_UPLOAD_FILES

    def clear_upload_files(self):
        with open(self.LS_UPLOAD_FILES, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, indent=2)
        return self.LS_UPLOAD_FILES

    # links for scan =====================================================
    def get_links_for_scan(self) -> list:
        if not os.path.exists(self.LS_links_for_scan):
            return []
        with open(self.LS_links_for_scan, "r", encoding="utf-8") as f:
            return json.load(f)

    def set_links_for_scan(self, links: list[str]):
        with open(self.LS_links_for_scan, "w", encoding="utf-8") as f:
            json.dump(links, f, ensure_ascii=False, indent=2)
        return self.LS_links_for_scan

    def clear_links_for_scan(self):
        with open(self.LS_links_for_scan, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, indent=2)
        return self.LS_links_for_scan

    # ===============================================================
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
        data_dir = [
            self._read_entry(p) for p in Path(config.DATA_DIR).iterdir()
            if p.is_file() and p.suffix in (".json", ".txt")
        ]
        log_path = Path(config.LOG_DIR)
        logs = log_path.read_text(encoding="utf-8") if log_path.exists() else ""
        questions_dir = [self._read_entry(p) for p in Path(config.QUESTIONS_DIR).glob("*.json")]
        return [{"data_dir": data_dir}, {"logs": logs}, {"questions_dir": questions_dir}]

    # tester ========================================================
    def pick_test(self):
        tests = tester_service.list_tests()
        if not tests:
            print(f"В {config.QUESTIONS_DIR} нет файлов вопросов (*.json).")
            return None
        return tests

    def fill_test(self, path: str, engine: str = "default", resume: bool = False,
                  limit: int = 0, verify_remote: bool = True) -> str:
        if not path:
            raise ValueError("Не указан тест для заполнения.")
        return self._start_job(
            "fill_test", tester_service.fill_test, path,
            lock=path,
            engine=engine, resume=bool(resume), limit=int(limit), verify_remote=bool(verify_remote),
        )

    def local_check(self, path: str, engine: str = "default", limit: int = 0) -> str:
        if not path:
            raise ValueError("Не указан тест для проверки.")
        return self._start_job(
            "local_check", tester_service.local_check, path,
            lock=path,
            engine=engine, limit=int(limit),
        )

    def scan_test(self, path: str, engine: str = "default", limit: int = 0) -> str:
        if not path:
            raise ValueError("Не указан тест для сканирования.")
        return self._start_job(
            "scan_test", tester_service.scan_test, path,
            lock=path,
            engine=engine, limit=int(limit),
        )

    # library =========================================================

    def collect_materials(self, urls: list[str] | None = None) -> str:
        return self._start_job("collect", library_service.collect, urls=urls)

    def exchange_materials(self, file_data: str | Path | None = None) -> str:
        return self._start_job("exchange", library_service.exchange_files, file_data=file_data)

    def library_scan(self, urls: list[str] | None = None) -> str:
        return self._start_job("scan", library_service.scan, urls=urls)

    def library_upload(self, files: list[dict] | None = None) -> str:
        return self._start_job("upload", library_service.upload_from_file, files=files)

    # config =========================================================

    def get_config(self) -> str:
        env = dict(dotenv_values(config.BASE_DIR / ".env"))
        return json.dumps(env, ensure_ascii=False, indent=2)

    def set_config(self, new_config: dict | str):
        if isinstance(new_config, str):
            new_config = json.loads(new_config)   # JSON-строка -> dict

        env_path = config.BASE_DIR / ".env"
        existing_config = dict(dotenv_values(env_path))
        updated_config = {**existing_config, **new_config}

        with open(env_path, "w", encoding="utf-8") as f:
            for key, value in updated_config.items():
                f.write(f"{key}={value}\n")
        return env_path