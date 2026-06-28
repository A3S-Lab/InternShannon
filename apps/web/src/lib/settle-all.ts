import { getClientErrorMessage } from "@/lib/client-error";

export interface SettleAllResult<M extends Record<string, Promise<unknown>>> {
  /** 每个键:成功取其值,失败取 null。 */
  data: { [K in keyof M]: Awaited<M[K]> | null };
  /** 仅失败的键 → 错误信息(用于「N 个接口暂不可用」之类的统计,不渗到 UI 主体)。 */
  errors: Partial<Record<keyof M, string>>;
}

/**
 * 并发拉取一组「键 → Promise」,任一失败不连累其它(Promise.allSettled),返回
 * {data, errors}:成功键取值、失败键取 null 并把原因收进 errors。收口此前安全监控页里
 * 一字排开的 unwrapSettled + Promise.allSettled 八连发,供后续任何「多端点拼一个看板」复用。
 *
 * @example
 *   const { data, errors } = await settleAll({
 *     health: api.health(filter),
 *     scan: api.scan(filter),
 *   });
 *   // data.health: HealthCard | null; errors.scan?: string
 */
export async function settleAll<M extends Record<string, Promise<unknown>>>(
  tasks: M,
  formatError: (reason: unknown) => string = getClientErrorMessage,
): Promise<SettleAllResult<M>> {
  const keys = Object.keys(tasks) as Array<keyof M>;
  const settled = await Promise.allSettled(keys.map((key) => tasks[key]));

  const data = {} as { [K in keyof M]: Awaited<M[K]> | null };
  const errors: Partial<Record<keyof M, string>> = {};

  keys.forEach((key, index) => {
    const result = settled[index];
    if (result.status === "fulfilled") {
      data[key] = result.value as Awaited<M[typeof key]>;
    } else {
      data[key] = null;
      errors[key] = formatError(result.reason);
    }
  });

  return { data, errors };
}
