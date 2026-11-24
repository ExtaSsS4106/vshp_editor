from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO
socketio = SocketIO(async_mode="threading", cors_allowed_origins="*")  # origins сузь до своего фронта
db = SQLAlchemy()
migrate = Migrate()
