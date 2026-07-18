// ============================================================
//  Han2YT — content.js
//  Đây là "con bot" được tiêm thẳng vào trang Google Flow.
//  Nó tìm ô prompt, gõ chữ, bấm Generate, canh ảnh xong, rồi
//  trả ảnh về cho side panel để tải xuống.
//
//  >>> NẾU GOOGLE ĐỔI GIAO DIỆN VÀ TOOL HỎNG <<<
//  Bạn chỉ cần sửa phần CONFIG ngay bên dưới. Mở Google Flow,
//  bấm F12 -> chọn ô prompt / nút generate -> copy CSS selector
//  rồi dán vào promptSelector / generateSelector.
// ============================================================

const CONFIG = {
  // Để trống ("") thì tool TỰ DÒ. Nếu tự dò sai, điền selector vào đây.
  promptSelector: "",        // vd: 'textarea[placeholder*="create"]'
  generateSelector: "",      // vd: 'button[aria-label="Generate"]'

  // Cách submit: Flow này submit bằng phím ENTER nên để true (mặc định).
  // Nếu Flow của bạn cần click nút thì đổi false.
  submitWithEnter: true,

  // Ảnh kết quả thường to; bỏ qua icon/avatar nhỏ hơn ngưỡng này (pixel)
  minImageSize: 256,

  // Canh ảnh: kiểm tra mỗi pollMs mili-giây, tối đa chờ maxWaitMs
  pollMs: 2000,
  maxWaitMs: 240000,         // 4 phút / 1 ảnh (chỉnh nếu model chậm hơn)
  maxWaitMsVideo: 600000,    // 10 phút / 1 video (video chậm hơn)

  // Chờ thêm sau khi thấy ảnh mới, để ảnh load đầy đủ trước khi tải
  settleMs: 1800,
  settleMsVideo: 3000,       // video cần chờ lâu hơn
};

let STOP = false;

// ---------- Tiện ích nhỏ ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
}

function area(el) {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}

function srcKey(img) {
  return img.currentSrc || img.src || "";
}

// ---------- 1. Tìm ô nhập prompt ----------
// kiểm tra "đang hiện" kiểu lỏng hơn (Slate khi trống vẫn có client rect)
function isShown(el) {
  if (!el) return false;
  if (isVisible(el)) return true;
  return el.getClientRects().length > 0; // dự phòng
}

function findPromptInput() {
  if (CONFIG.promptSelector) {
    const e = document.querySelector(CONFIG.promptSelector);
    if (e) return e;
  }
  // Thử lần lượt các "địa chỉ" ổn định của ô prompt Flow (Slate.js)
  const selectors = [
    '[data-slate-editor="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"][aria-multiline="true"]',
    'div[role="textbox"]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    "textarea",
  ];
  for (const sel of selectors) {
    const all = [...document.querySelectorAll(sel)];
    if (!all.length) continue;
    const shown = all.filter(isShown);
    const list = shown.length ? shown : all; // ưu tiên cái đang hiện, không thì lấy đại
    const hint = /create|prompt|imagine|describe|tạo|生成|描述|생성|作成/i;
    const byText = list.find((e) =>
      hint.test(
        (e.getAttribute("placeholder") || "") +
          (e.getAttribute("aria-label") || "") +
          (e.dataset?.placeholder || "")
      )
    );
    if (byText) return byText;
    list.sort((a, b) => area(b) - area(a));
    return list[0];
  }
  return null;
}

// Đánh thức ô prompt: Slate chỉ "mọc" editor khi vùng prompt được click.
// Hàm này click vào vùng prompt (cạnh trái nút mũi tên) để editor xuất hiện.
async function wakePromptBox() {
  let ed = findPromptInput();
  if (ed) {
    clickFully(ed);
    ed.focus?.();
    await sleep(150);
    return findPromptInput();
  }
  // editor chưa mount -> click vào vùng ô prompt cạnh nút arrow_forward
  const arrow = [...document.querySelectorAll('button, [role="button"]')].find(
    (b) => /arrow_forward/i.test((b.getAttribute("aria-label") || "") + b.textContent)
  );
  if (arrow) {
    const r = arrow.getBoundingClientRect();
    const points = [
      [r.left - 150, r.top + r.height / 2],
      [r.left - 300, r.top + r.height / 2],
      [r.left - 80, r.top + r.height / 2],
    ];
    for (const [x, y] of points) {
      const t = document.elementFromPoint(x, y);
      if (!t) continue;
      ["mousedown", "mouseup", "click"].forEach((type) =>
        t.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
          })
        )
      );
      t.focus?.();
      await sleep(250);
      ed = findPromptInput();
      if (ed) {
        console.log("[Han2YT] ✓ Đánh thức được ô prompt bằng cú click.");
        return ed;
      }
    }
  }
  return findPromptInput();
}

