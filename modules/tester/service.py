"""Сценарии работы с тестами — по образцу Library_return.py.

Принципы, перенесённые оттуда:
  * отдельные функции-сценарии (local_check / scan_test / fill_test);
  * данные в JSON внутри data/ (вход — файл вопросов, выход — tests_out.json
    и tests_progress.json, обновляемый после каждого сохранённого вопроса);
  * заход на страницу через Auth.ensure_login() — логин только если нужен;
  * подробный лог каждого шага (журнал logs/vshp_editor.log).

ВАЖНО: scan_test() только читает сайт, fill_test() — единственный сценарий,
который отправляет данные, и он всегда идёт через явное подтверждение в main.py.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from pathlib import Path

from ... import config

from ...core.auth import Auth
from ...core.browser import browser_session
from ...log import get_logger
from . import ENGINES
from .release import VerifyError, norm

log = get_logger(__name__)

PROGRESS_FILE = config.DATA_DIR / "tests_progress.json"
SCAN_FILE = config.DATA_DIR / "tests_out.json"


# ------------------------------------------------------------------ локальная часть
def list_tests() -> list[dict]:
    """Файлы вопросов из data/questions/*.json."""
    tests: list[dict] = []
    for path in sorted(config.QUESTIONS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("не удалось прочитать %s: %s", path.name, exc)
            continue
        questions = data.get("questions") or []
        tests.append({
            "path": path,
            "id": data.get("id") or path.stem,
            "url": data.get("url") or "",
            "count": len(questions),
        })
    return tests


def load_test(path: str | Path) -> dict:
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
        raise ValueError(f"{path.name}: ожидается объект с ключом 'questions'")
    data.setdefault("id", path.stem)
    data.setdefault("url", "")
    if not data["url"]:
        raise ValueError(f"{path.name}: не задан 'url' теста")
    return data


def validate_test(data: dict) -> list[str]:
    """Полная проверка файла вопросов — без сети."""
    problems: list[str] = []
    questions = data.get("questions") or []
    if not questions:
        return ["список вопросов пуст"]

    seen: dict[str, int] = {}
    for i, item in enumerate(questions, 1):
        if not isinstance(item, dict):
            problems.append(f"#{i}: не объект")
            continue
        text = str(item.get("question") or "").strip()
        variants = [str(v).strip() for v in (item.get("variants") or [])]
        answers = [str(a).strip() for a in (item.get("answer") or [])]

        if not text:
            problems.append(f"#{i}: пустой текст вопроса")
        if len(variants) < 2:
            problems.append(f"#{i}: вариантов {len(variants)}, нужно минимум 2")
        if any(not v for v in variants):
            problems.append(f"#{i}: есть пустые варианты ответа")
        if len(set(variants)) != len(variants):
            problems.append(f"#{i}: дублирующиеся варианты")
        if not answers:
            problems.append(f"#{i}: не отмечен ни один верный ответ")
        missing = [a for a in answers if a not in variants]
        if missing:
            problems.append(f"#{i}: ответ не входит в варианты: {missing}")
        if text and text in seen:
            problems.append(f"#{i}: дубликат вопроса #{seen[text]}")
        seen.setdefault(text, i)
    return problems


def local_check(path: str | Path) -> dict:
    """Проверка файла вопросов локально: ни одного обращения к сайту."""
    data = load_test(path)
    problems = validate_test(data)
    questions = data["questions"]
    summary = {
        "file": Path(path).name,
        "id": data["id"],
        "url": data["url"],
        "count": len(questions),
        "multi_answer": sum(1 for q in questions if len(q.get("answer") or []) > 1),
        "variants_hist": dict(sorted(Counter(
            len(q.get("variants") or []) for q in questions
        ).items())),
        "problems": problems,
        "network": False,
    }
    log.info(
        "локальная проверка %s: %d вопросов, проблем %d (сеть не используется)",
        summary["file"], summary["count"], len(problems),
    )
    for problem in problems:
        log.warning("  %s", problem)
    return summary


# ------------------------------------------------------------------ прогресс
def _read_progress() -> dict:
    try:
        return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def get_progress(test_id: str) -> dict:
    return _read_progress().get(test_id, {})


def _save_progress(test_id: str, payload: dict) -> None:
    all_progress = _read_progress()
    payload["updated"] = datetime.now().isoformat(timespec="seconds")
    all_progress[test_id] = payload
    PROGRESS_FILE.write_text(
        json.dumps(all_progress, ensure_ascii=False, indent=2), encoding="utf-8",
    )


# ------------------------------------------------------------------ сеть (чтение)
def scan_test(path: str | Path) -> dict:
    """Только чтение: сколько вопросов уже есть в тесте, что за последний."""
    data = load_test(path)
    local_count = len(data["questions"])
    result = {
        "file": Path(path).name,
        "id": data["id"],
        "url": data["url"],
        "local_count": local_count,
        "remote_count": None,
        "remote_last": "",
        "network": True,
    }
    log.info("=== скан теста %s (только чтение, ничего не отправляется)", data["url"])
    with browser_session() as page:
        Auth().ensure_login(page, data["url"])
        actions = ENGINES["release"](page, list_url=data["url"])
        number, last = actions.get_last_question()
        result["remote_count"] = number
        result["remote_last"] = last
    if number:
        result["to_upload"] = max(local_count - number, 0)
    SCAN_FILE.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    log.info(
        "скан завершён: на сайте %s вопросов, локально %d, останется залить %s (-> %s)",
        number, local_count, result.get("to_upload", "?"), SCAN_FILE.name,
    )
    return result


# ------------------------------------------------------------------ сеть (запись)
def _resolve_start(remote_number: int, total: int, resume: bool) -> int:
    if not resume:
        log.warning("режим «с начала»: уже существующие вопросы будут продублированы")
        return 0
    if remote_number <= 0:
        log.warning("на сайте не нашлось вопросов (номер %s) — заливаю с начала", remote_number)
        return 0
    if remote_number > total:
        log.warning(
            "на сайте %s вопросов, в файле только %d — заливать нечего",
            remote_number, total,
        )
    return remote_number


def fill_test(path: str | Path, engine: str = "release", resume: bool = True,
              limit: int = 0, verify_remote: bool = True) -> dict:
    """Заливает вопросы в тест.

    Шаги на каждый вопрос:
        1) open_create_form()  — создаём новые поля формы;
        2) fill_question()     — вопрос, пауза 1-2 с, варианты с паузами,
                                 после каждого варианта — полная проверка страницы;
        3) save_question()     — сохранение (ждём JS-валидации и список);
        4) опционально — перечитываем список и подтверждаем, что вопрос на сайте.
    Прогресс пишется в data/tests_progress.json после каждого сохранения.
    """
    if engine not in ENGINES:
        raise ValueError(f"неизвестный движок {engine!r}, доступны: {sorted(ENGINES)}")

    data = load_test(path)
    problems = validate_test(data)
    if problems:
        raise VerifyError(
            "файл не прошёл проверку, заливать нельзя: " + "; ".join(problems[:5])
        )

    questions = data["questions"]
    total = len(questions)
    summary = {
        "file": Path(path).name,
        "id": data["id"],
        "url": data["url"],
        "engine": engine,
        "total": total,
        "start": 0,
        "planned": 0,
        "done": 0,
        "unverified": [],
        "errors": [],
        "stopped": False,
        "network": True,
    }

    log.info("=== заливка %s: вопросов в файле %d, движок %s", summary["file"], total, engine)
    with browser_session() as page:
        Auth().ensure_login(page, data["url"])
        actions = ENGINES[engine](page, list_url=data["url"])

        remote_number, remote_last = actions.get_last_question()
        log.info("на сайте вопросов: %s, последний: %r", remote_number, remote_last[:80])

        start = _resolve_start(remote_number, total, resume)
        summary["start"] = start + 1 if start < total else start

        batch = list(range(start, total))
        if limit > 0:
            batch = batch[:limit]
        summary["planned"] = len(batch)

        if not batch:
            log.info("заливать нечего: на сайте %s, в файле %d", remote_number, total)
            _save_progress(data["id"], {**summary, "last_done": start})
            return summary

        log.info("залито будет вопросов: %d (с #%d до #%d)",
                 len(batch), batch[0] + 1, batch[-1] + 1)
        _save_progress(data["id"], {**summary, "last_done": start, "state": "started"})

        prev_number = remote_number
        for index in batch:
            question = questions[index]
            try:
                log.info("[%d/%d] %s", index + 1, total, question["question"][:100])

                actions.open_create_form()          # 1) новые поля формы
                actions.fill_question(question)     # 2) заполнение + проверки
                actions.save_question()             # 3) сохранение
                summary["done"] += 1

                if verify_remote:                   # 4) подтверждение на сайте
                    number, last = actions.get_last_question()
                    text_ok = (
                        norm(last) == norm(question["question"])
                        or norm(question["question"])[:60] in norm(last)
                    )
                    if number > prev_number and text_ok:
                        log.info("  подтверждено: вопрос №%s на сайте", number)
                        prev_number = number
                    else:
                        summary["unverified"].append(index + 1)
                        log.warning(
                            "  не подтвердилось: №%s (ждём > %s), текст %r",
                            number, prev_number, last[:80],
                        )
                        prev_number = max(prev_number, number)

                _save_progress(data["id"], {**summary, "last_done": index + 1,
                                            "state": "running"})

            except KeyboardInterrupt:
                log.warning("прервано пользователем на вопросе %d", index + 1)
                summary["stopped"] = True
                summary["errors"].append({
                    "index": index + 1, "error": "прервано пользователем",
                })
                _save_progress(data["id"], {**summary, "last_done": index,
                                            "state": "interrupted"})
                break
            except Exception as exc:
                log.exception("ошибка на вопросе %d — останавливаюсь, чтобы не залить мусор",
                              index + 1)
                summary["stopped"] = True
                summary["errors"].append({
                    "index": index + 1,
                    "question": question["question"][:120],
                    "error": f"{type(exc).__name__}: {exc}",
                })
                _save_progress(data["id"], {**summary, "last_done": index,
                                            "state": "error"})
                break

        _save_progress(data["id"], {**summary, "last_done": batch[-1] + 1,
                                    "state": "finished" if not summary["stopped"] else "stopped"})

    log.info(
        "=== итог: залито %d из %d запланированных (всего в файле %d), ошибок %d",
        summary["done"], summary["planned"], total, len(summary["errors"]),
    )
    return summary
