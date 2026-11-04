-- 0026 — Aba Exportar da tela Importações (Rejeitados, base e pedidos em Excel): gerente e administrador. docs/03 §17
INSERT INTO perfil_telas (perfil_id, tela)
SELECT id, 'exportar' FROM perfis WHERE sistema = 1 AND base IN ('administrador', 'gerente');
