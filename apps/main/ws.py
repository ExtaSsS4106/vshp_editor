import json
import threading

from flask import request
from flask_socketio import emit, join_room, leave_room
from config.extensions import socketio
from . import port

# Задача = (name, id). job_id = "name:id", например "fill_test:5" или "upload:library:upload".
#
# Каналы (клиент всегда получает МАССИВ записей, подходящих под канал):
#   all               все задачи
#   library           задачи библиотеки (id начинается с "library:")
#   tests             задачи тестера (fill_test, local_check, scan_test)
#   target:<id>       всё, что идёт по этому id             (target:5, target:library:upload)
#   name:<name>       все задачи этого типа                 (name:fill_test, name:scan)
#   job:<name>:<id>   конкретная пара тип+id                (job:fill_test:5)
TEST_JOBS = {"fill_test", "local_check", "scan_test"}
SIMPLE = {"all", "library", "tests"}
PARAM_KINDS = {"target", "name", "job"}

_subs: dict[str, set[str]] = {}    # channel -> {sid}
_last: dict[str, str] = {}         # channel -> последний отправленный снимок
_lock = threading.Lock()


def _valid(channel) -> bool:
    if not isinstance(channel, str):
        return False
    if channel in SIMPLE:
        return True
    kind, _, val = channel.partition(":")
    return kind in PARAM_KINDS and bool(val)


def _match(channel: str, job: dict) -> bool:
    if channel == "all":
        return True
    if channel == "library":
        return str(job.get("target", "")).startswith("library:")
    if channel == "tests":
        return job.get("name") in TEST_JOBS
    kind, _, val = channel.partition(":")
    if kind == "target":
        return str(job.get("target")) == val
    if kind == "name":
        return job.get("name") == val
    if kind == "job":
        return job.get("id") == val
    return False


def _jobs_for(channel: str) -> list[dict]:
    return [j for j in port.list_jobs() if _match(channel, j)]


def _channel_from(data) -> str | None:
    channel = data.get("channel") if isinstance(data, dict) else data
    return channel if _valid(channel) else None


# ------------------------------------------------------------ broadcast
def _broadcast_loop():
    while True:
        socketio.sleep(1)
        try:
            with _lock:
                channels = list(_subs)
            if not channels:
                continue
            all_jobs = port.list_jobs()          # один раз на тик
            for ch in channels:
                jobs = [j for j in all_jobs if _match(ch, j)]
                snap = json.dumps(jobs, sort_keys=True, default=str)
                if _last.get(ch) != snap:        # шлём только при изменениях
                    _last[ch] = snap
                    socketio.emit("jobs", {"channel": ch, "jobs": jobs}, room=ch)
        except Exception as e:
            print(f"[ws] {e}")


# ------------------------------------------------------------ handlers
@socketio.on("connect")
def on_connect():
    pass    # подписки клиент оформляет сам


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    with _lock:
        for ch in list(_subs):
            _subs[ch].discard(sid)
            if not _subs[ch]:
                del _subs[ch]
                _last.pop(ch, None)


@socketio.on("subscribe")
def on_subscribe(data):
    """{channel: "library"} -> подписка + сразу текущий снимок."""
    channel = _channel_from(data)
    if not channel:
        emit("error", {"message": f"Неизвестный канал: {data}"})
        return
    try:
        join_room(channel)
        with _lock:
            _subs.setdefault(channel, set()).add(request.sid)
        emit("jobs", {"channel": channel, "jobs": _jobs_for(channel)})
    except Exception as e:
        emit("error", {"message": str(e)})


@socketio.on("unsubscribe")
def on_unsubscribe(data):
    channel = _channel_from(data)
    if not channel:
        return
    leave_room(channel)
    with _lock:
        if channel in _subs:
            _subs[channel].discard(request.sid)
            if not _subs[channel]:
                del _subs[channel]
                _last.pop(channel, None)


@socketio.on("jobs:get")
def on_get(data):
    """Разовый запрос без подписки. Ответ приходит в ack-колбэк клиента."""
    channel = _channel_from(data)
    if not channel:
        return {"ok": False, "error": f"Неизвестный канал: {data}"}
    try:
        return {"ok": True, "channel": channel, "jobs": _jobs_for(channel)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@socketio.on("job:cancel")
def on_cancel(data):
    try:
        emit("job:cancelled", port.cancel_job(data["job_id"]))
    except Exception as e:
        emit("error", {"message": str(e)})


@socketio.on("job:action")
def on_action(data):
    """Управление задачами. Ответ приходит в ack-колбэк клиента.

    {action: "pause" | "resume" | "cancel", job_id: "fill_test:5"}
    {action: "cancel_all"} | {action: "clear_finished"}
    """
    try:
        data = data or {}
        action, job_id = data.get("action"), data.get("job_id")
        if action in ("pause", "resume", "cancel") and not job_id:
            return {"ok": False, "error": "Не указан job_id"}
        if action == "pause":
            return {"ok": True, "state": port.pause_job(job_id)}
        if action == "resume":
            return {"ok": True, "state": port.resume_job(job_id)}
        if action == "cancel":
            return {"ok": True, **port.cancel_job(job_id)}
        if action == "cancel_all":
            port.cancel_all()
            return {"ok": True}
        if action == "clear_finished":
            port.clear_finished()
            return {"ok": True}
        return {"ok": False, "error": f"Неизвестное действие: {action}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def start_background():
    socketio.start_background_task(_broadcast_loop)