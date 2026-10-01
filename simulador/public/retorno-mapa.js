// A origem é uma opção local conhecida; nunca redireciona para uma URL externa.
(() => {
  if (!['/mapa', '/mapa-simulado'].includes(location.pathname)) return;
  const link = document.getElementById('voltar');
  if (!link) return;
  const origem = new URLSearchParams(location.search).get('origem');
  let administrador = origem === 'admin';
  if (!origem && document.referrer) {
    try {
      const anterior = new URL(document.referrer);
      administrador = anterior.origin === location.origin && anterior.pathname === '/admin';
    } catch {
      administrador = false;
    }
  }
  link.href = administrador ? '/admin' : '/usuario';
  link.textContent = administrador ? 'Área do administrador ↗' : 'Área do usuário ↗';
})();
