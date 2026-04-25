import { EventListItem } from "../api/types";
import { HOME_IMAGE_URLS, HOME_REGION_ICON_URLS } from "./homeConfig";

/** 与赛事列表、详情共用的「名称 + 赛区文案」 */
export type EventDisplayMeta = {
  name?: string | null;
  regionText?: string | null;
};

export function metaFromListItem(item: Pick<EventListItem, "name" | "region">): EventDisplayMeta {
  return { name: item.name, regionText: item.region || "" };
}

export function metaFromDetailInfo(info: { name?: string; regions?: string[] }): EventDisplayMeta {
  return { name: info.name, regionText: (info.regions || []).filter(Boolean).join(" ") };
}

export type EventRegionKind =
  | "americas"
  | "emea"
  | "pacific"
  | "china"
  | "masters"
  | "champions"
  | "";

/**
 * 与列表筛选、列表图标、详情图标一致：国际赛名称优先于「举办地/赛区里的 china」等字样。
 */
export function detectEventRegionKind(meta: EventDisplayMeta): EventRegionKind {
  const name = (meta.name || "").toLowerCase();
  const region = (meta.regionText || "").toLowerCase();

  if (name.includes("challengers")) {
    // 次级联赛仍走地理赛区
  } else {
    if (name.includes("champions") || name.includes("champs")) return "champions";
    if (name.includes("masters")) return "masters";
  }

  if (region.includes("champions") || region.includes("champs")) return "champions";
  if (region.includes("masters")) return "masters";

  const src = `${region} ${name}`;
  if (src.includes("americas") || src.includes("latam") || src.includes("latin america")) return "americas";
  if (src.includes("emea") || src.includes("europe") || src.includes("middle east")) return "emea";
  if (src.includes("pacific") || src.includes("apac")) return "pacific";
  if (src.includes("china") || /\bvct\s*cn\b/.test(src) || /\bcn\b/.test(src)) return "china";

  if (name.includes("champions") || name.includes("champs")) return "champions";
  if (name.includes("masters")) return "masters";

  return "";
}

function regionIconUrlForKind(kind: EventRegionKind): string {
  if (!kind) return HOME_IMAGE_URLS.regionDefaultIcon;
  if (kind === "emea") {
    return HOME_REGION_ICON_URLS.EMEA || HOME_REGION_ICON_URLS.emea || HOME_IMAGE_URLS.regionDefaultIcon;
  }
  if (kind === "champions") {
    return (
      HOME_REGION_ICON_URLS.Champs ||
      HOME_REGION_ICON_URLS.Champions ||
      HOME_REGION_ICON_URLS.champs ||
      HOME_REGION_ICON_URLS.champions ||
      HOME_IMAGE_URLS.regionDefaultIcon
    );
  }
  const key = kind.charAt(0).toUpperCase() + kind.slice(1);
  return HOME_REGION_ICON_URLS[key] || HOME_REGION_ICON_URLS[kind] || HOME_IMAGE_URLS.regionDefaultIcon;
}

/** 列表左侧 / 详情顶部：赛区或国际赛图标 */
export function eventIconUriForMeta(meta: EventDisplayMeta): string {
  const kind = detectEventRegionKind(meta);
  if (kind) return regionIconUrlForKind(kind);
  return HOME_IMAGE_URLS.regionDefaultIcon;
}

/** 列表右侧 / 详情日期旁：与列表完全相同的国旗/赛区表情逻辑 */
export function eventEmojiForMeta(meta: EventDisplayMeta): string {
  const name = (meta.name || "").toLowerCase();
  const src = `${meta.regionText || ""} ${meta.name || ""}`.toLowerCase();

  // 国际赛不与「举办城市所在国」混用：名称里先判定
  if (name.includes("champions") || name.includes("champs") || name.includes("masters")) {
    return "🗺️";
  }

  const map: Array<[string, string]> = [
    ["south korea", "🇰🇷"],
    ["korea", "🇰🇷"],
    ["japan", "🇯🇵"],
    ["china", "🇨🇳"],
    ["thailand", "🇹🇭"],
    ["singapore", "🇸🇬"],
    ["indonesia", "🇮🇩"],
    ["philippines", "🇵🇭"],
    ["united states", "🇺🇸"],
    ["usa", "🇺🇸"],
    ["canada", "🇨🇦"],
    ["brazil", "🇧🇷"],
    ["france", "🇫🇷"],
    ["germany", "🇩🇪"],
    ["spain", "🇪🇸"],
    ["turkey", "🇹🇷"],
    ["uk", "🇬🇧"],
    ["united kingdom", "🇬🇧"],
  ];
  for (const [k, emoji] of map) {
    if (src.includes(k)) return emoji;
  }
  if (src.includes("americas")) return "🌎";
  if (src.includes("emea")) return "🌍";
  if (src.includes("pacific")) return "🌏";
  if (src.includes("masters") || src.includes("champions") || src.includes("champs")) return "🗺️";
  return "🗺️";
}
