from flask import jsonify, render_template

def index():
    return render_template("index.html", title="Главная")

def library():
    return render_template("library.html", title="library")

def tester():
    return render_template("tester.html", title="tester")

def conf():
    return render_template("conf.html", title="conf")