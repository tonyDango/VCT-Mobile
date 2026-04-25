import { useCallback, useEffect, useRef, useState } from "react";

import { loadPersisted, savePersisted } from "../storage/persist";

type Options = {
  /** 若提供，将在版本变化时视为缓存失效（仍可读，但会强制刷新）。 */
  version?: number;
  /** 是否在挂载后自动刷新网络数据；默认 true */
  autoRefresh?: boolean;
};

export function usePersistedAsyncData<T>(
  key: string,
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options: Options = {}
) {
  const version = options.version ?? 1;
  const autoRefresh = options.autoRefresh ?? true;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedCache = useRef(false);

  const update = useCallback(
    async (next: T, persist = true) => {
      setData(next);
      if (key && persist) {
        await savePersisted(key, next, version);
      }
    },
    [key, version]
  );

  const run = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await loader();
      await update(result, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        if (key) {
          const cached = await loadPersisted<T>(key);
          if (!cancelled && cached?.data !== undefined) {
            hasLoadedCache.current = true;
            setData(cached.data);
            setLoading(false);

            // 若版本不一致，强制刷新一次
            if (cached.v !== version && autoRefresh) {
              run();
            }
            return;
          }
        }
      } finally {
        if (!cancelled && !hasLoadedCache.current) {
          // 无缓存：走正常加载
          if (autoRefresh) run();
          else setLoading(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [key, version, autoRefresh, run]);

  return { data, loading, error, reload: run, update };
}

