import "./style.css";
import { Client } from "./client";
import {
  AppError,
  OPS,
  SYMBOL,
  generate,
  grade,
  normalizeAnswer,
  shanghaiDate,
  uuid,
  now,
  type Profile,
  type Practice,
  type Grade,
  type Op,
} from "./domain";
const app = document.querySelector<HTMLDivElement>("#app")!;
const client = new Client();
const h = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const gname = (g: number) => ["", "一年级", "二年级", "三年级"][g];
const icon = (name: string) =>
  ({
    home: "⌂",
    practice: "＋",
    review: "↻",
    history: "▤",
    settings: "⚙",
    arrow: "↗",
  })[name] ?? name;
let profiles: Profile[] = [],
  selected: Profile | null = null,
  view = "home",
  current: Practice | null = null,
  index = 0,
  raw: string[] = [],
  temporary = false,
  conflict = false;
let editSeq = 0,
  savedSeq = 0,
  saveQueue: Promise<void> = Promise.resolve(),
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  maxTimer: ReturnType<typeof setTimeout> | undefined;
let historyCursor: string | null = null,
  historyItems: any[] = [],
  historyFrom = shanghaiDate(new Date(Date.now() - 6 * 86400000)),
  historyTo = shanghaiDate(),
  historyBusy = false,
  renderSeq = 0;
let healthIssues: any[] = [];
const channel =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("oral-practice-changes")
    : null;
channel?.addEventListener("message", () => {
  if (current?.status === "draft" && view === "practice") {
    notice("另一页面更新了记录。写入前会检查版本；需要时可载入最新。");
  } else if (!temporary) void render();
});
const broadcast = () =>
  channel?.postMessage({ epoch: client.epoch, changeSeq: client.changeSeq });
function notice(message: string, error = false) {
  let box = document.querySelector<HTMLDivElement>("#notice");
  if (!box) {
    box = document.createElement("div");
    box.id = "notice";
    box.setAttribute("role", "status");
    document.body.append(box);
  }
  box.textContent = message;
  box.className = error ? "notice error" : "notice";
  clearTimeout((notice as any).timer);
  (notice as any).timer = setTimeout(() => box?.classList.add("hidden"), 6500);
}
function error(e: unknown) {
  notice(e instanceof Error ? e.message : "操作失败，请重试。", true);
}
async function ask(
  title: string,
  body: string,
  confirm = "确认",
  danger = false,
  typed = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.innerHTML = `<form method="dialog"><div class="eyebrow">请确认</div><h2>${h(title)}</h2><p>${h(body)}</p>${typed ? '<label>请输入“删除”确认<input name="confirmText" autocomplete="off" placeholder="删除" required></label>' : ""}<div class="dialog-actions"><button value="cancel" class="secondary" formnovalidate>取消</button><button value="ok" class="${danger ? "danger" : "primary"}">${h(confirm)}</button></div></form>`;
    d.querySelector("form")!.addEventListener("submit", (e) => {
      if (
        (e as SubmitEvent).submitter?.getAttribute("value") === "ok" &&
        typed &&
        (d.querySelector("input") as HTMLInputElement).value !== "删除"
      ) {
        e.preventDefault();
        (d.querySelector("input") as HTMLInputElement).setCustomValidity(
          "请输入“删除”",
        );
        (d.querySelector("input") as HTMLInputElement).reportValidity();
      }
    });
    d.querySelector("input")?.addEventListener("input", (e) =>
      (e.target as HTMLInputElement).setCustomValidity(""),
    );
    d.addEventListener("close", () => {
      const yes = d.returnValue === "ok";
      d.remove();
      resolve(yes);
    });
    document.body.append(d);
    d.showModal();
  });
}
async function loadProfiles() {
  profiles = (await client.call("profile.list")).profiles;
  if (selected) selected = profiles.find((p) => p.id === selected!.id) ?? null;
  selected ??= profiles[0] ?? null;
}
function shell(body: string) {
  const nav = [
    ["home", "学习首页", "home"],
    ["review", "错题复习", "review"],
    ["history", "学习记录", "history"],
    ["settings", "家长模式", "settings"],
  ];
  app.innerHTML = `<aside class="sidebar"><button class="brand" data-nav="home" aria-label="拾光口算首页"><span class="brand-mark">拾</span><span>拾光口算<small>LITTLE STEPS</small></span></button><p class="nav-label">每一天，都有新进步</p><nav>${nav.map(([id, label, ico]) => `<button data-nav="${id}" class="nav-item ${view === id ? "active" : ""}"><span aria-hidden="true">${icon(ico)}</span>${label}</button>`).join("")}</nav><div class="sidebar-note"><span class="leaf">✦</span><strong>慢慢来，也很棒。</strong><p>练习没有倒计时，<br>每一步都算数。</p></div><footer>数据保存在当前浏览器<br><span>v0.1.0 · 本地学习空间</span></footer></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">学习空间 <span>/</span> ${view === "practice" ? "口算练习" : view === "result" ? "练习结果" : (nav.find((n) => n[0] === view)?.[1] ?? "学习首页")}</div><div class="profile-tools">${selected ? `<label class="sr-only" for="profile-select">选择儿童档案</label><select id="profile-select" ${temporary ? "disabled" : ""}>${profiles.map((p) => `<option value="${p.id}" ${selected?.id === p.id ? "selected" : ""}>${h(p.nickname)} · ${gname(p.grade)}</option>`).join("")}</select>` : '<span class="quiet">还没有儿童档案</span>'}<span class="avatar">${h(selected?.nickname.slice(0, 1) ?? "＋")}</span></div></header>${temporary ? '<div class="banner warning">临时练习 · 刷新后会丢失，不计入正式每日记录。<button data-action="recover" class="text-button">恢复检查</button></div>' : ""}<main id="main">${body}</main><footer class="mobile-footer">拾光口算 · 每天一点进步</footer></div>`;
  app
    .querySelectorAll<HTMLElement>("[data-progress]")
    .forEach((el) => (el.style.width = Number(el.dataset.progress) + "%"));
}
const loading = () =>
  shell(
    '<div class="empty"><span class="spinner"></span><p>正在打开学习空间…</p></div>',
  );
