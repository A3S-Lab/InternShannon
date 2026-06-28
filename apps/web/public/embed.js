/**
 * ShuanOS chat embed widget (Pillar A — G3). Drop a published app's no-login chat onto any site as
 * a floating bubble:
 *
 *   <script src="https://<your-os-host>/embed.js" data-token="<share-token>"></script>
 *
 * Self-contained vanilla JS, no deps. It reads its own <script> src to derive the OS origin
 * (origin-aware, no hardcoded host) and iframes /chat/<token> — the same public, owner-run,
 * rate-limited chat surface. Mint the token via the admin endpoint POST /published-apps/:id/chat-share.
 *
 * ponytail: relies on document.currentScript (normal sync include) with a [data-token] fallback;
 * for async/module loaders, ensure exactly one tagged <script> on the page.
 */
(function () {
  var script =
    document.currentScript ||
    (function () {
      var tagged = document.querySelectorAll("script[data-token]");
      return tagged[tagged.length - 1];
    })();
  if (!script) return;
  var token = script.getAttribute("data-token");
  if (!token) {
    console.error("[ShuanOS chat] <script> is missing data-token");
    return;
  }
  var origin = new URL(script.src, window.location.href).origin;
  var chatUrl = origin + "/chat/" + encodeURIComponent(token);

  var panel = document.createElement("iframe");
  panel.src = chatUrl;
  panel.title = "聊天";
  panel.style.cssText =
    "position:fixed;right:20px;bottom:88px;width:380px;height:560px;max-width:calc(100vw - 40px);" +
    "max-height:calc(100vh - 120px);border:none;border-radius:12px;background:#fff;display:none;" +
    "box-shadow:0 8px 32px rgba(0,0,0,.24);z-index:2147483647;";

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "打开聊天");
  button.textContent = "💬";
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:none;" +
    "background:#2563eb;color:#fff;font-size:24px;line-height:56px;text-align:center;cursor:pointer;" +
    "box-shadow:0 4px 12px rgba(0,0,0,.2);z-index:2147483646;";

  var open = false;
  button.addEventListener("click", function () {
    open = !open;
    panel.style.display = open ? "block" : "none";
    button.textContent = open ? "✕" : "💬";
    button.setAttribute("aria-label", open ? "关闭聊天" : "打开聊天");
  });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(button);
  }
  if (document.body) mount();
  else window.addEventListener("DOMContentLoaded", mount);
})();
