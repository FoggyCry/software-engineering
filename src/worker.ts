import { Service } from "./service";
import { AppError } from "./domain";
let service: Promise<Service> | undefined;
self.onmessage = async (e: MessageEvent) => {
  const { requestId, method, params } = e.data;
  try {
    service ??= Service.create().catch((e) => {
      service = undefined;
      throw e;
    });
    const result = await (await service).execute(method, params);
    self.postMessage({ requestId, ok: true, ...result });
  } catch (e) {
    let code =
      e instanceof AppError
        ? e.code
        : (e as DOMException)?.name === "QuotaExceededError"
          ? "E_QUOTA"
          : (e as DOMException)?.name === "ConstraintError"
            ? "E_CONFLICT"
            : "E_STORAGE";
    self.postMessage({
      requestId,
      ok: false,
      error: {
        code,
        message:
          e instanceof AppError
            ? e.message
            : code === "E_QUOTA"
              ? "浏览器存储空间不足，请备份后清理。"
              : "存储暂不可用，请重试或使用临时练习。",
        retryable: code === "E_STORAGE",
        recovery: "请保留当前输入，重试前先查询练习状态。",
      },
    });
  }
};
