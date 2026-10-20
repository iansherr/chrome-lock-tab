(function () {
  function updateTheme() {
    let colorMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.querySelector("html").setAttribute("data-bs-theme", colorMode);
  }

  function restoreOptions() {
    chrome.storage.sync.get("options", ({ options = {} }) => {
      document.getElementById("show-tab-icon").checked = options.showTabIcon === undefined ? true : !!options.showTabIcon;
      document.getElementById("auto-lock-pinned-tabs").checked = options.autoLockPinnedTabs === undefined ? true : !!options.autoLockPinnedTabs;
      document.getElementById("allow-reload").checked = !!options.allowReload;
      document.getElementById("open-links-in-new-tab").checked = !!options.openLinksInNewTab;
      document.getElementById("allow-form-submit").checked = !!options.allowFormSubmit;
      document.getElementById("rules-enable").value = options.rulesEnable || "";
      document.getElementById("rules-disable").value = options.rulesDisable || "";
    });
  }

  function saveOptions() {
    let showTabIcon = !!document.getElementById("show-tab-icon").checked;
    let autoLockPinnedTabs = !!document.getElementById("auto-lock-pinned-tabs").checked;
    let allowReload = !!document.getElementById("allow-reload").checked;
    let openLinksInNewTab = !!document.getElementById("open-links-in-new-tab").checked;
    let allowFormSubmit = !!document.getElementById("allow-form-submit").checked;
    let rulesEnable = document.getElementById("rules-enable").value;
    let rulesDisable = document.getElementById("rules-disable").value;

    chrome.storage.sync.set({ options: {
      showTabIcon,
      autoLockPinnedTabs,
      allowReload,
      openLinksInNewTab,
      allowFormSubmit,
      rulesEnable,
      rulesDisable
    }}, () => {
      let saveSuccessElement = document.getElementById("save-success");
      saveSuccessElement.style.display = "";
      setTimeout(() => {
        saveSuccessElement.style.display = "none";
      }, 3000);
    });
  }

  updateTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateTheme);

  document.addEventListener("DOMContentLoaded", restoreOptions);
  document.getElementById("save").addEventListener("click", saveOptions);
})();
