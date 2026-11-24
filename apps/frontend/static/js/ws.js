/*
 * ws-client.js — общий клиент для статусов задач (Flask-SocketIO).
 *
 * Подключение на странице (socket.io ДО этого файла):
 *   <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
 *   <script src="/static/ws-client.js"></script>
 *
 * Использование:
 *   const stop = JobsWS.subscribe("library", jobs => render(jobs));
 *   JobsWS.subscribe(JobsWS.channels.job("fill_test", 5), jobs => ...);
 *   JobsWS.get("target:5").then(jobs => ...);
 *   JobsWS.cancel("fill_test:5");
 *   stop();   // отписаться
 *
 * Задача = (name, id). Callback всегда получает массив записей.
 * Каналы: all, library, tests, target:<id>, name:<name>, job:<name>:<id>
 */
(function (global) {
  "use strict";

  const state = {
    socket: null,
    url: undefined,          // undefined -> тот же хост, что и у страницы
    subs: new Map(),         // channel -> Set<callback>
    last: new Map(),         // channel -> последний полученный массив задач
    statusCbs: new Set(),
    errorCbs: new Set(),
  };

  function safe(cb, ...args) {
    try { cb(...args); } catch (e) { console.error("[JobsWS]", e); }
  }

  function ensure() {
    if (state.socket) return state.socket;
    if (typeof global.io !== "function") {
      throw new Error("[JobsWS] socket.io-клиент не подключён перед ws-client.js");
    }
    const s = global.io(state.url, {
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    s.on("connect", () => {
      // при первом подключении и после каждого переподключения
      // заново подписываемся на все каналы
      for (const channel of state.subs.keys()) {
        s.emit("subscribe", { channel });
      }
      state.statusCbs.forEach(cb => safe(cb, true));
    });

    s.on("disconnect", () => {
      state.statusCbs.forEach(cb => safe(cb, false));
    });

    s.on("connect_error", e => {
      state.errorCbs.forEach(cb => safe(cb, e.message || String(e)));
    });

    s.on("jobs", ({ channel, jobs }) => {
      state.last.set(channel, jobs);
      const set = state.subs.get(channel);
      if (set) set.forEach(cb => safe(cb, jobs, channel));
    });

    s.on("error", e => {
      const msg = (e && e.message) || String(e);
      state.errorCbs.forEach(cb => safe(cb, msg));
    });

    state.socket = s;
    return s;
  }

  const JobsWS = {
    /** Необязательно. Вызвать до первого subscribe, если сервер на другом адресе. */
    init(options = {}) {
      if (state.socket) {
        console.warn("[JobsWS] уже подключён, init игнорируется");
        return JobsWS;
      }
      if (options.url) state.url = options.url;
      return JobsWS;
    },

    /**
     * Подписка на канал. callback(jobs, channel) вызывается сразу после
     * подписки и затем при каждом изменении.
     * Возвращает функцию отписки.
     */
    subscribe(channel, callback) {
      if (typeof callback !== "function") throw new Error("[JobsWS] нужен callback");
      const s = ensure();

      let set = state.subs.get(channel);
      const isNew = !set;
      if (isNew) {
        set = new Set();
        state.subs.set(channel, set);
      }
      set.add(callback);

      if (isNew) {
        if (s.connected) s.emit("subscribe", { channel });   // иначе подпишемся в on connect
      } else if (state.last.has(channel)) {
        safe(callback, state.last.get(channel), channel);    // отдать уже известный снимок
      }

      return function unsubscribe() {
        const cbs = state.subs.get(channel);
        if (!cbs) return;
        cbs.delete(callback);
        if (cbs.size === 0) {
          state.subs.delete(channel);
          state.last.delete(channel);
          if (s.connected) s.emit("unsubscribe", { channel });
        }
      };
    },

    /** Разовый запрос без подписки. Promise<Array>. */
    get(channel, timeoutMs = 5000) {
      const s = ensure();
      return new Promise((resolve, reject) => {
        s.timeout(timeoutMs).emit("jobs:get", { channel }, (err, res) => {
          if (err) return reject(new Error("нет ответа от сервера"));
          if (!res || !res.ok) return reject(new Error((res && res.error) || "ошибка"));
          resolve(res.jobs);
        });
      });
    },

    /** Отмена задачи по job_id (например "fill_test:5"). Promise. */
    cancel(jobId, timeoutMs = 5000) {
      const s = ensure();
      return new Promise((resolve, reject) => {
        const onDone = r => { cleanup(); resolve(r); };
        const onErr = e => { cleanup(); reject(new Error((e && e.message) || "ошибка")); };
        const timer = setTimeout(() => { cleanup(); reject(new Error("нет ответа от сервера")); }, timeoutMs);
        function cleanup() {
          clearTimeout(timer);
          s.off("job:cancelled", onDone);
          s.off("error", onErr);
        }
        s.once("job:cancelled", onDone);
        s.once("error", onErr);
        s.emit("job:cancel", { job_id: jobId });
      });
    },

    /**
     * Управление задачами: act("pause" | "resume" | "cancel", jobId),
     * act("cancel_all"), act("clear_finished"). Promise.
     */
    act(action, jobId, timeoutMs = 5000) {
      const s = ensure();
      return new Promise((resolve, reject) => {
        s.timeout(timeoutMs).emit("job:action", { action, job_id: jobId }, (err, res) => {
          if (err) return reject(new Error("нет ответа от сервера"));
          if (!res || !res.ok) return reject(new Error((res && res.error) || "ошибка"));
          resolve(res);
        });
      });
    },

    /** callback(true|false) при подключении и обрыве. Возвращает функцию отписки. */
    onStatus(callback) {
      state.statusCbs.add(callback);
      if (state.socket) safe(callback, state.socket.connected);
      return () => state.statusCbs.delete(callback);
    },

    /** callback(message) для ошибок сервера и подключения. */
    onError(callback) {
      state.errorCbs.add(callback);
      return () => state.errorCbs.delete(callback);
    },

    get connected() {
      return !!(state.socket && state.socket.connected);
    },

    /** Хелперы имён каналов, чтобы не собирать строки руками. */
    channels: {
      all: "all",
      library: "library",
      tests: "tests",
      target: id => `target:${id}`,
      name: name => `name:${name}`,
      job: (name, id) => `job:${name}:${id}`,
    },
  };

  global.JobsWS = JobsWS;
})(window);