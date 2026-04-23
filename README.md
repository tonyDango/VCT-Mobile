# VLR Valorant 赛事后端（Flask + vlrdevapi）

这个项目基于 `vlrdevapi` 封装了手机赛事检索 App 所需后端接口，覆盖比赛、赛事、选手、俱乐部与搜索功能。

## 1. 安装

```bash
pip install -r requirements.txt
```

## 2. 启动

```bash
python app.py
```

默认地址：`http://127.0.0.1:5000`

## 2.1 生产部署（Render / Railway）

项目已包含生产启动配置：

- `requirements.txt` 内含 `gunicorn`
- `Procfile`：`web: gunicorn app:app --bind 0.0.0.0:$PORT`
- `render.yaml`：可直接用于 Render Blueprint 部署

关键环境变量：

- `PORT`：平台自动注入
- `FLASK_DEBUG=0`：生产环境务必关闭调试模式

本地调试如需开启 debug，可手动设置：

```bash
set FLASK_DEBUG=1
python app.py
```

## 2.2 前端指向线上后端

在 `mobile-app` 目录复制环境文件：

```bash
copy .env.example .env
```

将 `.env` 中的 `EXPO_PUBLIC_API_BASE_URL` 改为你的后端公网地址（HTTPS）：

```env
EXPO_PUBLIC_API_BASE_URL=https://your-vlr-backend.onrender.com
```

## 3. API 总览

### Match 页面

- `GET /match/history?page=1&limit=50`  
  按时间返回历史比赛（已完成）
- `GET /match/upcoming?page=1&limit=50`  
  按时间返回未来赛程
- `GET /match/live?limit=50`  
  返回进行中的比赛
- `GET /match/<match_id>`  
  比赛详情：包含系列赛信息、按地图选手数据、总计（All）选手数据

### Event 页面

- `GET /event/?status=all|ongoing|upcoming|completed&page=1&limit=50`  
  按时间返回 VCT 系列赛事
- `GET /event/<event_id>`  
  赛事详情（基础信息、赛程摘要、阶段、站位）
- `GET /event/<event_id>/matches?stage=&status=&limit=`  
  赛事内全部比赛
- `GET /event/<event_id>/stats?sort_by=r&order=desc`  
  赛事选手总计排名（基于该赛事已完成比赛聚合）

可排序字段示例：`r`/`rating`、`acs`、`adr`、`kast`、`hs_pct`、`kills`、`deaths`、`assists`、`kd_ratio`、`matches_played`。

### 选手页面

- `GET /player/?page=1&page_size=50&status=all&max_event_pages=20&refresh=false`  
  全量选手目录（现役/退役，缓存聚合）
- `GET /player/<player_id>`  
  选手详情（profile + 生涯汇总 + 最近比赛）
- `GET /player/<player_id>/basic`  
  基础资料
- `GET /player/<player_id>/agents?timespan=all`  
  英雄维度数据
- `GET /player/<player_id>/matches?page=1&limit=20`  
  选手比赛列表

### 俱乐部页面

- `GET /team/?page=1&page_size=50&status=all&max_event_pages=20&refresh=false`  
  全量俱乐部目录（现有/过往）
- `GET /team/<team_id>`  
  俱乐部详情（信息、现役成员、赛程、placements）
- `GET /team/<team_id>/basic`
- `GET /team/<team_id>/roster`
- `GET /team/<team_id>/schedule?include_completed=true&completed_limit=20&upcoming_limit=20`

### 搜索

- `GET /search/?q=<关键词>&type=all|players|teams|events|series`

## 4. 实现说明

- 赛事、选手、俱乐部“全量目录”通过 `vct` 赛事爬取 + 去重聚合构建，首次请求可能较慢，后续命中内存缓存（30 分钟）。
- 所有响应都转为 JSON 可序列化格式（含 `date/time/datetime`）。
- 你可以在前端按 `id`/`player_id`/`team_id` 进入详情页。

## 5. 手机端项目

- 手机 App 代码位于 `mobile-app` 目录（Expo + React Native）。
- 使用方法与 UI 设计说明见 `mobile-app/README.md`。
