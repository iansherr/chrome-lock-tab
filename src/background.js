chrome.action.onClicked.addListener((tab) => {
  let key = `tab_${tab.id}`;

  chrome.storage.local.get(key, ({ [key]: isLocked }) => {
    chrome.storage.sync.get("options", ({ options = {} }) => {
      setIsLocked(tab, !isLocked, options);
    });
  });
});

chrome.runtime.onMessage.addListener((request, sender) => {
  switch (request.message) {
    case "init":
      init(sender.tab, request.data);

      break;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.pinned) {
    chrome.storage.sync.get("options", ({ options = {} }) => {
      if (options.autoLockPinnedTabs === undefined || options.autoLockPinnedTabs) {
        setIsLocked(tab, true, options);
      }
    });
  }
});

const refreshAlarmPrefix = "refresh_";
const refreshBypassMillis = 5000;
const refreshPresetMinutes = [1, 5, 15, 30, 60];

chrome.runtime.onInstalled.addListener(() => {
  setupRefreshMenu();
});

chrome.runtime.onStartup.addListener(() => {
  setupRefreshMenu();
  // Tab IDs are reassigned across browser restarts, so per-tab intervals
  // cannot reattach. Drop them rather than firing at stale IDs.
  pruneRefreshState();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.menuItemId.startsWith(refreshAlarmPrefix) || !tab?.id) {
    return;
  }

  let minutes = Number(info.menuItemId.slice(refreshAlarmPrefix.length));
  setTabRefresh(tab.id, Number.isInteger(minutes) && minutes > 0 ? minutes : 0);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(refreshAlarmPrefix)) {
    return;
  }

  let tabId = Number(alarm.name.slice(refreshAlarmPrefix.length));
  if (!Number.isInteger(tabId)) {
    return;
  }

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      clearTabRefresh(tabId);
      return;
    }

    // Handshake first: only reload when the tab acknowledges the bypass.
    // A locked tab that cannot be reached is never reloaded, so a refresh
    // can never trigger the exit confirmation.
    chrome.tabs.sendMessage(
      tabId,
      { message: "prepareRefresh", data: { bypassMillis: refreshBypassMillis } },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.ack) {
          return;
        }

        chrome.tabs.reload(tabId);
      }
    );
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabRefresh(tabId, false);
});

let currentColorScheme = "light";

function setIsLocked(tab, isLocked, options = {}) {
  let key = `tab_${tab.id}`;

  chrome.storage.local.set({ [key]: isLocked }, async () => {
    await chrome.tabs.sendMessage(tab.id, {
      message: "setIsLocked",
      data: {
        isLocked: isLocked,
        showTabIcon: options.showTabIcon === undefined ? true : !!options.showTabIcon,
        allowReload: !!options.allowReload,
        openLinksInNewTab: !!options.openLinksInNewTab,
        allowFormSubmit: !!options.allowFormSubmit,
      },
    });

    await chrome.action.setIcon({
      tabId: tab.id,
      path: `/images/${isLocked ? "locked" : "unlocked"}-${currentColorScheme}.png`,
    });

    refreshTabIndicator(tab.id);
  });
}

function init(tab, data) {
  // We will be able to do this declaratively in manifest.json once the following issue gets resolved:
  // https://bugs.chromium.org/p/chromium/issues/detail?id=893175
  if (currentColorScheme !== data.colorScheme) {
    currentColorScheme = data.colorScheme;

    chrome.action.setIcon({
      path: `/images/unlocked-${currentColorScheme}.png`,
    });
  }

  chrome.storage.sync.get("options", ({ options = {} }) => {
    if (tab.pinned && (options.autoLockPinnedTabs === undefined || options.autoLockPinnedTabs)) {
      setIsLocked(tab, true, options);
      return;
    }

    let rulesDisable = parseRules(options.rulesDisable);
    if (rulesDisable.some((rule) => new RegExp(rule, "i").test(tab.url))) {
      return;
    }

    let rulesEnable = parseRules(options.rulesEnable);
    if (rulesEnable.some((rule) => new RegExp(rule, "i").test(tab.url))) {
      setIsLocked(tab, true, options);
    }
  });
}

function parseRules(rules) {
  return (
    rules
      ?.split("\n")
      ?.map((rule) => rule.trim())
      ?.filter((rule) => !!rule) || []
  );
}

function setupRefreshMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: `${refreshAlarmPrefix}parent`,
      title: "Auto-refresh tab",
      contexts: ["action"],
    });

    chrome.contextMenus.create({
      id: `${refreshAlarmPrefix}0`,
      parentId: `${refreshAlarmPrefix}parent`,
      title: "Off",
      contexts: ["action"],
    });

    for (let minutes of refreshPresetMinutes) {
      chrome.contextMenus.create({
        id: `${refreshAlarmPrefix}${minutes}`,
        parentId: `${refreshAlarmPrefix}parent`,
        title: `Every ${minutes} minute${minutes === 1 ? "" : "s"}`,
        contexts: ["action"],
      });
    }
  });
}

function setTabRefresh(tabId, minutes) {
  let alarmName = `${refreshAlarmPrefix}${tabId}`;

  if (!minutes) {
    clearTabRefresh(tabId);
    return;
  }

  chrome.storage.local.set({ [alarmName]: minutes }, () => {
    chrome.alarms.create(alarmName, { periodInMinutes: minutes });
    refreshTabIndicator(tabId);
  });
}

function clearTabRefresh(tabId, updateIndicator = true) {
  let alarmName = `${refreshAlarmPrefix}${tabId}`;

  chrome.alarms.clear(alarmName);
  chrome.storage.local.remove(alarmName, () => {
    // The tab itself is gone when this runs from onRemoved; skip the update.
    if (updateIndicator) {
      refreshTabIndicator(tabId);
    }
  });
}

// Keep the toolbar button truthful per tab: a ↻ badge while auto-refresh is
// on, and a tooltip that always states the lock + refresh state, whether
// enabled or not.
function refreshTabIndicator(tabId) {
  chrome.storage.local.get([`tab_${tabId}`, `${refreshAlarmPrefix}${tabId}`], (items = {}) => {
    let isLocked = !!items[`tab_${tabId}`];
    let minutes = items[`${refreshAlarmPrefix}${tabId}`];
    let parts = [];

    if (isLocked) {
      parts.push("Locked");
    }

    if (minutes) {
      parts.push(`Auto-refresh every ${minutes} minute${minutes === 1 ? "" : "s"}`);
    }

    chrome.action.setTitle({
      tabId: tabId,
      title: parts.length ? `Lock Tab: ${parts.join(" \u2022 ")}` : "Lock Tab",
    });

    chrome.action.setBadgeText({ tabId: tabId, text: minutes ? "\u21BB" : "" });
  });
}

function pruneRefreshState() {
  chrome.storage.local.get(null, (items) => {
    let stale = Object.keys(items || {}).filter((key) => key.startsWith(refreshAlarmPrefix));

    if (stale.length === 0) {
      return;
    }

    chrome.storage.local.remove(stale);

    for (let alarmName of stale) {
      chrome.alarms.clear(alarmName);
    }
  });
}
