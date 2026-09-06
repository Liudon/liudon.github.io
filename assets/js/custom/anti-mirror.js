(function () {
  const host = window.location.host; // 含端口，方便本地调试

  // 精确白名单：本人可控的部署域名
  const allowedHosts = new Set([
    "liudon.com",
    "blog.liudon.xyz",
    "liudon.xyz",
    "liudon.sol.build",
    "liudon.eth.limo"
    // 以后新增网关/部署域名，继续加在这里
  ]);

  const isLocalDev =
    host === "localhost" || host.startsWith("localhost:") ||
    host === "127.0.0.1" || host.startsWith("127.0.0.1:") ||
    host === "[::1]" || host.startsWith("[::1]:");

  if (allowedHosts.has(host) || isLocalDev) return;

  document.body.innerHTML = [
    '<div style="margin: auto;">',
    "<h1>当前页面并非本人博客，即将在 2 秒后跳转到本人博客：https://liudon.com。</h1>",
    "<br>",
    "</div>"
  ].join("");

  document.body.style.cssText = [
    "background-color: white",
    "color: black",
    "text-align: center",
    "font-size: 50px",
    "width: 100vw",
    "height: 100vh",
    "display: flex",
    "margin: 0"
  ].join(";");

  window.setTimeout(function () {
    window.location.replace("https://liudon.com");
  }, 2000);
})();