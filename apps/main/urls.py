from flask import Blueprint
from . import views

bp = Blueprint("main", __name__, url_prefix="/api/")

# tests
bp.add_url_rule("/get_list_tests",           view_func=views.get_list_tests,           methods=["GET", "POST"])
bp.add_url_rule("/add_test",                 view_func=views.add_test,                 methods=["POST"])
bp.add_url_rule("/delete_test/<int:test_id>", view_func=views.delete_test,             methods=["DELETE"])

# materials input
bp.add_url_rule("/get_materials_input",      view_func=views.get_materials_input,      methods=["GET"])
bp.add_url_rule("/set_materials_input",      view_func=views.set_materials_input,      methods=["PUT", "POST"])
bp.add_url_rule("/clear_materials_input",    view_func=views.clear_materials_input,    methods=["DELETE", "POST"])

# upload files
bp.add_url_rule("/get_upload_files",         view_func=views.get_upload_files,         methods=["GET"])
bp.add_url_rule("/set_upload_files",         view_func=views.set_upload_files,         methods=["PUT", "POST"])
bp.add_url_rule("/add_upload_files",         view_func=views.add_upload_files,         methods=["POST"])
bp.add_url_rule("/clear_upload_files",       view_func=views.clear_upload_files,       methods=["DELETE", "POST"])

# links for scan
bp.add_url_rule("/get_links_for_scan",       view_func=views.get_links_for_scan,       methods=["GET"])
bp.add_url_rule("/set_links_for_scan",       view_func=views.set_links_for_scan,       methods=["PUT", "POST"])
bp.add_url_rule("/clear_links_for_scan",     view_func=views.clear_links_for_scan,     methods=["DELETE", "POST"])

# scan
bp.add_url_rule("/scan_data",                view_func=views.scan_data,                methods=["GET"])

# jobs
bp.add_url_rule("/jobs/list_jobs",                view_func=views.list_jobs,                methods=["GET"])
bp.add_url_rule("/jobs/get_job/<string:job_id>",  view_func=views.get_job,                  methods=["GET"])
bp.add_url_rule("/jobs/pause_job/<string:job_id>",  view_func=views.pause_job,              methods=["POST"])
bp.add_url_rule("/jobs/resume_job/<string:job_id>", view_func=views.resume_job,             methods=["POST"])
bp.add_url_rule("/jobs/cancel_job/<string:job_id>", view_func=views.cancel_job,             methods=["DELETE", "POST"])
bp.add_url_rule("/jobs/cancel_all_jobs",          view_func=views.cancel_all_jobs,          methods=["POST", "DELETE"])
bp.add_url_rule("/jobs/clear_finished_jobs",      view_func=views.clear_finished_jobs,      methods=["POST"])

# tester
bp.add_url_rule("/tester/pick",              view_func=views.tester_pick,              methods=["GET"])
bp.add_url_rule("/tester/fill",              view_func=views.tester_fill,              methods=["POST"])
bp.add_url_rule("/tester/local_check",       view_func=views.tester_local_check,       methods=["POST"])
bp.add_url_rule("/tester/scan",              view_func=views.tester_scan,              methods=["POST"])

bp.add_url_rule("/tester/tester_get_list_tests",              view_func=views.tester_get_list_tests,              methods=["GET"])
bp.add_url_rule("/tester/tester_save_test",              view_func=views.tester_save_test,              methods=["POST"])
bp.add_url_rule("/tester/tester_delete_test",              view_func=views.tester_delete_test,              methods=["DELETE"])




# library
bp.add_url_rule("/library/collect",          view_func=views.library_collect,          methods=["POST"])
bp.add_url_rule("/library/exchange",         view_func=views.library_exchange,         methods=["POST"])
bp.add_url_rule("/library/scan",             view_func=views.library_scan,             methods=["POST"])
bp.add_url_rule("/library/upload",           view_func=views.library_upload,           methods=["POST"])
bp.add_url_rule("/library/library_set_tasks",           view_func=views.library_set_tasks,           methods=["POST"])
bp.add_url_rule("/library/library_get_tasks",           view_func=views.library_get_tasks,           methods=["GET"])
bp.add_url_rule("/library/library_delete_tasks", view_func=views.library_delete_tasks, methods=["POST", "DELETE"])
bp.add_url_rule("/library/library_reorder_tasks", view_func=views.library_reorder_tasks, methods=["POST"])

# config
bp.add_url_rule("/config/get_config",               view_func=views.get_config,               methods=["GET"])
bp.add_url_rule("/config/set_config",               view_func=views.set_config,               methods=["PUT", "POST"])

bp.add_url_rule("/library/save",   view_func=views.lib_save,           methods=["POST"])
bp.add_url_rule("/library/delete_files", view_func=views.lib_delete, methods=["POST", "DELETE"])
bp.add_url_rule("/library/get_full_library", view_func=views.lib_get_full_library,        methods=["GET"])
bp.add_url_rule("/library/rename_file", view_func=views.lib_rename, methods=["POST"])
bp.add_url_rule("/library/move_file", view_func=views.lib_move, methods=["POST"])
bp.add_url_rule("/library/get_current_list_dir", view_func=views.lib_get_current_list_dir, methods=["POST"])
bp.add_url_rule("/library/add_folder", view_func=views.lib_add_folder, methods=["POST"])
bp.add_url_rule("/library/download", view_func=views.lib_download, methods=["GET"])