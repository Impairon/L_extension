const BLINK_API = "https://core.blink.new/api";
const BLINK_KEY = "blnk_pk_vfRDduQdwnIgNQHiNu4e9h-32fbkJyj-";
const DEFAULT_RULES = [
  { pattern: "*://*.googleusercontent.com/*=s*-c", custom: false },
  { pattern: "*://*.gravatar.com/avatar/*", custom: false },
  { pattern: "*://avatars.githubusercontent.com/*", custom: false },
  { pattern: "*://cdn.discordapp.com/avatars/*", custom: false },
  { pattern: "*://*.fbcdn.net/*", custom: false }
];

function wildcardRegex(pattern) {
  return "^" + pattern.replace(/[.+?^{}$()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
}

async function applyRules(rules = DEFAULT_RULES, enabled = true) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.filter(rule => rule.id >= 1000 && rule.id < 6000).map(rule => rule.id);
  const addRules = enabled ? rules.slice(0, 1000).map((rule, index) => ({
    id: 1000 + index,
    priority: 1,
    action: { type: "block" },
    condition: { regexFilter: wildcardRegex(rule.pattern), resourceTypes: ["image"] }
  })) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function syncStoredRules() {
  const data = await chrome.storage.local.get({ loweryRules: DEFAULT_RULES, loweryEnabled: true });
  await applyRules(Array.isArray(data.loweryRules) ? data.loweryRules : DEFAULT_RULES, data.loweryEnabled !== false);
}

function makeSmartPattern(rawUrl) {
  const url = new URL(rawUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const index = segments.findIndex(segment => /profile|avatar|photo|picture/i.test(segment));
  if (index > 0) {
    const prefix = segments.slice(0, index - 1);
    const stablePart = (segments[index].match(/^(profile|avatar|photo|picture)/i) || [segments[index]])[0];
    return "*://" + url.hostname + "/" + (prefix.length ? prefix.join("/") + "/" : "") + "*/" + stablePart + "*";
  }
  const slash = url.pathname.lastIndexOf("/");
  return "*://" + url.hostname + url.pathname.slice(0, slash + 1) + "*";
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: "lowery-add-avatar-pattern",
    title: "Block this avatar URL pattern with Lowery",
    contexts: ["image"]
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
  if (info.menuItemId !== "lowery-add-avatar-pattern" || !info.srcUrl) return;
  try {
    const pattern = makeSmartPattern(info.srcUrl);
    const { loweryRules = DEFAULT_RULES } = await chrome.storage.local.get({ loweryRules: DEFAULT_RULES });
    if (!loweryRules.some(rule => rule.pattern === pattern)) {
      await chrome.storage.local.set({ loweryRules: [...loweryRules, { pattern, custom: true }] });
    }
  } catch (error) {
    console.warn("[Lowery] Could not add image pattern:", error);
  }
});

function blinkRequestPath(path) {
  return BLINK_API + "/" + String(path).replace(/^https?:\/\/[^/]+\/api\//, "").replace(/^\/?(api\/)?/, "");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    const text = await response.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    sendResponse({ ok: response.ok, status: response.status, data });
  }).catch(error => {
    console.error("[background] BLINK_API request failed:", error);
    sendResponse({ ok: false, status: 0, data: String(error) });
  });
  return true;
});
