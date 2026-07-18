// ============================================================
//  content_grok.js — Content script for Grok image generation
//  Injected into grok.com. Finds prompt input, detects generated
//  images, and communicates with sidepanel/background.
// ============================================================

const CONFIG_GROK = {
  promptSelector: "",
  minImageSize: 200,
  pollMs: 2000,
  maxWaitMs: 300000,   // 5 min
  settleMs: 3000,
};

let STOP = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
}

function srcKey(img) {
  return img.currentSrc || img.src || "";
}

// ---------- Find prompt input ----------
function findPromptInput() {
  if (CONFIG_GROK.promptSelector) {
    const e = document.querySelector(CONFIG_GROK.promptSelector);
    if (e) return e;
  }
  // Grok uses a textarea or contenteditable
  const selectors = [
    'textarea[placeholder]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    "textarea",
  ];
  for (const sel of selectors) {
    const all = [...document.querySelectorAll(sel)].filter(isVisible);
    if (all.length) {
      // Prefer the one with prompt-like placeholder
      const hint = /ask|message|prompt|type|chat/i;
      const byText = all.find((e) =>
        hint.test((e.getAttribute("placeholder") || "") + (e.getAttribute("aria-label") || ""))
      );
      if (byText) return byText;
      return all[0];
    }
  }
  return null;
}

// ---------- Find send button ----------
function findSendButton() {
  const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(isVisible);
  // Look for send/submit button
  const label = (b) =>
    ((b.getAttribute("aria-label") || "") + " " + (b.title || "") + " " + b.textContent).toLowerCase();
  const wanted = /send|submit|arrow|generate/i;
  let btn = buttons.find((b) => wanted.test(label(b)));
  if (btn) return btn;
  // Fallback: button closest to input
  const input = findPromptInput();
  if (input) {
    const ir = input.getBoundingClientRect();
    const near = buttons
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { b, d: Math.hypot(r.left - ir.right, r.top - ir.top) };
      })
      .filter((o) => o.d < 200)
      .sort((a, b) => a.d - b.d);
    if (near.length) return near[0].b;
  }
  return null;
}

// ---------- Check if response is still streaming ----------
function isStreaming() {
  // Grok shows a stop/cancel button while generating
  const buttons = [...document.querySelectorAll("button")];
  return buttons.some(
    (b) =>
      isVisible(b) &&
      /stop|cancel/i.test((b.getAttribute("aria-label") || "") + " " + b.textContent)
  );
}

// ---------- Get completed images ----------
function getCompletedImages() {
  return [...document.querySelectorAll("img")].filter((img) => {
    if (!isVisible(img)) return false;
    const src = srcKey(img);
    if (!/^https?:|^blob:|^data:/.test(src)) return false;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < CONFIG_GROK.minImageSize && h < CONFIG_GROK.minImageSize) return false;
    // Skip avatars/icons
    if (/avatar|profile|icon|logo|favicon/i.test(img.className + " " + (img.alt || ""))) return false;
    return true;
  });
}

// ---------- Wait for new image ----------
async function waitForNewImage(baselineSet) {
  const start = Date.now();
  console.log("[Han2YT-Grok] Waiting for new image... (baseline:", baselineSet.size, ")");
  let lastLog = 0;
  while (Date.now() - start < CONFIG_GROK.maxWaitMs) {
    if (STOP) return { stopped: true };

    // Wait for streaming to finish
    if (!isStreaming()) {
      const all = getCompletedImages();
      const fresh = all.filter((i) => !baselineSet.has(srcKey(i)));
      if (fresh.length) {
        await sleep(CONFIG_GROK.settleMs);
        const newest = fresh[fresh.length - 1];
        console.log("[Han2YT-Grok] New image found:", srcKey(newest).slice(0, 70));
        return { img: newest, src: srcKey(newest) };
      }
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed - lastLog >= 10) {
      lastLog = elapsed;
      console.log("[Han2YT-Grok] ...still waiting —", elapsed, "s elapsed, streaming:", isStreaming());
    }
    await sleep(CONFIG_GROK.pollMs);
  }
  return { timeout: true };
}