// ---------- 2. Gõ prompt vào ô (xử lý cả React) ----------
function setNativeValue(el, value) {
  const proto =
    el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// Đọc text THẬT của Slate (bỏ qua placeholder)
function slateText(el) {
  return [...el.querySelectorAll("[data-slate-string]")]
    .map((s) => s.textContent)
    .join("");
}
// Ô Slate có đang trống không (placeholder còn hiện = trống)
function slateEmpty(el) {
  return !!el.querySelector("[data-slate-placeholder]") || slateText(el).trim().length === 0;
}

// Đặt con trỏ vào giữa ô (Slate cần selection mới chèn được)
function focusEditor(el) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  ["mousedown", "mouseup", "click"].forEach((t) => {
    (document.elementFromPoint(x, y) || el).dispatchEvent(
      new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window })
    );
  });
  el.focus();
}

// CHÈN CHỮ VÀO SLATE — dùng beforeinput insertText (đã test: Slate nhận cách này)
function slateInsert(el, text) {
  focusEditor(el);
  if (!slateEmpty(el)) {
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      el.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "deleteContentBackward",
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    } catch (_) {}
  }
  el.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );
}

function setPromptText(el, text) {
  if (el.isContentEditable) {
    slateInsert(el, text);
    return;
  }
  const proto =
    el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true, data: text, inputType: "insertText" })
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// đọc nội dung hiện có trong ô prompt (Slate: đọc text thật, bỏ qua placeholder)
function inputText(el) {
  if (el.isContentEditable) {
    if (el.querySelector("[data-slate-string], [data-slate-placeholder]")) {
      return slateText(el);
    }
    return el.innerText || el.textContent || "";
  }
  return el.value || "";
}
function isBtnDisabled(b) {
  return b.disabled || b.getAttribute("aria-disabled") === "true";
}

// ---------- 3. Tìm & bấm nút Generate ----------
function findGenerateButton(input) {
  if (CONFIG.generateSelector) {
    const e = document.querySelector(CONFIG.generateSelector);
    if (e) return e;
  }
  const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(
    (b) => isVisible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true"
  );

  const label = (b) =>
    (
      (b.getAttribute("aria-label") || "") +
      " " +
      (b.title || "") +
      " " +
      b.textContent
    ).toLowerCase();

  // Nút KHÔNG được nhầm: tác nhân/agent, chọn model, xoá, đóng, thùng rác...
  const bad = /agent|tác nhân|delete|close|xoá|xóa|trash|thùng|panel|banana|model|setting/i;

  // 1) Ưu tiên tuyệt đối: nút mũi tên gửi của Flow (icon "arrow_forward")
  let b = buttons.find((x) => /arrow_forward/i.test(label(x)) && !bad.test(label(x)));
  if (b) return b;

  // 2) Các từ khoá gửi/tạo khác
  const wanted = /generate|create|submit|send|run|gửi|送信|生成|→|paper.?plane/i;
  b = buttons.find((x) => wanted.test(label(x)) && !bad.test(label(x)));
  if (b) return b;

  // 3) Nếu không thấy: chọn nút gần ô prompt nhất, BỎ QUA các nút sai
  if (input) {
    const ir = input.getBoundingClientRect();
    const near = buttons
      .filter((x) => !bad.test(label(x)))
      .map((x) => {
        const r = x.getBoundingClientRect();
        const dx = r.left - ir.right;
        const dy = r.top - ir.top;
        return { x, d: Math.hypot(dx, dy) };
      })
      .filter((o) => o.d < 600)
      .sort((a, b) => a.d - b.d);
    if (near[0]) return near[0].x;
  }
  return null;
}

