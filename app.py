import os

from flask import Flask
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from routes.event import event_bp
from routes.match import match_bp
from routes.player import player_bp
from routes.search import search_bp
from routes.team import team_bp

app = Flask(__name__)
CORS(app)

app.register_blueprint(match_bp, url_prefix="/match")
app.register_blueprint(event_bp, url_prefix="/event")
app.register_blueprint(player_bp, url_prefix="/player")
app.register_blueprint(team_bp, url_prefix="/team")
app.register_blueprint(search_bp, url_prefix="/search")


@app.route("/")
def home():
    return {
        "msg": "VLR Backend Running",
        "routes": {
            "match": [
                "/match/history",
                "/match/upcoming",
                "/match/live",
                "/match/<match_id>",
            ],
            "event": [
                "/event/",
                "/event/<event_id>",
                "/event/<event_id>/matches",
                "/event/<event_id>/stats",
            ],
            "player": [
                "/player/",
                "/player/<player_id>",
                "/player/<player_id>/basic",
                "/player/<player_id>/agents",
                "/player/<player_id>/matches",
            ],
            "team": [
                "/team/",
                "/team/<team_id>",
                "/team/<team_id>/basic",
                "/team/<team_id>/roster",
                "/team/<team_id>/schedule",
            ],
            "search": ["/search/?q=<keyword>&type=all|players|teams|events|series"],
        },
    }


@app.errorhandler(Exception)
def handle_exception(exc):
    if isinstance(exc, HTTPException):
        return {"error": exc.description}, exc.code
    return {"error": str(exc)}, 500


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG", "0") == "1",
    )