-- ====================================================================
-- MIGRATION 002: security hardening + careers + subscribers
-- Run once in Supabase SQL Editor AFTER supabase_schema.sql
-- ====================================================================

-- 1. New tables
CREATE TABLE IF NOT EXISTS public.vacancies (
    id SERIAL PRIMARY KEY,
    title_en VARCHAR(255) NOT NULL,
    title_ru VARCHAR(255) NOT NULL,
    location_en VARCHAR(255),
    location_ru VARCHAR(255),
    resp_en JSONB DEFAULT '[]'::jsonb,
    resp_ru JSONB DEFAULT '[]'::jsonb,
    req_en TEXT,
    req_ru TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    order_num INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subscribers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(254) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

-- 2. Tighten RLS.
-- All writes go through the API server (service_role bypasses RLS).
-- Remove policies that let ANY Supabase-authenticated user or anon write data.
DROP POLICY IF EXISTS "Public insert messages" ON public.messages;
DROP POLICY IF EXISTS "Admin all products" ON public.products;
DROP POLICY IF EXISTS "Admin all services" ON public.services;
DROP POLICY IF EXISTS "Admin all news" ON public.news;
DROP POLICY IF EXISTS "Admin all messages" ON public.messages;
DROP POLICY IF EXISTS "Admin all settings" ON public.settings;

DROP POLICY IF EXISTS "Public read vacancies" ON public.vacancies;
CREATE POLICY "Public read vacancies" ON public.vacancies FOR SELECT USING (is_active = true);
-- messages & subscribers: no public policies at all (private PII)

-- 3. Fix SERIAL sequences after seeding with explicit ids
--    (otherwise new inserts fail with "duplicate key value violates unique constraint")
SELECT setval(pg_get_serial_sequence('public.products', 'id'), COALESCE((SELECT MAX(id) FROM public.products), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.services', 'id'), COALESCE((SELECT MAX(id) FROM public.services), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.news', 'id'), COALESCE((SELECT MAX(id) FROM public.news), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.vacancies', 'id'), COALESCE((SELECT MAX(id) FROM public.vacancies), 0) + 1, false);

-- 4. Storage bucket for media (public read, writes only via service_role)
INSERT INTO storage.buckets (id, name, public)
VALUES ('jeraplus_media', 'jeraplus_media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 5. Seed vacancies (from the original site)
INSERT INTO public.vacancies (title_en, title_ru, location_en, location_ru, resp_en, resp_ru, req_en, req_ru, order_num)
SELECT * FROM (VALUES
 ('LPG Trader (Wholesale Manager)', 'Трейдер СУГ (оптовый менеджер)',
  'Europe / Remote / Podgorica HQ', 'Европа / Удаленно / Офис в Подгорице',
  '["Organizing the entire LPG supply chain from Europe and the CIS to Ukraine and Moldova.","Negotiating with terminals, gas stations and regional distributors.","Coordinating deliveries by gas trucks and rail tank cars."]'::jsonb,
  '["Организация полной цепочки поставок СУГ из Европы и СНГ в Украину и Молдову.","Переговоры с терминалами, сетями АЗС и региональными дистрибьюторами.","Координация отгрузок автогазовозами и ж/д цистернами."]'::jsonb,
  'At least 2 years of experience in LPG trading, stable client contacts and understanding of the regional market.',
  'Опыт в трейдинге СУГ от 2 лет, стабильные контакты с клиентами и понимание специфики региона.', 1),
 ('Grain / Flax Seeds Trader', 'Трейдер зерна / льна',
  'EU Countries / Remote', 'Страны ЕС / Удаленно',
  '["Selling Ukrainian flax and flax products (incl. golden flax) to EU and other markets.","Working with our long-term farmer and elevator partners.","Organizing the full supply chain, including processing and packaged product options."]'::jsonb,
  '["Продажи украинского льна и продуктов переработки (включая «золотой лён») в ЕС и на другие рынки.","Работа с нашими долгосрочными партнерами — фермерами и элеваторами.","Организация полной цепочки поставок, включая переработку и фасованную продукцию."]'::jsonb,
  'At least 2 years of experience in grain/flax trading with stable contacts with potential buyers.',
  'Опыт в трейдинге зерна/льна от 2 лет и стабильные контакты с потенциальными покупателями.', 2)
) AS v(title_en, title_ru, location_en, location_ru, resp_en, resp_ru, req_en, req_ru, order_num)
WHERE NOT EXISTS (SELECT 1 FROM public.vacancies);

-- 6. Seed company stats & SEO settings (editable in admin)
INSERT INTO public.settings (key, value) VALUES
('stats', '[
  {"value":"8+","label_en":"Years of profitable trading","label_ru":"Лет прибыльной работы"},
  {"value":"100%","label_en":"Contract fulfilment","label_ru":"Исполнение контрактов"},
  {"value":"15+","label_en":"Countries of delivery","label_ru":"Стран поставок"},
  {"value":"7","label_en":"Commodity sectors","label_ru":"Товарных направлений"}
]'::jsonb),
('seo', '{
  "title_en":"Jera Plus | International Petroleum & Commodity Trading",
  "title_ru":"Jera Plus | Международный трейдинг нефтепродуктов и сырья",
  "description_en":"Jera Plus is a European company supplying LPG, diesel, gasoline, oils, petrochemicals, plastics, flax seed and minerals with end-to-end logistics.",
  "description_ru":"Jera Plus — европейская компания: поставки СУГ, дизеля, бензина, масел, нефтехимии, пластиков, льна и минералов с полной логистикой."
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
