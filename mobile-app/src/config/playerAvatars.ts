import type { ImageSourcePropType } from "react-native";

/**
 * 在这里维护选手头像映射。
 *
 * 推荐方式（更方便）：
 * - 直接填网络图片 URL
 *
 * 例如：
 * export const PLAYER_AVATAR_BY_ID: Record<number, AvatarSource> = {
 *   12345: "https://your-cdn.com/players/tenz.png",
 * };
 *
 * 也支持本地静态图片（需使用 require）：
 * export const PLAYER_AVATAR_BY_NAME: Record<string, AvatarSource> = {
 *   tenz: require("../../assets/players/tenz.png"),
 * };
 */
export type AvatarSource = string | ImageSourcePropType;

export const PLAYER_AVATAR_BY_ID: Record<number, AvatarSource> = {
  
};

export const PLAYER_AVATAR_BY_NAME: Record<string, AvatarSource> = {};

function normalizeName(name?: string | null) {
  return (name || "").trim().toLowerCase();
}

function toImageSource(source: AvatarSource): ImageSourcePropType {
  if (typeof source === "string") {
    return { uri: source };
  }
  return source;
}

export function getPlayerAvatarSource(playerId?: number, playerName?: string): ImageSourcePropType | null {
  if (playerId && PLAYER_AVATAR_BY_ID[playerId]) {
    return toImageSource(PLAYER_AVATAR_BY_ID[playerId]);
  }

  const key = normalizeName(playerName);
  if (key && PLAYER_AVATAR_BY_NAME[key]) {
    return toImageSource(PLAYER_AVATAR_BY_NAME[key]);
  }

  return null;
}