function pressEnter(el) {
  el.focus();
  for (const type of ["keydown", "keypress", "keyup"]) {
    const ev = new KeyboardEvent(type, {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true, // vượt qua shadow DOM nếu có
    });
    // FIX QUAN TRỌNG: KeyboardEvent thường để keyCode = 0, khiến Flow không
    // nhận ra phím Enter. Ghi đè lại thành 13 để giống Enter thật.
    Object.defineProperty(ev, "keyCode", { get: () => 13 });
    Object.defineProperty(ev, "which", { get: () => 13 });
    el.dispatchEvent(ev);
  }
}

function clickFully(el) {
  const r = el.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
  };
  try {
    el.dispatchEvent(new PointerEvent("pointerdown", base));
    el.dispatchEvent(new MouseEvent("mousedown", base));
    el.dispatchEvent(new PointerEvent("pointerup", base));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    el.dispatchEvent(new MouseEvent("click", base));
  } catch (_) {}
  el.click?.();
}

// Gửi prompt CHẮC CHẮN: click nút gửi vừa được mở khoá + Enter, rồi
// xác nhận đã gửi bằng cách kiểm tra ô prompt đã trống chưa. Thử lại vài lần.
async function submitPromptReliably(input, disabledBefore) {
  const arrow = findGenerateButton(input);
  console.log(
    "[Han2YT] Nút gửi:",
    arrow
      ? arrow.getAttribute("aria-label") ||
          arrow.textContent.trim().slice(0, 15) ||
          arrow.tagName
      : "KHÔNG THẤY"
  );

  for (let i = 0; i < 10; i++) {
    if (STOP) return false;

    // 1) Ưu tiên Enter thật (giống đúng lúc bạn tự bấm Enter -> sinh được ảnh)
    input.focus?.();
    pressEnter(input);
    
    // Đợi tối đa 1.5 giây (15 * 100ms) để ô prompt trống
    for (let w = 0; w < 15; w++) {
      await sleep(100);
      if (inputText(input).trim().length < 3) {
        console.log("[Han2YT] ✓ Gửi bằng ENTER (lần", i + 1, ")");
        return true;
      }
    }

    // 2) Enter chưa ăn -> thử click nút mũi tên
    if (arrow) {
      clickFully(arrow);
      // Đợi tối đa 1.5 giây (15 * 100ms) để ô prompt trống
      for (let w = 0; w < 15; w++) {
        await sleep(100);
        if (inputText(input).trim().length < 3) {
          console.log("[Han2YT] ✓ Gửi bằng CLICK nút (lần", i + 1, ")");
          return true;
        }
      }
    }
  }
  return false;
}

// ---------- 4. Lấy danh sách ảnh đã hoàn thành ----------
function getCompletedImages() {
  return [...document.querySelectorAll("img")].filter((img) => {
    if (!isVisible(img)) return false;
    const src = srcKey(img);
    if (!/^https?:|^blob:|^data:/.test(src)) return false;
    // bỏ qua icon/avatar nhỏ
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < CONFIG.minImageSize && h < CONFIG.minImageSize) return false;
    return true;
  });
}

// ---------- 4b. Lấy danh sách video đã hoàn thành ----------
function videoSrcKey(v) {
  // Check <source> children first, then src attribute
  const source = v.querySelector("source");
  return source?.src || v.currentSrc || v.src || "";
}

function getCompletedVideos() {
  const allVideos = [...document.querySelectorAll("video")];
  if (allVideos.length) {
    console.log("[Han2YT] All <video> on page:", allVideos.length, allVideos.map(v => ({
      src: videoSrcKey(v).slice(0, 60),
      visible: isVisible(v),
      videoWidth: v.videoWidth,
      offsetWidth: v.offsetWidth,
      readyState: v.readyState,
    })));
  }
  return allVideos.filter((vid) => {
    const src = videoSrcKey(vid);
    if (!src || src === "") return false;
    if (!/^https?:|^blob:|^data:/.test(src)) return false;
    // Skip size check — video might not have metadata loaded yet
    // Just check it's not a tiny thumbnail by offset size
    const w = vid.offsetWidth || vid.clientWidth || vid.videoWidth;
    const h = vid.offsetHeight || vid.clientHeight || vid.videoHeight;
    if (w > 0 && h > 0 && w < 100 && h < 100) return false;
    return true;
  });
}

