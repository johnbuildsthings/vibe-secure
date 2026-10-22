import sqlite3

from flask import Flask, jsonify, request

app = Flask(__name__)
app.config["SECRET_KEY"] = "super-secret-flask-key-1234"


def db():
    return sqlite3.connect("app.db")


@app.route("/search")
def search():
    name = request.args.get("name", "")
    rows = db().execute(f"SELECT id, name FROM users WHERE name = '{name}'").fetchall()
    return jsonify(rows)


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True)
