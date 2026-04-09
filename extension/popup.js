import { localizeHtml } from "./i18n.js";

localizeHtml();

document.getElementById("openOrganizer").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("organizer.html") });
  window.close();
});
