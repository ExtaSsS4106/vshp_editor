from flask import Blueprint

from . import views

bp = Blueprint("frontend", __name__, url_prefix="/")

bp.add_url_rule("/", view_func=views.index, methods=["GET"])
bp.add_url_rule("/library", view_func=views.library, methods=["GET"])
bp.add_url_rule("/tester", view_func=views.tester, methods=["GET"])
bp.add_url_rule("/conf", view_func=views.conf, methods=["GET"])
