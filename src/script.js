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

  // In-page navigation: a link click or form submit that stays on the site is not "leaving".
  // Edit-type URLs (and, optionally, other sites) open in a new tab so the locked page stays put.
  const navigationIntentMillis = 1500;
  const defaultNewTabRules = ["/wp-admin/post\\.php", "/wp-admin/post-new\\.php", "[?&]action=edit"];
  let allowInPageNavigation = true;
  let externalLinksInNewTab = true;
  let newTabPatterns = compileRules(defaultNewTabRules);
  let navigationIntentUntil = 0;

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
        // Older callers don't send these: keep the defaults above in that case.
        if (request.data.allowInPageNavigation !== undefined) {
          allowInPageNavigation = !!request.data.allowInPageNavigation;
        }
        if (request.data.externalLinksInNewTab !== undefined) {
          externalLinksInNewTab = !!request.data.externalLinksInNewTab;
        }
        if (typeof request.data.newTabRules === "string") {
          newTabPatterns = compileRules(request.data.newTabRules.split("\n"));
        }

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

      // A same-site link click or form submit (e.g. a search) is navigation, not an exit.
      if (allowInPageNavigation && Date.now() < navigationIntentUntil) {
        navigationIntentUntil = 0;
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

  function compileRules(lines) {
    return lines
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [new RegExp(line, "i")];
        } catch (e) {
          return []; // ignore an invalid pattern rather than breaking every click
        }
      });
  }

  // "new tab" destinations: a pattern may match the link's destination (full URL, or just
  // path + query) or the page the link is on, so a rule naming a board or editor page makes
  // every link inside it open in a new tab. Plus other sites when enabled.
  function wantsNewTab(url) {
    const targets = [url.href, url.pathname + url.search, location.href];
    if (newTabPatterns.some((re) => targets.some((target) => re.test(target)))) {
      return true;
    }
    return externalLinksInNewTab && url.origin !== location.origin;
  }

  function isWebUrl(url) {
    return url.protocol === "http:" || url.protocol === "https:";
  }

  window.addEventListener(
    "click",
    (event) => {
      if (!isLocked || event.defaultPrevented || event.button !== 0) {
        return;
      }
      // Modified clicks already open a new tab/window in the browser.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download")) {
        return;
      }
      if (anchor.target && anchor.target !== "_self") {
        return; // already opens elsewhere
      }

      let url;
      try {
        url = new URL(anchor.href, location.href);
      } catch (e) {
        return;
      }
      if (!isWebUrl(url)) {
        return;
      }
      // Same document, only the #hash changes: no navigation at all.
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) {
        return;
      }

      if (wantsNewTab(url)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.open(url.href, "_blank", "noopener");
        return;
      }
      if (url.origin === location.origin) {
        navigationIntentUntil = Date.now() + navigationIntentMillis;
      }
    },
    true
  );

  window.addEventListener(
    "submit",
    (event) => {
      if (!isLocked || event.defaultPrevented || !(event.target instanceof HTMLFormElement)) {
        return;
      }
      const form = event.target;
      let url;
      try {
        url = new URL(form.getAttribute("action") ? form.action : location.href, location.href);
      } catch (e) {
        return;
      }
      if (!isWebUrl(url)) {
        return;
      }

      // For a GET form the destination includes the query the form will add.
      const probe = form.method && form.method.toLowerCase() === "get" ? new URL(url.href) : url;
      if (probe !== url) {
        new FormData(form).forEach((value, key) => {
          if (typeof value === "string") probe.searchParams.append(key, value);
        });
      }

      if (wantsNewTab(probe)) {
        // Submit into a new tab (works for POST too), then restore the form.
        const previousTarget = form.target;
        form.target = "_blank";
        setTimeout(() => {
          form.target = previousTarget;
        }, 0);
        return;
      }
      if (url.origin === location.origin) {
        navigationIntentUntil = Date.now() + navigationIntentMillis;
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
