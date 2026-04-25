export const HOME_MAIN_TEAM_ID = 2;
export const HOME_SELECTED_TEAM_STORAGE_KEY = "home:selected_team_id";

// 在这里替换为你自己的图片 URL（队标、头像、图标）。
export const HOME_IMAGE_URLS = {
  topAvatar: "https://user9123.cn.imgto.link/public/20260425/a91klrgx9-1fibbgv-19xo.avif",
  defaultLogo: "https://via.placeholder.com/64",
  searchIcon: "https://user9123.cn.imgto.link/public/20260422/segment.avif",
  navHomeIcon: "https://user9123.cn.imgto.link/public/20260422/home.avif",
  navMatchIcon: "https://user9123.cn.imgto.link/public/20260422/2x.avif",
  navEventIcon: "https://user9123.cn.imgto.link/public/20260422/match.avif",
  navPlayerIcon: "https://user9123.cn.imgto.link/public/20260422/segment-1.avif",
  regionDefaultIcon: "https://via.placeholder.com/48",
};

// 赛区图标（弹窗里使用）
export const HOME_REGION_ICON_URLS: Record<string, string> = {
  All: "https://user9123.cn.imgto.link/public/20260422/1.avif",
  Americas: "https://user9123.cn.imgto.link/public/20260422/640f5ab71dfbb.avif",
  EMEA: "https://user9123.cn.imgto.link/public/20260422/65ab54a77831c-1.avif",
  Pacific: "https://user9123.cn.imgto.link/public/20260422/640f5ae002674.avif",
  China: "https://user9123.cn.imgto.link/public/20260422/65dd97cea9a25.avif",
  Masters: "https://user9123.cn.imgto.link/public/20260422/692fc18a04f4a.avif",
  Champions: "https://user9123.cn.imgto.link/public/20260422/692fc60a022bb.avif",
};

// 队名简称映射（可按需补充；用于 VLR 简称与常见写法不一致时）
export const HOME_TEAM_ABBR_MAP: Record<string, string> = {
  mibr: "MIBR",
  "made in brazil": "MIBR",
};