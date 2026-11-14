(() => {
  function loadScript(url, maxWait = 0) {
    return new Promise(resolve => {
      const script = document.createElement('script');
      let done = false;
      let timer;

      const finish = success => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!success) script.remove();
        resolve(success);
      };

      script.async = true;
      script.src = url;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      document.head.appendChild(script);
      if (maxWait) timer = setTimeout(() => finish(false), maxWait);
    });
  }

  async function start() {
    const current = await loadScript('https://cdn.jsdelivr.net/npm/vue@3.5.45/dist/vue.global.prod.js', 2500);
    if (!current || !window.Vue) await loadScript('vue-fallback.js');

    if (!window.Vue || !(await loadScript('catalog.js')) || !(await loadScript('app.js'))) {
      const root = document.getElementById('app');
      root.removeAttribute('v-cloak');
      root.innerHTML = '<main style="max-width:620px;margin:80px auto;padding:24px;font-family:Arial,sans-serif"><h1>O CineAtlas nao iniciou</h1><p>Actualiza a pagina para tentar novamente.</p></main>';
    }
  }

  start();
})();
