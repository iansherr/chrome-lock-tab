(function () {
  const titlePrefix = "🔒\u200E ";
  const minLoadTimeMillis = 500;
  const formBypassMillis = 2000;

  let loadedTime = Date.now();
  let isLocked = false;
  let openLinksInNewTab = false;
  let allowFormSubmit = false;
  let formBypassUntil = 0;
  let titleObserver = null;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.message) {
      case "setIsLocked":
        isLocked = request.data.isLocked;
        openLinksInNewTab = !!request.data.openLinksInNewTab;
        allowFormSubmit = !!request.data.allowFormSubmit;

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

      // Form submissions (e.g. WordPress/search boxes) intentionally navigate
      // the tab. When allowed, let them through without confirmation while
      // keeping the tab locked.
      if (allowFormSubmit && Date.now() < formBypassUntil) {
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

  // Arm a short bypass so an opted-in form submission (search, filters, login)
  // can navigate the locked tab without triggering the exit confirmation.
  // The tab stays locked after navigation.
  document.addEventListener(
    "submit",
    () => {
      if (!isLocked || !allowFormSubmit) {
        return;
      }

      formBypassUntil = Date.now() + formBypassMillis;
    },
    true
  );

  // When opted in, keep the locked tab in place by opening plain left-click
  // link navigations in a new tab instead of navigating (and confirming on)
  // the locked tab. Modifier/middle clicks, new-tab targets, downloads, and
  // non-web URLs keep their default behavior.
  document.addEventListener(
    "click",
    (event) => {
      if (!isLocked || !openLinksInNewTab) {
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      if (event.button !== 0) {
        return;
      }

      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
      }

      let target = event.target;
      let anchor = target instanceof Element ? target.closest("a[href]") : null;
      if (!anchor) {
        return;
      }

      if (!shouldDivertLink(anchor)) {
        return;
      }

      event.preventDefault();
      window.open(anchor.href, "_blank", "noopener");
    },
    false
  );

  function shouldDivertLink(anchor) {
    let protocol = (anchor.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return false;
    }

    if (anchor.hasAttribute("download")) {
      return false;
    }

    let target = (anchor.getAttribute("target") || "").toLowerCase().trim();
    if (target === "_blank") {
      return false;
    }
    if (target !== "" && target !== "_self" && target !== "_top" && target !== "_parent") {
      return false;
    }

    try {
      let current = new URL(window.location.href);
      let next = new URL(anchor.href, window.location.href);
      current.hash = "";
      next.hash = "";
      if (current.href === next.href) {
        return false;
      }
    } catch (e) {
      return false;
    }

    return true;
  }

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
