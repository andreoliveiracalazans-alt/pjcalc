-- =========================================================================
-- BANCO DE DADOS & STORAGE SUPABASE (POSTGRESQL)
-- Plataforma Pericial PJe-Calc | Dr. André Calazans
-- =========================================================================

-- 1. TABELA PRINCIPAL: PEDIDOS DE CÁLCULOS
create table if not exists public.pedidos_calculos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  cliente_email text not null,
  cliente_whatsapp text not null,
  numero_processo text not null,
  tipo_servico text not null,
  prazo_fatal date not null,
  observacoes text,
  caminho_arquivo text,
  link_drive text,
  link_pagamento text,
  valor numeric(10,2) default 0.00,
  pago_em timestamp with time zone,
  status text not null default 'solicitado' check (
    status in (
      'solicitado',
      'em_analise',
      'aprovado',
      'aguardando_pagamento',
      'pagamento_realizado',
      'na_fila_de_calculos',
      'em_elaboracao',
      'entregue'
    )
  ),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. TABELA DE MENSAGENS: FÓRUM / ALINHAMENTO TÉCNICO POR PROCESSO
create table if not exists public.mensagens_processo (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos_calculos(id) on delete cascade not null,
  remetente_email text not null,
  is_admin boolean default false,
  mensagem text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. TABELA DE AUDITORIA: LOGS DE DISPARO WHATSAPP (META CLOUD API)
create table if not exists public.notificacoes_whatsapp_log (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos_calculos(id) on delete cascade,
  destinatario_numero text not null,
  tipo_evento text not null,
  corpo_mensagem text not null,
  enviado boolean default false,
  resposta_meta jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. TABELA DE MARKETING & SEO: ARTIGOS DO BLOG E TESES
create table if not exists public.artigos_blog (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  slug text unique not null,
  resumo text not null,
  conteudo_html text not null,
  video_url text,
  meta_description text,
  meta_keywords text,
  publicado boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. CONFIGURAÇÃO DO BUCKET PRIVADO NO STORAGE (AES-256)
insert into storage.buckets (id, name, public)
values ('documentos_processos', 'documentos_processos', false)
on conflict (id) do update set public = false;

-- 6. HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
alter table public.pedidos_calculos enable row level security;
alter table public.mensagens_processo enable row level security;
alter table public.notificacoes_whatsapp_log enable row level security;
alter table public.artigos_blog enable row level security;

-- 7. POLÍTICAS DE ACESSO DO BANCO DE DADOS (RLS)

-- Tabela: pedidos_calculos
create policy "Advogado visualiza seus pedidos ou Admin visualiza todos"
on public.pedidos_calculos for select
to authenticated
using (
  auth.uid() = user_id or auth.jwt()->>'email' = 'andreoliveiracalazans@gmail.com'
);

create policy "Advogados cadastram novos pedidos"
on public.pedidos_calculos for insert
to authenticated
with check (
  auth.uid() = user_id
);

create policy "Admin atualiza pedidos e honorarios"
on public.pedidos_calculos for update
to authenticated
using (
  auth.jwt()->>'email' = 'andreoliveiracalazans@gmail.com'
);

-- Tabela: mensagens_processo
create policy "Partes envolvidas e admin leem as mensagens"
on public.mensagens_processo for select
to authenticated
using (
  auth.jwt()->>'email' = 'andreoliveiracalazans@gmail.com' or
  exists (
    select 1 from public.pedidos_calculos
    where public.pedidos_calculos.id = public.mensagens_processo.pedido_id
    and public.pedidos_calculos.user_id = auth.uid()
  )
);

create policy "Partes autenticadas enviam mensagens no forum"
on public.mensagens_processo for insert
to authenticated
with check (
  auth.uid() is not null
);

-- Tabela: notificacoes_whatsapp_log
create policy "Apenas admin gerencia logs do whatsapp"
on public.notificacoes_whatsapp_log for all
to authenticated
using (
  auth.jwt()->>'email' = 'andreoliveiracalazans@gmail.com'
);

-- Tabela: artigos_blog
create policy "Artigos publicos sao visiveis por qualquer usuario"
on public.artigos_blog for select
using (
  publicado = true or auth.jwt()->>'email' = 'andreoliveiracalazans@gmail.com'
);

create policy "Apenas admin gerencia publicacoes do blog"
on public.artigos_blog for all
to authenticated
using (
  auth.jwt()->>'email' = 'andreoliveiracalazans@gmail.com'
);

-- 8. POLÍTICAS DE ACESSO AO STORAGE (DOCUMENTOS PRIVADOS)

create policy "Advogados autenticados fazem upload de arquivos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'documentos_processos'
);

create policy "Acesso seguro via link assinado aos documentos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'documentos_processos' and (
    auth.jwt()->>'email' = 'andreoliveiracalazans@gmail.com' or
    auth.uid()::text = (storage.foldername(name))[1]
  )
);
