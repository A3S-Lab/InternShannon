import { useEffect, useRef, useState } from "react";
import { useMemoizedFn } from "ahooks";

export interface AutoRefreshOptions {
  /** 基础轮询间隔(ms)。 */
  interval: number;
  /** 是否启用(就绪门控);false 时不轮询。默认 true。 */
  enabled?: boolean;
  /** 标签页隐藏时暂停轮询、切回时立即刷新一次。默认 true。 */
  pauseWhenHidden?: boolean;
  /** 首次挂载即刷新一次。默认 true。设为 false 时,首屏由调用方自行加载(如需非静默首屏)。 */
  immediate?: boolean;
  /** 自适应:isActive 为 true 时改用此更短间隔(有活跃任务时加速)。 */
  fastInterval?: number;
  /** 自适应活跃标志。 */
  isActive?: boolean;
}

export interface AutoRefreshResult {
  /** 距下次刷新的秒数(倒计时,可直接用于「N 秒后刷新」提示);未在轮询时为 0。 */
  secondsToRefresh: number;
}

/**
 * 统一自动刷新 hook —— 收口此前各页手写的 setInterval/useInterval 数据轮询。一处实现
 * 「固定/自适应间隔 + 标签页隐藏暂停 + 切回立即刷新 + 倒计时」,各页只声明参数。
 * (注:已用 useRequest 的 pollingInterval 的页面本就是 hook 式,无需迁移。)
 *
 * @example
 *   // 固定 10s 轮询
 *   useAutoRefresh(fetchMetrics, { interval: 10000 });
 *   // 有活跃任务时 3s、否则 30s;首屏由调用方非静默加载
 *   const { secondsToRefresh } = useAutoRefresh(() => load({ silent: true }), {
 *     interval: 30000, fastInterval: 3000, isActive: hasActive, immediate: false,
 *   });
 */
export function useAutoRefresh(fetcher: () => void, options: AutoRefreshOptions): AutoRefreshResult {
  const { interval, enabled = true, pauseWhenHidden = true, immediate = true, fastInterval, isActive = false } = options;
  const effectiveInterval = isActive && fastInterval ? fastInterval : interval;
  const fetch = useMemoizedFn(fetcher);
  const [secondsToRefresh, setSeconds] = useState(0);
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  // 区分「首次挂载」与「切回页面再进入轮询」:首屏是否拉取由 immediate 决定,
  // 之后每次重新进入轮询(如切回标签页)都立即刷新一次。
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (!pauseWhenHidden) return;
    const onChange = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [pauseWhenHidden]);

  const polling = enabled && !(pauseWhenHidden && hidden);

  useEffect(() => {
    if (!polling) {
      setSeconds(0);
      return;
    }
    const isFirstRun = firstRunRef.current;
    firstRunRef.current = false;
    if (!isFirstRun || immediate) fetch();
    setSeconds(Math.ceil(effectiveInterval / 1000));

    const poll = window.setInterval(() => {
      fetch();
      setSeconds(Math.ceil(effectiveInterval / 1000));
    }, effectiveInterval);
    const tick = window.setInterval(() => {
      setSeconds((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [polling, effectiveInterval, immediate, fetch]);

  return { secondsToRefresh };
}