// ---------- Convert image to data URL ----------
async function toDataUrl(url) {
  // Strategy 1: fetch directly
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
    console.warn("[Han2YT-Grok] fetch cors failed:", fetchErr.message);
  }

  // Strategy 2: fetch no-cors (opaque but might work for blobs)
  try {
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        return await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
      }
    }
  } catch (_) {}

  // Strategy 3: canvas drawImage from DOM element
  const img = [...document.querySelectorAll("img")].find(
    (el) => (el.currentSrc || el.src) === url && el.naturalWidth > 0
  );
  if (img) {
    try {
      img.crossOrigin = "anonymous";
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch (canvasErr) {
      console.warn("[Han2YT-Grok] canvas failed:", canvasErr.message);
    }
  }

  // Strategy 4: reload image with crossOrigin=anonymous, then canvas
  if (/^https?:/.test(url)) {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const tmpImg = new Image();
        tmpImg.crossOrigin = "anonymous";
        tmpImg.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = tmpImg.naturalWidth;
            canvas.height = tmpImg.naturalHeight;
            canvas.getContext("2d").drawImage(tmpImg, 0, 0);
            resolve(canvas.toDataURL("image/png"));
          } catch (e) { reject(e); }
        };
        tmpImg.onerror = () => reject(new Error("Image load failed"));
        tmpImg.src = url;
      });
      return dataUrl;
    } catch (reloadErr) {
      console.warn("[Han2YT-Grok] reload+canvas failed:", reloadErr.message);
    }
  }

  throw new Error("Cannot convert image to data URL");
}

// ---------- Message listener ----------
if (!window.__HAN2YT_GROK_LISTENER__) {
  window.__HAN2YT_GROK_LISTENER__ = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "PING") {
      sendResponse({ ok: true, hasInput: !!findPromptInput(), provider: "grok" });
      return;
    }

    if (msg.type === "STOP") {
      STOP = true;
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "GET_BOX") {
      STOP = false;
      (async () => {
        try {
          const input = findPromptInput();
          if (!input) {
            sendResponse({ ok: false, error: "Khong tim thay o prompt Grok." });
            return;
          }
          const r = input.getBoundingClientRect();
          window.__Han2YT_flow_baseline = new Set(getCompletedImages().map(srcKey));
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

    if (msg.type === "TYPE_AND_SUBMIT") {
      (async () => {
        try {
          const input = findPromptInput();
          if (!input) {
            sendResponse({ ok: false, error: "Cannot find Grok prompt input" });
            return;
          }
          input.focus();
          await sleep(100);

          if (input.tagName === "TEXTAREA") {
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
            nativeSetter.call(input, msg.prompt);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            // contenteditable
            document.execCommand("selectAll", false, null);
            await sleep(50);
            document.execCommand("insertText", false, msg.prompt);
          }
          await sleep(300);

          // Click send button
          const btn = findSendButton();
          if (btn) {
            btn.click();
            sendResponse({ ok: true });
          } else {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
            sendResponse({ ok: true });
          }
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }

    if (msg.type === "WAIT_IMAGE") {
      const baseline = window.__Han2YT_flow_baseline || new Set();
      waitForNewImage(baseline).then((res) => {
        if (res.stopped) sendResponse({ ok: false, stopped: true });
        else if (res.timeout) sendResponse({ ok: false, timeout: true });
        else sendResponse({ ok: true, src: res.src });
      });
      return true;
    }

    if (msg.type === "TODATAURL") {
      console.log("[Han2YT-Grok] TODATAURL request:", msg.src?.slice(0, 80));
      toDataUrl(msg.src)
        .then((d) => {
          console.log("[Han2YT-Grok] TODATAURL success, size:", Math.round(d.length / 1024), "KB");
          sendResponse({ dataUrl: d });
        })
        .catch((e) => {
          console.error("[Han2YT-Grok] TODATAURL failed:", e.message);
          sendResponse({ error: String(e) });
        });
      return true;
    }
  });

  console.log("[Han2YT] content_grok.js ready on Grok.");
}
