// Service worker mínimo: só o que o navegador exige para instalar o site como app.
// Não guarda nada em cache (o app sempre lê o banco e a versão publicada): a página vem da rede;
// sem rede, mostra um aviso em vez da tela de erro do navegador. Requisições do banco não passam por aqui.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (ev) => {
  if (ev.request.mode !== 'navigate') return;
  ev.respondWith(fetch(ev.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GERMANI Prospect</title>'
    + '<p style="font-family:sans-serif;padding:24px">Sem conexão com a internet. O GERMANI Prospect precisa de conexão: tente de novo quando a rede voltar.</p>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
