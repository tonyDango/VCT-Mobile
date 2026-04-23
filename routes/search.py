from flask import Blueprint, request, jsonify
from services.vlr_service import search_entities, to_jsonable

search_bp = Blueprint("search", __name__)


@search_bp.route("/")
def search():
    q = request.args.get("q", "")
    search_type = request.args.get("type", "all")
    if not q.strip():
        return jsonify({"error": "query参数 q 不能为空"}), 400
    data = search_entities(query=q.strip(), search_type=search_type)
    return jsonify(to_jsonable(data))