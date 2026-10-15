(function () {
  const titlePrefix = "🔒\u200E ";
  const minLoadTimeMillis = 500;
  const reloadKeyBypassMillis = 2000;

  let loadedTime = Date.now();
  let isLocked = false;
  let allowReload = false;
  let refreshBypassUntil = 0;
  let reloadKeyBypassUntil = 0;
  let titleObserver = null;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.message) {
      case "prepareRefresh":
        // Arm the bypass so the scheduled reload that follows this handshake
        // never triggers the exit confirmation. The tab stays locked.
        refreshBypassUntil = Date.now() + (request.data?.bypassMillis || 5000);
        sendResponse({ ack: true });
        return;
      case "setIsLocked":
        isLocked = request.data.isLocked;
        allowReload = !!request.data.allowReload;

        // Some pages like Google Meet change their title on load, which can result in visual
        // weirdness if we also try to change it too early, so we wait a bit to avoid this.
        if (Date.now() - loadedTime < minLoadTimeMillis) {
          setTimeout(() => {
            setTitle(request.data.showTabIcon);
          }, minLoadTimeMillis);
        } else {
          setTitle(request.data.showTabIcon);
        }

        break;
    }

    sendResponse();
  });

  chrome.runtime.sendMessage({
    message: "init",
    data: {
      colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light",
    },
  });

  window.addEventListener(
    "beforeunload",
    (event) => {
      if (!isLocked) {
        return;
      }

      // Scheduled auto-refresh (background handshake) and opted-in keyboard
      // reloads intentionally reload the tab. Let them through without
      // confirmation while keeping the tab locked.
      if (Date.now() < refreshBypassUntil || Date.now() < reloadKeyBypassUntil) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      event.returnValue = "[LockTab] Are you sure you want to exit?";
      return event.returnValue;
    },
    true
  );

  // Arm a short bypass for opted-in keyboard reloads (F5 / Ctrl+R / Cmd+R)
  // so they don't trigger the exit confirmation. The tab stays locked.
  // Note: programmatic reloads (e.g. timer extensions calling tabs.reload)
  // produce no page-visible signal, so Chrome gives us no way to tell them
  // apart from a tab close. For unattended refresh, use this extension's
  // own auto-refresh menu instead, which handshakes before reloading.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!isLocked || !allowReload) {
        return;
      }

      let isF5 = event.key === "F5" || event.keyCode === 116;
      let isReloadShortcut =
        (event.ctrlKey || event.metaKey) && (event.key === "r" || event.key === "R" || event.keyCode === 82);

      if (isF5 || isReloadShortcut) {
        reloadKeyBypassUntil = Date.now() + reloadKeyBypassMillis;
      }
    },
    true
  );

  function setTitle(showTabIcon) {
    if (isLocked) {
      if (!showTabIcon) {
        return;
      }

      if (!document.title.startsWith(titlePrefix)) {
        document.title = titlePrefix + document.title.replace(titlePrefix, "");
      }

      if (!titleObserver && typeof MutationObserver !== "undefined") {
        let titleElement = document.querySelector("head > title");
        if (titleElement) {
          titleObserver = new MutationObserver((mutations) => {
            if (!document.title.startsWith(titlePrefix)) {
              document.title = titlePrefix + document.title.replace(titlePrefix, "");
            }
          });

          titleObserver.observe(titleElement, {
            subtree: true,
            childList: true,
          });
        }
      }
    } else {
      if (document.title.includes(titlePrefix)) {
        document.title = document.title.replace(titlePrefix, "");
      } else if (document.title.trim() === titlePrefix.trim()) {
        document.title = "";
      }

      if (titleObserver) {
        titleObserver.disconnect();
        titleObserver = null;
      }
    }
  }
})();
