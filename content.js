function wildcardRegex(pattern) {
  const escaped = pattern.replace(/[.+?^{}$()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try { return new RegExp("^" + escaped + "$", "i"); } catch { return null; }
}

function restoreImage(img) {
  if (img.dataset.loweryBlocked !== "true") return;
  if (img.dataset.loweryHadSrc === "1") img.setAttribute("src", img.dataset.loweryOriginalSrc || "");
  if (img.dataset.loweryHadSrcset === "1") img.setAttribute("srcset", img.dataset.loweryOriginalSrcset || "");
  img.style.removeProperty("display");
  delete img.dataset.loweryBlocked;
  delete img.dataset.loweryHadSrc;
  delete img.dataset.loweryHadSrcset;
  delete img.dataset.loweryOriginalSrc;
  delete img.dataset.loweryOriginalSrcset;
}

function applyLoweryRules() {
  chrome.storage.local.get({ loweryRules: [], loweryEnabled: true }).then(({ loweryRules, loweryEnabled }) => {
    const rules = Array.isArray(loweryRules) ? loweryRules : [];
    const matchers = rules.map(rule => wildcardRegex(rule.pattern)).filter(Boolean);
    document.querySelectorAll("img").forEach(img => {
      if (loweryEnabled === false) {
        restoreImage(img);
        return;
      }
      if (img.dataset.loweryBlocked === "true") return;
      const url = img.currentSrc || img.src || img.getAttribute("src") || "";
      if (!url || !matchers.some(matcher => matcher.test(url))) return;
      img.dataset.loweryHadSrc = img.hasAttribute("src") ? "1" : "0";
      img.dataset.loweryHadSrcset = img.hasAttribute("srcset") ? "1" : "0";
      img.dataset.loweryOriginalSrc = img.getAttribute("src") || "";
      img.dataset.loweryOriginalSrcset = img.getAttribute("srcset") || "";
      img.dataset.loweryBlocked = "true";
      img.removeAttribute("src");
      img.removeAttribute("srcset");
      img.style.setProperty("display", "none", "important");
    });
  }).catch(error => console.warn("[Lowery] Could not apply URL patterns:", error));
}

applyLoweryRules();
new MutationObserver(applyLoweryRules).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src", "srcset"]
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.loweryRules || changes.loweryEnabled)) applyLoweryRules();
});