// ---------- 5. Detect policy violation / error messages ----------
function detectPolicyViolation() {
  const texts = document.body.innerText || "";
  // Google Flow shows these when it blocks generation
  const patterns = [
    /violate\s+(our\s+)?polic/i,
    /policy\s+violation/i,
    /cannot\s+generate/i,
    /unable\s+to\s+generate/i,
    /content\s+policy/i,
    /try\s+a\s+different\s+prompt/i,
    /could\s+not\s+complete/i,
    /something\s+went\s+wrong/i,
  ];
  for (const p of patterns) {
    if (p.test(texts)) {
      // Check if the text appeared recently (visible in viewport)
      const allEls = document.querySelectorAll("*");
      for (const el of allEls) {
        if (el.children.length === 0 && p.test(el.textContent || "") && isVisible(el)) {
          return el.textContent.trim().slice(0, 120);
        }
      }
    }
  }
  return null;
}

// ---------- 5b. Canh tới khi có ảnh MỚI xuất hiện ----------
async function waitForNewImage(baselineSet) {
  const start = Date.now();
  console.log("[Han2YT] Waiting for new image... (baseline:", baselineSet.size, ")");
  let lastLog = 0;
  let policyCheckCount = 0;
  while (Date.now() - start < CONFIG.maxWaitMs) {
    if (STOP) return { stopped: true };
    const all = getCompletedImages();
    const fresh = all.filter((i) => !baselineSet.has(srcKey(i)));
    if (fresh.length) {
      await sleep(CONFIG.settleMs);
      const newest = fresh[0];
      console.log("[Han2YT] New image found:", srcKey(newest).slice(0, 70));
      return { img: newest, src: srcKey(newest) };
    }

    // Check for policy violation every few polls (not every cycle for perf)
    policyCheckCount++;
    if (policyCheckCount % 3 === 0) {
      const violation = detectPolicyViolation();
      if (violation) {
        console.warn("[Han2YT] Policy violation detected:", violation);
        return { policyViolation: true, message: violation };
      }
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed - lastLog >= 10) {
      lastLog = elapsed;
      console.log("[Han2YT] ...still waiting —", elapsed, "s elapsed. Images >=256px:", all.length);
    }
    await sleep(CONFIG.pollMs);
  }
  return { timeout: true };
}

// ---------- 5c. Canh tới khi có VIDEO MỚI xuất hiện ----------
async function waitForNewVideo(baselineSet) {
  const start = Date.now();
  const maxWait = CONFIG.maxWaitMsVideo;
  console.log("[Han2YT] Waiting for new video... (baseline:", baselineSet.size, ")");
  let lastLog = 0;
  let policyCheckCount = 0;
  while (Date.now() - start < maxWait) {
    if (STOP) return { stopped: true };

    // Only look for <video> elements — ignore images entirely in video mode
    const allVideos = getCompletedVideos();
    const freshVideos = allVideos.filter((v) => !baselineSet.has(videoSrcKey(v)));
    if (freshVideos.length) {
      // Wait for video to fully load
      const newest = freshVideos[0];
      console.log("[Han2YT] New video detected, waiting for it to load...", videoSrcKey(newest).slice(0, 70));
      // Wait until readyState >= HAVE_CURRENT_DATA (2) or timeout after 15s
      const loadStart = Date.now();
      while (newest.readyState < 2 && Date.now() - loadStart < 15000) {
        await sleep(500);
      }
      await sleep(CONFIG.settleMsVideo);
      const src = videoSrcKey(newest);
      console.log("[Han2YT] New video ready:", src.slice(0, 70), "readyState:", newest.readyState);
      return { video: newest, src };
    }

    policyCheckCount++;
    if (policyCheckCount % 3 === 0) {
      const violation = detectPolicyViolation();
      if (violation) {
        console.warn("[Han2YT] Policy violation detected:", violation);
        return { policyViolation: true, message: violation };
      }
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed - lastLog >= 10) {
      lastLog = elapsed;
      const allVids = document.querySelectorAll("video");
      console.log("[Han2YT] ...still waiting for video —", elapsed, "s elapsed. <video> on page:", allVids.length,
        "Qualified:", allVideos.length,
        allVids.length ? [...allVids].map(v => ({ src: videoSrcKey(v).slice(0, 40), ready: v.readyState, w: v.videoWidth })) : "");
    }
    await sleep(CONFIG.pollMs);
  }
  return { timeout: true };
}

