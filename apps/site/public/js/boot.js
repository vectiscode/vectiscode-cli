(function() {
  var p = window.location.pathname;
  var t = "Loading...";
  if (p.indexOf("/chat") === 0) t = "Loading chat...";
  else if (p.indexOf("/studio") === 0) t = "Loading Studio bridge...";
  else if (p.indexOf("/profile") === 0) t = "Loading profile...";
  else if (p.indexOf("/settings") === 0) t = "Loading settings...";
  else if (p.indexOf("/admin") === 0) t = "Loading admin panel...";
  else if (p.indexOf("/plans") === 0 || p.indexOf("/pricing") === 0) t = "Loading plans...";
  else if (p.indexOf("/download") === 0) t = "Loading downloads...";
  else if (p.indexOf("/privacy") === 0 || p.indexOf("/terms") === 0) t = "Loading...";
  document.getElementById("initial-loading-text").textContent = t;
})();
