import { AppError, uuid } from "./domain";
export class Client {
  epoch = "";
  changeSeq = 0;
  private worker: Worker;
  private pending = new Map<
    string,
    {
      resolve: (data: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e) => {
      const r = e.data,
        p = this.pending.get(r.requestId);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(r.requestId);
      if (r.ok) {
        this.epoch = r.epoch;
        this.changeSeq = r.changeSeq;
        p.resolve(r.data);
      } else p.reject(new AppError(r.error.code, r.error.message));
    };
    this.worker.onerror = () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(
          new AppError("E_STORAGE", "后台连接中断，请刷新后查看保存状态。"),
        );
      }
      this.pending.clear();
    };
  }
  call<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
    const requestId = uuid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId);
          reject(
            new AppError(
              "E_TIMEOUT",
              "操作结果尚未确认，请重新读取记录后重试。",
            ),
          );
        },
        method.startsWith("backup.") ? 30000 : 10000,
      );
      this.pending.set(requestId, { resolve, reject, timer });
      this.worker.postMessage({ requestId, method, params });
    });
  }
}
