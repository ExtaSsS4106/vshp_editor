from config.extensions import db

class LibraryFolders(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    size = db.Column(db.BigInteger, nullable=False, default=0)   # BigInteger: Integer не вмещает файлы > 2 ГБ
    path = db.Column(db.String(255), nullable=False)
    date_added = db.Column(db.DateTime, nullable=False, server_default=db.func.now())
    date_modified = db.Column(db.DateTime, nullable=False, server_default=db.func.now(), onupdate=db.func.now())

    __tablename__ = "library" 


class LibraryFiles(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    library_id = db.Column(db.Integer, db.ForeignKey("library_folders.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)        # "otvety.txt"
    rel_path = db.Column(db.String(512), nullable=False)    # "Задачи/Решения/otvety.txt" (от папки библиотеки)
    size = db.Column(db.BigInteger, nullable=False, default=0)
    date_added = db.Column(db.DateTime, nullable=False, server_default=db.func.now())

    # один и тот же путь внутри библиотеки не может повторяться
    __table_args__ = (db.UniqueConstraint("library_id", "rel_path"),)
    __tablename__ = "library_file"
    # lib.files даёт все файлы; при удалении библиотеки удаляются и её файлы
    library = db.relationship("LibraryFolders", backref=db.backref("files", cascade="all, delete-orphan"))