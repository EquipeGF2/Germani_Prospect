// Memória da tela nesta aba do navegador: ao sair e voltar (ficha, Voltar à lista, menu), a tela abre como estava —
// linha escolhida, linhas abertas, tipo, filtros — sem refazer a escolha e sem ler o banco de novo (os dados vêm do cache).
// Fica no sessionStorage, por usuário: some ao fechar a aba ou ao entrar com outro usuário.
export function memoriaDaTela(nome, usuario) {
  const chave = `germani.tela.${nome}.${usuario?.id ?? ''}`;
  return {
    ler() { try { return JSON.parse(sessionStorage.getItem(chave) ?? 'null'); } catch { return null; } },
    guardar(valor) { try { sessionStorage.setItem(chave, JSON.stringify(valor)); } catch { /* só nesta visita */ } },
  };
}
