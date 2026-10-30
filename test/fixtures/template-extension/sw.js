chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message === "ping") reply("pong");
});
