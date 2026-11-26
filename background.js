const BLINK_API = "https://core.blink.new/api";
const BLINK_KEY = "blnk_pk_vfRDduQdwnIgNQHiNu4e9h-32fbkJyj-";
const DEFAULT_RULES = [
  { pattern: "*://*.googleusercontent.com/*=s*-c", type: "image", custom: false },
  { pattern: "*://*.gravatar.com/avatar/*", type: "image", custom: false },
  { pattern: "*://avatars.githubusercontent.com/*", type: "image", custom: false },
  { pattern: "*://cdn.discordapp.com/avatars/*", type: "image", custom: false },
  { pattern: "*://*.fbcdn.net/*", type: "image", custom: false }
];

function globToRegex(pattern) {
  return "^" + pattern.replace(/[.+?^{}$()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
}

function isVolatileSegment(segment) {
  return /^(?:v?\d{4,}|[a-f0-9]{12,}|[a-f0-9]{8}-[a-f0-9-]{20,}|[a-z0-9_-]{6,})$/i.test(segment) &&
    (/\d/.test(segment) || /^[a-f0-9]{12,}$/i.test(segment));
}

function makeSmartPattern(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
  if (!segments.length) return "*://" + host + "/*";

  const specific = /^(profile|avatar|avatars|photo|photos|picture|pictures)(?:[-_.]|$)/i;
  let index = segments.findIndex(segment => specific.test(segment));
  let token = index >= 0 ? segments[index].match(/^(profile|avatars?|photos?|pictures?)/i)[0] : "";
  if (index < 0) {
    const mediaRoute = /^(image|images|media|upload|uploads|video|videos|clip|clips|reel|reels|stream|attachment|attachments)(?:[-_.]|$)/i;
    index = segments.findIndex(segment => mediaRoute.test(segment));
    if (index >= 0) token = segments[index].match(/^(images?|media|uploads?|videos?|clips?|reels?|stream|attachments?)/i)[0];
  }

  if (index >= 0) {
    let prefix = segments.slice(0, index);
    while (prefix.length && isVolatileSegment(prefix[prefix.length - 1])) prefix.pop();
    const route = prefix.length ? prefix.join("/") + "/" : "";
    if (!route) return "*://" + host + "/" + token + "/*";
    return "*://" + host + "/" + route + "*" + token + "*";
  }

  const filename = segments[segments.length - 1];
  const extension = filename.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  let folders = segments.slice(0, -1);
  while (folders.length && isVolatileSegment(folders[folders.length - 1])) folders.pop();
  const folderPath = folders.length ? folders.join("/") + "/" : "";
  if (extension) return "*://" + host + "/" + folderPath + "*." + extension;
  return "*://" + host + "/" + folderPath + "*";
}

async function applyRules(rules = DEFAULT_RULES, enabled = true) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.filter(rule => rule.id >= 1000 && rule.id < 6000).map(rule => rule.id);
  const normalized = rules.map(rule => ({ ...rule, type: rule.type === "video" ? "video" : "image" }));
  const addRules = enabled ? normalized.slice(0, 1000).map((rule, index) => ({
    id: 1000 + index,
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter: globToRegex(rule.pattern),
      resourceTypes: [rule.type === "video" ? "media" : "image"],
      isUrlFilterCaseSensitive: false
    }
  })) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function syncStoredRules() {
  const data = await chrome.storage.local.get({ loweryRules: DEFAULT_RULES, loweryEnabled: true });
  await applyRules(Array.isArray(data.loweryRules) ? data.loweryRules : DEFAULT_RULES, data.loweryEnabled !== false);
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "lowery-add-image-pattern", title: "Block matching images with Lowery", contexts: ["image"] });
    chrome.contextMenus.create({ id: "lowery-add-video-pattern", title: "Block matching videos with Lowery", contexts: ["video"] });
  });
  await syncStoredRules().catch(error => console.warn("[Lowery] Could not initialize rules:", error));
});

chrome.runtime.onStartup.addListener(() => {
  syncStoredRules().catch(error => console.warn("[Lowery] Could not restore rules:", error));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.loweryRules || changes.loweryEnabled)) {
    syncStoredRules().catch(error => console.warn("[Lowery] Could not update blocking rules:", error));
  }
});

chrome.contextMenus.onClicked.addListener(async info => {
  const type = info.menuItemId === "lowery-add-video-pattern" ? "video" :
    info.menuItemId === "lowery-add-image-pattern" ? "image" : null;
  if (!type || !info.srcUrl) return;
  try {
    const pattern = makeSmartPattern(info.srcUrl);
    const { loweryRules = DEFAULT_RULES } = await chrome.storage.local.get({ loweryRules: DEFAULT_RULES });
    const normalized = loweryRules.map(rule => ({ ...rule, type: rule.type === "video" ? "video" : "image" }));
    if (!normalized.some(rule => rule.pattern === pattern && rule.type === type)) {
      await chrome.storage.local.set({ loweryRules: [...normalized, { pattern, type, custom: true }] });
    }
  } catch (error) {
    console.warn("[Lowery] Could not add smart URL rule:", error);
  }
});

function blinkRequestPath(path) {
  return BLINK_API + "/" + String(path).replace(/^https?:\/\/[^/]+\/api\//, "").replace(/^\/?(api\/)?/, "");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LOWERY_SET_ENABLED") {
    (async () => {
      await chrome.storage.local.set({ loweryEnabled: message.enabled !== false });
      await syncStoredRules();
      sendResponse({ ok: true });
    })().catch(error => {
      console.warn("[Lowery] Could not change blocking state:", error);
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }
  if (message?.type !== "BLINK_API") return;
  const { path, method = "GET", body } = message;
  fetch(blinkRequestPath(path), {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-blink-publishable-key": BLINK_KEY,
      ...(method === "POST" || method === "PATCH" ? { Prefer: "return=representation" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async response => {
    const responseText = await response.text();
    let data = responseText;
    try { data = JSON.parse(responseText); } catch {}
    sendResponse({ ok: response.ok, status: response.status, data });
  }).catch(error => {
    console.error("[background] BLINK_API request failed:", error);
    sendResponse({ ok: false, status: 0, data: String(error) });
  });
  return true;
});
