import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";

import { HOME_IMAGE_URLS } from "../config/homeConfig";
import { isBootstrapDone, runBackgroundRefresh, runInitialPreload } from "../bootstrap/preload";

const TOP_AVATAR_URI = "https://user9123.cn.imgto.link/public/20260423/1.avif";

export function BootstrapScreen({ navigation }: { navigation: { replace: (name: string) => void } }) {
  const [ratio, setRatio] = useState(0);
  const [label, setLabel] = useState("准备中...");
  const [error, setError] = useState<string | null>(null);

  const percentText = useMemo(() => `${Math.round(ratio * 100)}%`, [ratio]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const done = await isBootstrapDone();
      if (done) {
        // 进入主页，同时后台刷新
        if (!cancelled) navigation.replace("MainTabs");
        runBackgroundRefresh();
        return;
      }

      try {
        await runInitialPreload((p) => {
          if (cancelled) return;
          setRatio(Math.max(0, Math.min(1, p.ratio)));
          setLabel(p.label);
        });
        if (!cancelled) navigation.replace("MainTabs");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "加载失败");
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.logoWrap}>
          <Image source={{ uri: TOP_AVATAR_URI || HOME_IMAGE_URLS.topAvatar }} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
          <Text style={styles.progressPercent}>{percentText}</Text>
        </View>

        <Text style={styles.label}>{error ? `启动失败：${error}` : `正在加载：${label}`}</Text>
        {!error ? <ActivityIndicator size="small" color="#111827" style={{ marginTop: 10 }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#efefef" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  logoWrap: {
    width: 90,
    height: 90,
    borderRadius: 20,
    backgroundColor: "#d7d7d7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  logo: { width: 70, height: 70, borderRadius: 14, backgroundColor: "transparent" },
  progressWrap: { width: "100%", maxWidth: 320, marginTop: 6 },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#d1d5db",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#ff4655",
  },
  progressPercent: {
    marginTop: 8,
    textAlign: "center",
    fontWeight: "800",
    color: "#111827",
  },
  label: {
    marginTop: 12,
    color: "#4b5563",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});

