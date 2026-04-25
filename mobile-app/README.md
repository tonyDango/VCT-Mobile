# VLR 手机 App（React Native + Expo）

这个目录是一个可直接开发的手机端项目，用于对接上级目录实现的 Flask 后端接口（比赛、赛事、选手、俱乐部、搜索）。

## 1) 项目结构

- `App.tsx`：入口
- `src/navigation/MainNavigator.tsx`：底部 Tab + 详情页导航
- `src/api/`：接口请求与类型定义
- `src/screens/`：5 个主页面 + 4 个详情页面
- `src/components/Common.tsx`：通用 UI 组件

## 2) 安装与运行

> 先确保后端在本机 `5000` 端口运行。

### 步骤 A：安装 Node 包管理器

如果你终端里 `node` 有但 `npm` 不可用，请重新安装 z（官网安装版），勾选“Add to PATH”。

### 步骤 B：安装依赖

在 `mobile-app` 目录执行：

```bash
npm install
```

### 步骤 C：配置后端地址

复制一份环境文件：

```bash
cp .env.example .env 
```

把 `.env` 里的 `EXPO_PUBLIC_API_BASE_URL` 改为你电脑局域网 IP，例如：

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.10:5000
```

> 真机调试不能用 `127.0.0.1`，要用电脑在同一 Wi-Fi 下的局域网 IP。

### 步骤 D：启动 App

```bash
npm run start
```

- Android：按 `a` 或扫码用 Expo Go 打开
- iOS：按 `i`（Mac）或扫码用 Expo Go 打开

## 3) 已实现页面

### Matches
- 未来赛程 / 历史比赛 / 进行中
- 点击进入比赛详情（总计 + 按地图选手数据）

### Events
- 全部 / 进行中 / 未开始 / 已结束
- 赛事详情中可切换 `Matches` 和 `Stats`
- `Stats` 支持按 Rating / ACS / K / KD 排序

### Players
- 全部 / 现役 / 退役
- 详情含：基础信息、生涯总计、Top 英雄、最近比赛

### Search
- 支持按选手搜索
- 结果可直接跳转详情页
