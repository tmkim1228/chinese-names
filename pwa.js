if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).then((reg) => {
    function promptUpdate() {
      if (!reg.waiting) return;
      let b = document.getElementById("update-app");
      if (b) return;
      b = document.createElement("button");
      b.id = "update-app";
      b.className = "primary";
      b.textContent = "새 버전이 있어요 → 새로고침";
      b.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:100";
      b.onclick = () => reg.waiting.postMessage({ type: "SKIP_WAITING" });
      document.body.append(b);
    }
    promptUpdate();
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) promptUpdate();
      });
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  }).catch(console.error);

  function prefetchWords() {
    fetch("data/words.json.gz", { credentials: "same-origin" }).catch(() => {
      fetch("data/words.json", { credentials: "same-origin" }).catch(() => {});
    });
  }
  const startPrefetch = () => setTimeout(prefetchWords, 4000);
  if (document.readyState === "complete") startPrefetch();
  else window.addEventListener("load", startPrefetch);
}
