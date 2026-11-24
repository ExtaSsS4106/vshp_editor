from config import create_app
from config.extensions import socketio

app = create_app()
socketio.init_app(app)
from apps.main import ws
ws.start_background()

if __name__ == "__main__":
    socketio.run(
        app,
        host=app.config["HOST"],
        port=app.config["PORT"],
        debug=app.config["DEBUG"],
        use_reloader=False,          # автоперезапуск убивает запущенные задачи
        use_debugger=False,          # без отладчика ConnectionError не печатается как 500
        allow_unsafe_werkzeug=True,
    )