// ---------- 7b. Đổi video sang dataURL ----------
async function videoToDataUrl(url) {
  // Method 1: fetch + FileReader
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch (fetchErr) {
    console.warn("[Han2YT] fetch failed for video", url.slice(0, 60), ":", fetchErr.message);
  }
  throw new Error("Cannot convert video to data URL (CORS blocked)");
}

// ---------- 6. Chạy 1 prompt trọn vẹn ----------
async function runOne(prompt) {
  // đánh thức + tìm ô prompt (Slate mount khi được click)
  let input = await wakePromptBox();
  if (!input) {
    console.warn(
      "[Han2YT] ❌ KHÔNG tìm thấy ô prompt. Đếm phần tử trong DOM →",
      "slate:", document.querySelectorAll('[data-slate-editor="true"]').length,
      "| textbox:", document.querySelectorAll('[role="textbox"]').length,
      "| contenteditable:", document.querySelectorAll('[contenteditable="true"]').length,
      "| textarea:", document.querySelectorAll("textarea").length
    );
    return { ok: false, error: "Không tìm thấy ô prompt." };
  }
  console.log("[Han2YT] ✓ Ô prompt:", input.tagName, input.getAttribute("role"));

  const baseline = new Set(getCompletedImages().map(srcKey));
  const disabledBefore = new Set(
    [...document.querySelectorAll('button, [role="button"]')].filter((b) =>
      isBtnDisabled(b)
    )
  );

  // đảm bảo focus trước khi gõ
  clickFully(input);
  input.focus?.();
  await sleep(150);

  // gõ prompt
  setPromptText(input, prompt);
  await sleep(700);

  const got = inputText(input).trim();
  console.log("[Han2YT] Sau khi gõ, nội dung ô =", JSON.stringify(got.slice(0, 50)), "(", got.length, "ký tự )");
  if (got.length < 3) {
    console.warn("[Han2YT] ❌ Gõ chữ KHÔNG vào được ô (Slate không nhận).");
    return { ok: false, error: "Gõ chữ không vào được ô prompt (Slate)." };
  }

  // gửi + xác nhận đã gửi
  const sent = await submitPromptReliably(input, disabledBefore);
  if (STOP) return { ok: false, stopped: true };
  if (!sent) {
    console.warn("[Han2YT] ❌ Gõ được nhưng KHÔNG gửi được.");
    return {
      ok: false,
      error: "Đã gõ prompt nhưng KHÔNG gửi được (nút gửi không phản hồi).",
    };
  }

  // chờ ảnh mới
  const res = await waitForNewImage(baseline);
  if (res.stopped) return { ok: false, stopped: true };
  if (res.timeout) return { ok: false, timeout: true };
  return { ok: true, src: res.src };
}

// ---------- 7. Đổi ảnh sang dataURL (dùng cho blob:) ----------
async function toDataUrl(url) {
  // If already a data URL, return as-is
  if (/^data:/.test(url)) return url;

  // Method 1: fetch + FileReader (works for same-origin and CORS-allowed)
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch (fetchErr) {
    console.warn("[Han2YT] fetch failed for", url.slice(0, 60), "- trying canvas fallback:", fetchErr.message);
  }

  // Method 2: draw to canvas (works for images already loaded in DOM)
  const img = [...document.querySelectorAll("img")].find(
    (el) => (el.currentSrc || el.src) === url && el.naturalWidth > 0
  );
  if (img) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch (canvasErr) {
      console.warn("[Han2YT] canvas fallback failed:", canvasErr.message);
    }
  }

  throw new Error("Cannot convert image to data URL (CORS blocked)");
}