function profileDialog(existing: Profile | null = null) {
  const d = document.createElement("dialog");
  d.innerHTML = `<form id="profile-form"><div class="eyebrow">孩子的学习空间</div><h2>${existing ? "编辑档案" : "认识一下小学习家"}</h2><p>用一个喜欢的昵称就好，不需要真实姓名。</p><label>昵称<input name="nickname" maxlength="40" value="${h(existing?.nickname ?? "")}" placeholder="例如：小橙子" required autocomplete="off"></label><label>年级<select name="grade">${[1, 2, 3].map((g) => `<option value="${g}" ${existing?.grade === g ? "selected" : ""}>${gname(g)}</option>`).join("")}</select></label><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-close>取消</button><button class="primary" type="submit">${existing ? "保存修改" : "创建档案"}</button></div></form>`;
  d.querySelector("[data-close]")!.addEventListener("click", () => d.close());
  d.addEventListener("close", () => d.remove());
  d.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement,
      f = new FormData(form);
    const button = form.querySelector(
      "button[type=submit]",
    ) as HTMLButtonElement;
    button.disabled = true;
    try {
      const params = {
        epoch: client.epoch,
        nickname: String(f.get("nickname")),
        grade: Number(f.get("grade")),
      };
      selected = await client.call(
        existing ? "profile.update" : "profile.create",
        existing
          ? {
              ...params,
              id: existing.id,
              expectedProfileRevision: existing.profileRevision,
            }
          : params,
      );
      await loadProfiles();
      d.close();
      broadcast();
      await navigate("home");
    } catch (e) {
      form.querySelector(".form-error")!.textContent = (e as Error).message;
    } finally {
      button.disabled = false;
    }
  });
  document.body.append(d);
  d.showModal();
}
async function render() {
  const ticket = ++renderSeq;
  try {
    if (view === "practice") {
      practiceView();
      return;
    }
    if (view === "result") {
      resultView();
      return;
    }
    if (!selected) {
      shell(
        `<section class="welcome"><div class="eyebrow">HELLO, LITTLE LEARNER</div><h1>每天一点，<br>把进步变成习惯。</h1><p>专为一至三年级设计的口算练习。<br>从一份小小的题单开始，慢慢积累大大的自信。</p><button class="primary large" data-action="new-profile">创建儿童档案 <span>＋</span></button><div class="privacy-note">◎ 只需昵称 · 无需账号 · 学习数据不上传</div></section>`,
      );
      return;
    }
    if (view === "home") {
      const progress = temporary
        ? { answeredCount: 0, achieved: false }
        : await client.call("progress.today", { profileId: selected.id });
      const drafts = temporary
        ? { normal: null, review: null }
        : await client.call("practice.resume", { profileId: selected.id });
      if (ticket !== renderSeq) return;
      const percent = Math.min(100, (progress.answeredCount / 30) * 100);
      shell(
        `<section class="page-heading"><div><div class="eyebrow">${shanghaiDate().replaceAll("-", " / ")} · 今天也要加油</div><h1>你好，${h(selected.nickname)} <span class="sun">☀</span></h1><p>让数字成为朋友，每天收获一点新进步。</p></div><span class="pill">${gname(selected.grade)}学习计划</span></section><section class="hero"><div class="hero-copy"><span class="hero-label">今日小目标</span><h2>${progress.achieved ? "今天的目标，完成啦！" : "30 道口算，\n一小步成长。"}</h2><p>${progress.achieved ? "还想练一练？按自己的节奏继续吧。" : "不用急，认真思考比速度更重要。"}</p><div class="hero-progress"><strong>${progress.answeredCount}<small> / 30 道已答</small></strong><span>${progress.achieved ? "已达标 ✓" : "继续积累"}</span></div><div class="progress-track"><div data-progress="${percent}"></div></div></div><div class="math-art" aria-hidden="true"><div class="orbit"></div><div class="math-tile tile-one">7<span>＋</span>5</div><div class="math-tile tile-two">12<span class="spark">✦</span></div><span class="art-dot dot-one"></span><span class="art-dot dot-two"></span><span class="art-star">✧</span><div class="art-caption">SMALL STEPS, BIG SMILES</div></div></section><div class="home-grid"><section class="card config"><div class="section-title"><div><span class="eyebrow">准备好了吗</span><h2>开始今天的练习</h2></div><span class="section-icon">＋</span></div><form id="config-form"><div class="field-row"><label>练习年级<select name="grade" id="config-grade">${[1, 2, 3].map((g) => `<option value="${g}" ${g === selected!.grade ? "selected" : ""}>${gname(g)}</option>`).join("")}</select></label><fieldset><legend>题目数量</legend><div class="segments">${[10, 20, 30].map((n) => `<label><input type="radio" name="count" value="${n}" ${n === 30 ? "checked" : ""}><span>${n} 题</span></label>`).join("")}</div></fieldset></div><fieldset><legend>练习题型</legend><div class="operator-options" id="operators">${operatorOptions(selected.grade)}</div></fieldset><p class="hint">请按已学内容选择题型；年级预设不代表课程全覆盖。</p><button class="primary wide large" type="submit">开始练习 <span>→</span></button></form>${drafts.normal ? `<button class="resume" data-open="${drafts.normal.id}"><span>↶ 还有一份普通练习草稿</span><strong>继续作答 →</strong></button>` : ""}${drafts.review ? `<button class="resume" data-open="${drafts.review.id}"><span>↶ 还有一份复习草稿</span><strong>继续复习 →</strong></button>` : ""}</section><aside class="card guide"><span class="eyebrow">给家长的小提示</span><h2>陪伴，比催促更有用。</h2><div class="tip"><span>01</span><div><strong>按孩子的节奏</strong><p>没有限时和排名，留出思考的空间。</p></div></div><div class="tip"><span>02</span><div><strong>把错误变成机会</strong><p>提交后自动整理错题，复习巩固更轻松。</p></div></div><div class="tip"><span>03</span><div><strong>记得定期备份</strong><p>记录保存在这个浏览器，换设备前先导出。</p></div></div><button class="text-button" data-nav="settings">打开家长模式 ↗</button></aside></div>`,
      );
      document
        .querySelector("#config-grade")
        ?.addEventListener("change", (e) => {
          document.querySelector("#operators")!.innerHTML = operatorOptions(
            Number((e.target as HTMLSelectElement).value) as Grade,
          );
        });
      document
        .querySelector("#config-form")
        ?.addEventListener("submit", async (e) => {
          e.preventDefault();
          const f = new FormData(e.target as HTMLFormElement);
          await busy(e.target as HTMLElement, () =>
            createPractice("normal", {
              grade: Number(f.get("grade")),
              count: Number(f.get("count")),
              operators: f.getAll("operator"),
            }),
          );
        });
    } else if (view === "review") {
      const r = temporary
        ? { items: [], total: 0 }
        : await client.call("review.list", {
            profileId: selected.id,
            cursor: null,
            limit: 100,
          });
      if (ticket !== renderSeq) return;
      shell(
        `<section class="page-heading"><div><div class="eyebrow">每一次回顾，都是进步</div><h1>错题小本</h1><p>复习答对后，题目会离开待复习列表；累计错误记录保留。</p></div>${r.total ? '<button class="primary" data-action="review">开始复习 →</button>' : ""}</section>${r.total ? `<div class="stats-strip"><strong>${r.total}<small>道待复习</small></strong><p>按最近出错排序，每次最多复习30题。${r.total > 100 ? "此页显示最近100题。" : ""}</p></div><div class="wrong-grid">${r.items.map((w: any) => `<article class="card wrong-card"><span class="tag">${gname(w.sourceGrade)}</span><div class="equation">${w.a} ${SYMBOL[w.op as Op]} ${w.b} = ?</div><div class="wrong-meta"><span>累计错 ${w.wrongCount} 次</span><span>${shanghaiDate(w.lastWrongAt)}</span></div></article>`).join("")}</div>` : empty("✧", "暂无待复习题", "每次练习中的错题和未答题会自动收集在这里。", "开始练习", "home")}`,
      );
    } else if (view === "history") {
      await renderHistory(ticket);
    } else if (view === "settings") {
      if (!temporary) {
        const health = await client.call("health.inspect");
        if (health.mode === "readOnly") {
          recoveryView(health);
          return;
        }
        healthIssues = health.issues;
      }
      if (ticket !== renderSeq) return;
      shell(
        `<section class="page-heading"><div><div class="eyebrow">一起守护成长</div><h1>家长模式</h1><p>管理档案、备份记录，了解孩子的每一步。</p></div><span class="pill">操作视图 · 非密码锁</span></section><div class="settings-grid"><section class="card"><div class="section-title"><h2>儿童档案</h2><button class="secondary" data-action="new-profile" ${temporary ? "disabled" : ""}>添加档案</button></div>${profiles.map((p) => `<div class="profile-row"><span class="avatar">${h(p.nickname.slice(0, 1))}</span><div><strong>${h(p.nickname)}</strong><p>${gname(p.grade)}</p></div><button class="text-button" data-edit="${p.id}" ${temporary ? "disabled" : ""}>编辑</button><button class="text-button danger-text" data-delete-profile="${p.id}" ${temporary ? "disabled" : ""}>删除</button></div>`).join("")}</section><section class="card"><div class="eyebrow">把成长好好收藏</div><h2>备份与恢复</h2><p>数据只在当前浏览器。清理网站数据、换浏览器或换设备前，请先导出备份。</p><div class="button-row"><button class="primary" data-action="export" ${temporary ? "disabled" : ""}>导出备份 ↓</button><button class="secondary" data-action="import" ${temporary ? "disabled" : ""}>恢复备份 ↑</button><input type="file" id="import-file" accept=".json,application/json" class="sr-only" aria-label="选择备份文件"></div><p class="hint">UTF-8 JSON · 最大50MiB · 恢复将替换全部当前记录</p></section><section class="card"><h2>使用说明</h2><ol class="help-list"><li>选好年级和已学题型，生成10、20或30道题。</li><li>输入答案后等待“已保存”，中断后可继续草稿。</li><li>提交后查看结果。每日目标只累计普通练习的已答题数。</li><li>复习不计每日目标；打印不改变学习记录。</li></ol><p class="hint">三年使用覆盖指定整数题型，不包含全部课程。首次打开和刷新需要网络；已打开页面可以离线练习。</p></section><section class="card"><h2>数据与联系</h2><p>不收集真实姓名、学校、生日、手机号；没有广告、排名和学习数据上传。</p><p>共享设备的其他使用者可以访问本地记录。备份文件含学习数据，请自行妥善保存。</p><p>问题反馈：${import.meta.env.VITE_MAINTAINER_EMAIL ? `<span id="email">${h(import.meta.env.VITE_MAINTAINER_EMAIL)}</span><button class="text-button" data-action="copy-email">复制地址</button>` : '<span class="quiet">维护者邮箱尚未配置（开发预览）</span>'}</p><p class="hint">反馈仅由你自行发送，不自动附带任何学习记录。</p><button class="text-button danger-text" data-action="clear" ${temporary ? "disabled" : ""}>清空全部数据</button></section>${healthIssues.length ? `<section class="card full"><h2>需要处理的记录</h2><p>以下记录已隔离，未计入成绩和每日统计。</p>${healthIssues.map((q) => `<div class="issue-row"><code>${h(q.practiceId)}</code><button class="secondary" data-diagnostic="${q.practiceId}">导出诊断</button><button class="text-button danger-text" data-delete-corrupt="${q.practiceId}">删除坏记录</button></div>`).join("")}</section>` : ""}</div>`,
      );
      document
        .querySelector("#import-file")
        ?.addEventListener("change", async (e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (!f) return;
          try {
            if (f.size > 50 * 1024 * 1024)
              throw new AppError("E_LIMIT", "备份不能超过50MiB。");
            notice("正在校验备份，不会修改当前数据…");
            const preview = await client.call("backup.preview", {
              bytes: await f.arrayBuffer(),
            });
            if (
              await ask(
                "替换全部本地记录？",
                `文件包含${preview.profileCount}个档案、${preview.practiceCount}份练习、${preview.questionCount}道题。当前全部记录将被替换，请先确认已备份。`,
                "确认恢复",
                true,
              )
            ) {
              await client.call("backup.replace", {
                epoch: client.epoch,
                token: preview.token,
                confirmReplace: true,
              });
              current = null;
              selected = null;
              await loadProfiles();
              broadcast();
              await navigate("home");
              notice("备份恢复完成。");
            }
          } catch (e) {
            error(e);
          } finally {
            (e.target as HTMLInputElement).value = "";
          }
        });
    }
  } catch (e) {
    error(e);
    if (!document.querySelector("#main"))
      shell(
        empty("!", "暂时无法加载", "请检查浏览器存储后重试。", "重试", "home"),
      );
  }
}
function operatorOptions(g: Grade) {
  return OPS.filter((o) => g > 1 || o === "+" || o === "-")
    .map(
      (op) =>
        `<label class="operator"><input type="checkbox" name="operator" value="${op}" checked><span><b>${SYMBOL[op]}</b>${{ "+": "加法", "-": "减法", "*": "乘法", "/": "除法" }[op]}</span></label>`,
    )
    .join("");
}
function empty(
  symbol: string,
  title: string,
  description: string,
  button: string,
  nav: string,
) {
  return `<section class="card empty"><span class="empty-icon">${symbol}</span><h2>${title}</h2><p>${description}</p><button class="primary" data-nav="${nav}">${button}</button></section>`;
}
async function renderHistory(ticket: number, append = false) {
  if (historyBusy) return;
  historyBusy = true;
  try {
    const r = temporary
      ? { items: [], nextCursor: null, excludedCount: 0 }
      : await client.call("history.query", {
          profileId: selected!.id,
          from: historyFrom,
          to: historyTo,
          cursor: append ? historyCursor : null,
          limit: 20,
        });
    if (ticket !== renderSeq) return;
    historyItems = append ? [...historyItems, ...r.items] : r.items;
    historyCursor = r.nextCursor;
    shell(
      `<section class="page-heading"><div><div class="eyebrow">成长有迹可循</div><h1>学习记录</h1><p>每一份认真完成的练习，都值得被看见。</p></div></section><section class="card"><form class="filter-row" id="history-filter"><label>开始日期<input type="date" name="from" value="${historyFrom}" required></label><span>至</span><label>结束日期<input type="date" name="to" value="${historyTo}" required></label><button class="secondary" type="submit">查询记录</button></form>${r.excludedCount ? `<p class="banner warning">有${r.excludedCount}条损坏记录已排除，请到家长模式处理。</p>` : ""}${historyItems.length ? `<div class="history-list">${historyItems.map((p) => `<button class="history-row" data-open="${p.id}"><span class="history-icon">${p.kind === "review" ? "↻" : "＋"}</span><span><strong>${p.kind === "review" ? "错题复习" : "口算练习"} · ${p.questionCount}题</strong><small>${p.submittedDate} · ${gname(p.gradeSnapshot)}</small></span><span class="history-score">${p.result.accuracy.toFixed(1)}<small>% 正确率</small></span><span class="history-answered">已答 ${p.result.answeredCount} 题</span><span>→</span></button>`).join("")}</div>${historyCursor ? '<button class="secondary wide" data-action="more-history">加载更多</button>' : ""}` : '<div class="empty compact"><span class="empty-icon">▤</span><h2>这段时间还没有记录</h2><p>提交练习后，可以在这里回顾。</p></div>'}</section>`,
    );
    document
      .querySelector("#history-filter")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(e.target as HTMLFormElement);
        historyFrom = String(f.get("from"));
        historyTo = String(f.get("to"));
        await render();
      });
  } finally {
    historyBusy = false;
  }
}
async function busy(element: HTMLElement, fn: () => Promise<void>) {
  const buttons = [...element.querySelectorAll<HTMLButtonElement>("button")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    error(e);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}
async function createPractice(
  kind: "normal" | "review",
  config: Record<string, any> = {},
) {
  if (!selected) return;
  if (temporary) {
    if (kind === "review")
      throw new AppError("E_STORAGE", "临时模式没有正式错题记录。");
    const t = now();
    current = {
      id: uuid(),
      profileId: selected.id,
      gradeSnapshot: config.grade,
      ruleVersion: 1,
      kind: "normal",
      status: "draft",
      revision: 0,
      createdAt: t,
      updatedAt: t,
      submittedAt: null,
      submittedDate: null,
      result: null,
      questions: generate(config.grade, config.operators, config.count),
    };
    openCurrent();
    return;
  }
  const drafts = await client.call("practice.resume", {
      profileId: selected.id,
    }),
    old = drafts[kind];
  if (
    old &&
    !(await ask(
      "替换已有草稿？",
      "当前草稿还没有提交。替换后其题目和答案会被删除；取消后可从首页继续原草稿。",
      "确认替换",
      true,
    ))
  )
    return;
  current = await client.call(
    kind === "normal" ? "practice.create" : "review.create",
    {
      epoch: client.epoch,
      profileId: selected.id,
      expectedProfileRevision: selected.profileRevision,
      ...config,
      replaceDraftId: old?.id ?? null,
      replaceDraftRevision: old?.revision ?? null,
    },
  );
  broadcast();
  openCurrent();
}
function openCurrent() {
  index = 0;
  raw = current!.questions.map((q) =>
    q.answer === null ? "" : String(q.answer),
  );
  savedSeq = editSeq = 0;
  conflict = false;
  view = current!.status === "submitted" ? "result" : "practice";
  void render();
}
async function openPractice(id: string) {
  if (!(await leavePractice())) return;
  try {
    current = await client.call("practice.get", { id });
    openCurrent();
  } catch (e) {
    error(e);
  }
}
function practiceView() {
  if (!current) {
    view = "home";
    void render();
    return;
  }
  const q = current.questions[index],
    answered = raw.filter((s) => s.trim() !== "").length;
  shell(
    `<section class="practice-heading"><button class="text-button" data-nav="home">← 返回首页</button><span class="pill">${current.kind === "review" ? "错题复习" : gname(current.gradeSnapshot) + "口算"} · ${current.questions.length}题${temporary ? " · 临时" : ""}</span><button class="secondary" data-action="print">打印题单</button></section><section class="practice-card card"><div class="practice-status"><span>第 <strong>${index + 1}</strong> / ${current.questions.length} 题</span><span id="save-status" role="status">${temporary ? "仅保存在内存" : conflict ? "记录有冲突" : editSeq === savedSeq ? "已保存" : "等待保存"}</span></div><div class="progress-track thin"><div data-progress="${((index + 1) / current.questions.length) * 100}"></div></div><p class="encouragement">想一想，再写下你的答案。</p><div class="big-equation" aria-hidden="true">${q.a} <span>${SYMBOL[q.op]}</span> ${q.b} <span>=</span></div><label class="sr-only" for="answer">第${index + 1}题，${q.a}${SYMBOL[q.op]}${q.b}的答案</label><input id="answer" class="answer-input" type="text" inputmode="numeric" autocomplete="off" value="${h(raw[index])}" aria-describedby="answer-error"><p id="answer-error" class="input-error" role="alert"></p><div class="practice-controls"><button class="secondary" data-action="prev" ${index === 0 ? "disabled" : ""}>← 上一题</button><span id="answered-count">已答 ${answered} 题</span><button class="primary" data-action="next" ${index === current.questions.length - 1 ? "disabled" : ""}>下一题 →</button></div><div class="question-dots">${current.questions.map((_, i) => `<button class="question-dot ${i === index ? "current" : ""} ${raw[i].trim() ? "answered" : ""}" data-question="${i}" aria-label="第${i + 1}题${raw[i].trim() ? "已答" : "未答"}" ${i === index ? 'aria-current="step"' : ""}>${i + 1}</button>`).join("")}</div><div class="practice-bottom"><button class="text-button" data-action="reload-practice">载入最新</button><button class="primary" data-action="submit">提交答案 →</button></div></section><p class="under-note">${temporary ? "关闭或刷新会丢失临时练习。" : "看到“已保存”后再离开，回来可以继续。"} 空题可以保留，提交前会再次确认。</p>`,
  );
  const input = document.querySelector<HTMLInputElement>("#answer")!;
  input.addEventListener("input", () => {
    raw[index] = input.value;
    editSeq++;
    let valid = true;
    try {
      normalizeAnswer(input.value);
      document.querySelector("#answer-error")!.textContent = "";
      input.removeAttribute("aria-invalid");
    } catch (e) {
      valid = false;
      document.querySelector("#answer-error")!.textContent = (
        e as Error
      ).message;
      input.setAttribute("aria-invalid", "true");
    }
    document.querySelector("#answered-count")!.textContent =
      `已答 ${raw.filter((s) => s.trim()).length} 题`;
    if (valid) scheduleSave();
    else saveLabel("输入有误，尚未保存", true);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (index < current!.questions.length - 1) void step(index + 1);
    }
  });
  input.focus({ preventScroll: true });
}
function saveLabel(text: string, bad = false) {
  const e = document.querySelector("#save-status");
  if (e) {
    e.textContent = text;
    e.className = bad ? "bad" : "saved";
  }
}
function snapshot() {
  return current!.questions.map((q, i) => ({
    questionId: q.id,
    value: normalizeAnswer(raw[i]),
  }));
}
function scheduleSave() {
  if (temporary) {
    saveLabel("仅保存在内存");
    return;
  }
  if (conflict) {
    saveLabel("有冲突，请载入最新", true);
    return;
  }
  saveLabel("尚未保存");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush().catch(error), 200);
  maxTimer ??= setTimeout(() => void flush().catch(error), 800);
}
async function flush() {
  clearTimeout(saveTimer);
  clearTimeout(maxTimer);
  saveTimer = maxTimer = undefined;
  if (!current || current.status === "submitted" || temporary) return;
  const id = current.id,
    seq = editSeq;
  if (seq === savedSeq) return saveQueue;
  const values = snapshot();
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      if (current?.id !== id || seq <= savedSeq) return;
      if (conflict)
        throw new AppError("E_CONFLICT", "记录有冲突，请载入最新后继续。");
      saveLabel("正在保存…");
      try {
        const result = await client.call("practice.save", {
          epoch: client.epoch,
          id,
          expectedRevision: current.revision,
          answers: values,
        });
        if (current?.id === id) {
          current.revision = result.revision;
          current.updatedAt = result.updatedAt;
          values.forEach((a, i) => (current!.questions[i].answer = a.value));
          savedSeq = seq;
          saveLabel(editSeq === seq ? "已保存" : "尚未保存");
        }
        broadcast();
      } catch (e) {
        if (
          e instanceof AppError &&
          ["E_CONFLICT", "E_EPOCH", "E_READ_ONLY"].includes(e.code)
        )
          conflict = true;
        saveLabel(
          conflict ? "记录有冲突，请载入最新" : "未保存，请保留输入",
          true,
        );
        throw e;
      }
    });
  return saveQueue;
}
async function step(i: number) {
  try {
    normalizeAnswer(raw[index]);
    index = i;
    practiceView();
  } catch (e) {
    error(e);
  }
}
async function leavePractice() {
  if (view !== "practice" || !current) return true;
  try {
    await flush();
    return true;
  } catch (e) {
    error(e);
    return ask(
      "离开未保存的练习？",
      "当前有未保存或无效输入。离开后这些输入会丢失；已成功保存的草稿仍保留。",
      "仍然离开",
      true,
    );
  }
}
async function navigate(next: string) {
  if (!(await leavePractice())) return;
  view = next;
  historyCursor = null;
  await render();
  window.scrollTo({ top: 0 });
}
async function submit() {
  if (!current || current.status === "submitted") return;
  const values = snapshot(),
    blank = values.filter((a) => a.value === null).length;
  if (
    blank &&
    !(await ask(
      "还有题目未作答",
      `还有${blank}题空着。空题按未答计入正确率，也会进入错题本。是否提交？`,
      "确认提交",
    ))
  )
    return;
  if (temporary) {
    current.questions.forEach((q, i) => (q.answer = values[i].value));
    current.result = grade(current.questions);
    current.status = "submitted";
    view = "result";
    resultView();
    return;
  }
  await flush();
  await saveQueue;
  const result = await client.call("practice.submit", {
    epoch: client.epoch,
    id: current.id,
    expectedRevision: current.revision,
    answers: snapshot(),
    confirmBlank: true,
  });
  current = result.practice;
  view = "result";
  broadcast();
  resultView();
}
function resultView() {
  if (!current?.result) {
    view = "home";
    void render();
    return;
  }
  const p = current,
    r = p.result!;
  shell(
    `<section class="page-heading"><div><div class="eyebrow">${temporary ? "临时练习结果 · 不计入正式记录" : "认真完成，值得鼓励"}</div><h1>又向前迈了一小步！</h1><p>${p.kind === "review" ? "复习不计入每日目标。" : "本次已答 " + r.answeredCount + " 题" + (temporary ? "。" : "，计入 " + p.submittedDate + " 的每日进度。")}</p></div><button class="primary" data-nav="home">再练一次 →</button></section><section class="result-hero card"><div class="result-medal" aria-hidden="true">✦</div><div class="score"><strong>${r.accuracy.toFixed(1)}<span>%</span></strong><p>本次正确率 · 包含未答题</p></div><div class="result-stats"><div><strong>${r.correctCount}</strong><span>答对</span></div><div><strong>${r.wrongCount}</strong><span>答错</span></div><div><strong>${r.blankCount}</strong><span>未答</span></div></div></section><section class="card"><div class="section-title"><h2>一起回顾一下</h2><div class="button-row"><button class="secondary" data-action="print">打印题单</button><button class="secondary" data-action="print-answers">打印答案</button></div></div><div class="answer-grid">${p.questions.map((q) => `<div class="answer-row ${q.answer === q.expected ? "correct" : "incorrect"}"><span class="q-number">${q.ordinal}</span><strong>${q.a} ${SYMBOL[q.op]} ${q.b} = ${q.expected}</strong><span class="answer-badge">${q.answer === q.expected ? "✓ 答对" : q.answer === null ? "— 未答" : "× 你的答案 " + q.answer}</span></div>`).join("")}</div></section>`,
  );
}
function download(data: any) {
  const url = URL.createObjectURL(
      new Blob([data.bytes], {
        type: data.mime ?? "application/json;charset=utf-8",
      }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = data.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  notice("已交给浏览器下载，请确认文件保存成功。");
}
async function print(answers = false) {
  if (!current) return;
  const data = temporary
    ? {
        profileNickname: selected!.nickname,
        gradeSnapshot: current.gradeSnapshot,
        practiceId: current.id,
        questions: current.questions,
      }
    : await client.call("print.read", {
        id: current.id,
        variant: answers ? "answers" : "questions",
      });
  const el = document.createElement("div");
  el.id = "print-root";
  el.innerHTML = `<h1>拾光口算 · ${answers ? "参考答案" : "口算题单"}</h1><p>${h(data.profileNickname)} · ${gname(data.gradeSnapshot)} · 编号 ${h(data.practiceId.slice(0, 8))}</p><div class="print-grid">${data.questions.map((q: QuestionLike) => `<div>${q.ordinal}.　${q.a} ${SYMBOL[q.op]} ${q.b} = ${answers ? q.expected : "________"}</div>`).join("")}</div>`;
  document.body.append(el);
  window.print();
  el.remove();
}
type QuestionLike = {
  ordinal: number;
  a: number;
  b: number;
  op: Op;
  expected: number;
};
async function deleteData(target: string, id: string | null) {
  await client.call("profile.list");
  const seq = client.changeSeq;
  if (
    await ask(
      "确认删除数据？",
      target === "all"
        ? "这将删除当前浏览器全部档案与学习记录。请先导出备份，此操作无法撤销。"
        : "这会删除所选档案的全部记录，或该条已隔离记录。请先备份/导出诊断。",
      "确认删除",
      true,
      true,
    )
  ) {
    await client.call("data.delete", {
      epoch: client.epoch,
      target,
      id,
      basisChangeSeq: seq,
      confirm: true,
    });
    current = null;
    await loadProfiles();
    broadcast();
    await navigate(selected ? "settings" : "home");
    notice("数据已删除。");
  }
}
document.addEventListener("click", async (e) => {
  const b = (e.target as Element).closest<HTMLElement>("button");
  if (!b || b.closest("dialog") || b.hasAttribute("disabled")) return;
  try {
    if (b.dataset.nav) {
      await navigate(b.dataset.nav);
      return;
    }
    if (b.dataset.open) {
      await openPractice(b.dataset.open);
      return;
    }
    if (b.dataset.edit) {
      profileDialog(profiles.find((p) => p.id === b.dataset.edit)!);
      return;
    }
    if (b.dataset.deleteProfile) {
      await deleteData("profile", b.dataset.deleteProfile);
      return;
    }
    if (b.dataset.deleteCorrupt) {
      await deleteData("corruptPractice", b.dataset.deleteCorrupt);
      return;
    }
    if (b.dataset.diagnostic) {
      download(
        await client.call("health.exportRaw", {
          practiceId: b.dataset.diagnostic,
        }),
      );
      return;
    }
    if (b.dataset.question !== undefined) {
      await step(Number(b.dataset.question));
      return;
    }
    const a = b.dataset.action;
    if (!a) return;
    b.setAttribute("disabled", "");
    try {
      if (a === "new-profile") profileDialog();
      else if (a === "prev") await step(index - 1);
      else if (a === "next") await step(index + 1);
      else if (a === "submit") await submit();
      else if (a === "review") await createPractice("review");
      else if (a === "reload-practice") {
        if (
          await ask(
            "载入已保存记录？",
            "本页未保存内容将被丢弃，改为读取浏览器里的最新记录。",
            "载入最新",
          )
        ) {
          clearTimeout(saveTimer);
          clearTimeout(maxTimer);
          await saveQueue.catch(() => {});
          current = await client.call("practice.get", { id: current!.id });
          openCurrent();
        }
      } else if (a === "print" || a === "print-answers")
        await print(a === "print-answers");
      else if (a === "export") download(await client.call("backup.export"));
      else if (a === "import")
        document.querySelector<HTMLInputElement>("#import-file")!.click();
      else if (a === "clear") await deleteData("all", null);
      else if (a === "more-history") await renderHistory(renderSeq, true);
      else if (a === "copy-email") {
        try {
          await navigator.clipboard.writeText(
            import.meta.env.VITE_MAINTAINER_EMAIL,
          );
          notice("地址已复制，请自行发送反馈。");
        } catch {
          notice("复制不可用，请选中页面邮箱地址手动复制。", true);
        }
      } else if (a === "recover") {
        const health = await client.call("health.inspect");
        if (health.mode === "readOnly") {
          recoveryView(health);
          return;
        }
        if (
          await ask(
            "返回正式练习？",
            "存储已恢复。临时答案不会合并到正式记录，离开后将清除临时会话。",
            "返回正式练习",
          )
        ) {
          temporary = false;
          current = null;
          selected = null;
          await loadProfiles();
          view = "home";
          await render();
        }
      }
    } finally {
      b.removeAttribute("disabled");
    }
  } catch (e) {
    error(e);
  }
});
document.addEventListener("change", async (e) => {
  if ((e.target as HTMLElement).id === "profile-select") {
    const target = e.target as HTMLSelectElement;
    if (await leavePractice()) {
      selected = profiles.find((p) => p.id === target.value) ?? null;
      current = null;
      view = "home";
      await render();
    } else target.value = selected!.id;
  }
});
window.addEventListener("beforeunload", (e) => {
  if (view === "practice" && editSeq !== savedSeq && !temporary) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("focus", () => {
  if (!temporary && view === "home") void render();
});
setInterval(() => {
  if (!temporary && view === "home") void render();
}, 60000);
async function start() {
  loading();
  try {
    const health = await client.call("health.inspect");
    if (health.mode === "readOnly") {
      recoveryView(health);
      return;
    }
    await loadProfiles();
    if (!profiles.length)
      await ask(
        "欢迎来到拾光口算",
        "学习记录只保存在当前浏览器；清理网站数据会删除记录。我们不上传昵称、答案或成绩。请定期导出备份。",
        "我知道了",
      );
    await render();
  } catch (e) {
    shell(
      `<section class="card empty"><span class="empty-icon">!</span><h1>本地存储暂不可用</h1><p>${h((e as Error).message)}</p><p>可以检查浏览器权限后刷新，或先体验临时练习。</p><button class="primary" id="temporary-start">临时练习</button><button class="secondary" id="retry-start">重新检查</button></section>`,
    );
    document
      .querySelector("#retry-start")!
      .addEventListener("click", () => void start());
    document
      .querySelector("#temporary-start")!
      .addEventListener("click", () => {
        temporary = true;
        selected = {
          id: uuid(),
          nickname: "小学习家",
          grade: 1,
          createdAt: now(),
          profileRevision: 0,
        };
        profiles = [selected];
        view = "home";
        void render();
      });
  }
}
function recoveryView(health: any) {
  shell(
    `<section class="card empty"><span class="empty-icon">!</span><h1>本地记录需要修复</h1><p>${h(health.issues[0]?.recovery)}</p><p>已停止新增写入。恢复前请保留已有备份，清空不能撤销。</p><label>选择有效JSON备份<input id="recovery-file" type="file" accept=".json,application/json"></label><button class="danger" id="recovery-clear">清空全部数据</button></section>`,
  );
  document
    .querySelector("#recovery-file")!
    .addEventListener("change", async (e) => {
      try {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        if (f.size > 50 * 1024 * 1024) throw Error("备份不能超过50MiB。");
        const p = await client.call("backup.preview", {
          bytes: await f.arrayBuffer(),
        });
        if (
          await ask(
            "恢复备份？",
            `将以${p.profileCount}个档案、${p.questionCount}题替换当前全部记录。`,
            "确认恢复",
            true,
          )
        ) {
          await client.call("backup.replace", {
            epoch: client.epoch,
            token: p.token,
            confirmReplace: true,
          });
          temporary = false;
          current = null;
          selected = null;
          await start();
        }
      } catch (e) {
        error(e);
      }
    });
  document
    .querySelector("#recovery-clear")!
    .addEventListener("click", async () => {
      try {
        const basisChangeSeq = client.changeSeq;
        if (
          await ask(
            "清空全部数据？",
            "此操作无法撤销。请输入删除进行第二次确认。",
            "确认删除",
            true,
            true,
          )
        ) {
          await client.call("data.delete", {
            epoch: client.epoch,
            target: "all",
            id: null,
            basisChangeSeq,
            confirm: true,
          });
          temporary = false;
          current = null;
          selected = null;
          await start();
        }
      } catch (e) {
        error(e);
      }
    });
}
void start();
