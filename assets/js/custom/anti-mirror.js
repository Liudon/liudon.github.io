(function () {
  const allowedHosts = new Set([
    "liudon.com",
    "blog.liudon.xyz",
    "localhost",
    "127.0.0.1",
    "::1"
  ]);

  if (allowedHosts.has(window.location.hostname)) return;

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
