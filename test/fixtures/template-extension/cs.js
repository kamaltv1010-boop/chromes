document.documentElement.setAttribute("data-pipe-ext", "1");
chrome.runtime.sendMessage("ping").then((answer) => document.documentElement.setAttribute("data-pipe-sw", String(answer)), (error) => document.documentElement.setAttribute("data-pipe-sw", "error " + error.message));
