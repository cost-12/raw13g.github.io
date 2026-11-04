(function (window, document) {
  "use strict";

  var expected = [];
  var states = {};

  function render() {
    var panel = document.getElementById("resource-load-status");
    if (!panel || expected.length === 0) return;

    var loaded = 0;
    var failed = [];
    for (var i = 0; i < expected.length; i++) {
      var state = states["$" + expected[i]];
      if (state === true) loaded++;
      else if (state === false) failed.push(expected[i]);
    }

    panel.style.padding = "8px 10px";
    panel.style.marginBottom = "15px";
    panel.style.border = "1px solid #333";
    panel.style.borderRadius = "4px";
    panel.style.background = "#111";
    panel.setAttribute("data-loaded", String(loaded));
    panel.setAttribute("data-total", String(expected.length));

    if (failed.length) {
      panel.setAttribute("data-state", "error");
      panel.style.color = "#ff4444";
      panel.textContent = "Falha ao carregar: " + failed.join(", ");
    } else if (loaded === expected.length) {
      panel.setAttribute("data-state", "ready");
      panel.style.color = "#00ff41";
      panel.textContent = "Arquivos JS recebidos (" + loaded + "/" + expected.length + ").";
    } else {
      panel.setAttribute("data-state", "loading");
      panel.style.color = "#ffcc00";
      panel.textContent = "Recebendo scripts locais (" + loaded + "/" + expected.length + ")…";
    }
  }

  window.ResourceLoadTracker = {
    configure: function (resources) {
      expected = resources.slice(0);
      states = {};
      render();
    },
    complete: function (script, ok) {
      var source = typeof script === "string"
        ? script
        : script && (script.getAttribute("data-load-name") || script.src);
      var name = String(source || "").split(/[?#]/, 1)[0].split(/[\\/]/).pop();
      if (!name) return;
      states["$" + name] = ok === true;
      render();
    },
    refresh: render
  };

  document.addEventListener("DOMContentLoaded", render);
})(window, document);