// ---------- 8. Nhận lệnh từ side panel ----------
// Chống đăng ký listener 2 lần (khi vừa tiêm khai báo vừa tiêm tay)
if (!window.__HAN2YT_LISTENER__) {
  window.__HAN2YT_LISTENER__ = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "PING") {
      let hasInput = false;
      try {
        hasInput = !!findPromptInput();
      } catch (_) {}
      sendResponse({ ok: true, hasInput });
      return; // đồng bộ
    }

    if (msg.type === "STOP") {
      STOP = true;
      sendResponse({ ok: true });
      return;
    }

    // Trả về toạ độ tâm ô prompt (để background click + gõ qua debugger),
    // đồng thời chụp baseline ảnh hiện có để lát so sánh.
    if (msg.type === "GET_BOX") {
      STOP = false;
      const mediaType = msg.mediaType || "image"; // "image" or "video"
      (async () => {
        try {
          const input = await wakePromptBox();
          if (!input) {
            sendResponse({ ok: false, error: "Không tìm thấy ô prompt." });
            return;
          }
          const r = input.getBoundingClientRect();
          // Snapshot baseline for both image and video
          window.__Han2YT_flow_baseline = new Set(getCompletedImages().map(srcKey));
          window.__Han2YT_flow_baseline_video = new Set(getCompletedVideos().map(videoSrcKey));
          window.__Han2YT_flow_mediaType = mediaType;
          sendResponse({
            ok: true,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
          });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }

    // Chờ ảnh mới (so với baseline đã chụp ở GET_BOX) rồi trả src
    if (msg.type === "WAIT_IMAGE") {
      const baseline = window.__Han2YT_flow_baseline || new Set();
      waitForNewImage(baseline).then((res) => {
        if (res.stopped) sendResponse({ ok: false, stopped: true });
        else if (res.policyViolation) sendResponse({ ok: false, policyViolation: true, message: res.message });
        else if (res.timeout) sendResponse({ ok: false, timeout: true });
        else sendResponse({ ok: true, src: res.src });
      });
      return true;
    }

    // Chờ video mới
    if (msg.type === "WAIT_VIDEO") {
      const baseline = window.__Han2YT_flow_baseline_video || new Set();
      waitForNewVideo(baseline).then((res) => {
        if (res.stopped) sendResponse({ ok: false, stopped: true });
        else if (res.policyViolation) sendResponse({ ok: false, policyViolation: true, message: res.message });
        else if (res.timeout) sendResponse({ ok: false, timeout: true });
        else sendResponse({ ok: true, src: res.src, mediaType: "video" });
      });
      return true;
    }

    // Chờ media (tự nhận diện image hoặc video tuỳ theo GET_BOX)
    if (msg.type === "WAIT_MEDIA") {
      const mediaType = window.__Han2YT_flow_mediaType || "image";
      if (mediaType === "video") {
        const baseline = window.__Han2YT_flow_baseline_video || new Set();
        waitForNewVideo(baseline).then((res) => {
          if (res.stopped) sendResponse({ ok: false, stopped: true });
          else if (res.policyViolation) sendResponse({ ok: false, policyViolation: true, message: res.message });
          else if (res.timeout) sendResponse({ ok: false, timeout: true });
          else sendResponse({ ok: true, src: res.src, mediaType: "video" });
        });
      } else {
        const baseline = window.__Han2YT_flow_baseline || new Set();
        waitForNewImage(baseline).then((res) => {
          if (res.stopped) sendResponse({ ok: false, stopped: true });
          else if (res.policyViolation) sendResponse({ ok: false, policyViolation: true, message: res.message });
          else if (res.timeout) sendResponse({ ok: false, timeout: true });
          else sendResponse({ ok: true, src: res.src, mediaType: "image" });
        });
      }
      return true;
    }

    if (msg.type === "TODATAURL") {
      toDataUrl(msg.src)
        .then((d) => sendResponse({ dataUrl: d }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true;
    }

    if (msg.type === "TODATAURL_VIDEO") {
      videoToDataUrl(msg.src)
        .then((d) => sendResponse({ dataUrl: d }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true;
    }
  });

  console.log("[Han2YT] content script đã sẵn sàng trên Google Flow.");
}
