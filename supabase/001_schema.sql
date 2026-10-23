-- ====================================================================
-- SUPABASE SCHEMA & INITIAL SEED FOR JERAPLUS
-- Run this in your Supabase SQL Editor: https://app.supabase.com/project/_/sql
-- ====================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Products Table
CREATE TABLE IF NOT EXISTS public.products (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    title_en VARCHAR(255) NOT NULL,
    title_ru VARCHAR(255) NOT NULL,
    category_en VARCHAR(100) NOT NULL,
    category_ru VARCHAR(100) NOT NULL,
    excerpt_en TEXT,
    excerpt_ru TEXT,
    description_en TEXT,
    description_ru TEXT,
    specs JSONB DEFAULT '[]'::jsonb,
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    order_num INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Services Table
CREATE TABLE IF NOT EXISTS public.services (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    title_en VARCHAR(255) NOT NULL,
    title_ru VARCHAR(255) NOT NULL,
    excerpt_en TEXT,
    excerpt_ru TEXT,
    description_en TEXT,
    description_ru TEXT,
    icon VARCHAR(50) DEFAULT 'Briefcase',
    stages JSONB DEFAULT '[]'::jsonb,
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    order_num INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. News Articles Table
CREATE TABLE IF NOT EXISTS public.news (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(150) UNIQUE NOT NULL,
    title_en VARCHAR(255) NOT NULL,
    title_ru VARCHAR(255) NOT NULL,
    excerpt_en TEXT,
    excerpt_ru TEXT,
    content_en TEXT,
    content_ru TEXT,
    image_url TEXT,
    published_at DATE DEFAULT CURRENT_DATE,
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Contact Form Submissions Table
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(100),
    company VARCHAR(255),
    project VARCHAR(255),
    message TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'new', -- 'new', 'in_progress', 'completed'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Site Settings & Company Info Table
CREATE TABLE IF NOT EXISTS public.settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Row Level Security (RLS) Setup
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Public can read active products, services, news and settings
CREATE POLICY "Public read products" ON public.products FOR SELECT USING (is_active = true);
CREATE POLICY "Public read services" ON public.services FOR SELECT USING (is_active = true);
CREATE POLICY "Public read news" ON public.news FOR SELECT USING (is_published = true);
CREATE POLICY "Public read settings" ON public.settings FOR SELECT USING (true);

-- Public can insert messages (contact form)
CREATE POLICY "Public insert messages" ON public.messages FOR INSERT WITH CHECK (true);

-- Authenticated (Admins) have full access
CREATE POLICY "Admin all products" ON public.products FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
CREATE POLICY "Admin all services" ON public.services FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
CREATE POLICY "Admin all news" ON public.news FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
CREATE POLICY "Admin all messages" ON public.messages FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
CREATE POLICY "Admin all settings" ON public.settings FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- ====================================================================
-- SEED DATA INSERTION
-- ====================================================================

-- Company Settings
INSERT INTO public.settings (key, value) VALUES 
('company_info', '{
    "company_name": "Jera Plus",
    "country": "Montenegro",
    "city": "Podgorica",
    "address": "Podgorica, Montenegro",
    "phone": "+382 67 952403",
    "email": "office@jeraplus.com",
    "linkedin": "https://www.linkedin.com/company/jera-plus/",
    "founded_year": 2018,
    "tagline_en": "Your trusted partner in international petroleum trading, commodities and logistics",
    "tagline_ru": "Ваш надежный партнер в международном трейдинге нефтепродуктов, сырья и логистике",
    "youtube_id": "_DuaZLvPNHs"
}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Hero Slides
INSERT INTO public.settings (key, value) VALUES 
('hero_slides', '[
    {
        "id": 1,
        "title_en": "We are the partner who can offer the best price and the best delivery conditions!",
        "title_ru": "Партнер, который предлагает лучшие цены и оптимальные условия доставки!",
        "subtitle_en": "We are the team that will provide you the best logistics across Europe and worldwide.",
        "subtitle_ru": "Команда профессионалов, обеспечивающая первоклассную логистику в Европе и по всему миру.",
        "image_url": "/images/bn_2.jpg"
    },
    {
        "id": 2,
        "title_en": "Decades of experience in Petroleum products and Gas supply",
        "title_ru": "Многолетний опыт поставок нефтепродуктов, СУГ и промышленного сырья",
        "subtitle_en": "Fuel, Liquefied gas, Base oils and Chemical raw materials supplied directly to leading industrial and agricultural enterprises.",
        "subtitle_ru": "Топливо, сжиженный газ, базовые масла и сырье для промышленных и аграрных предприятий.",
        "image_url": "/images/bn_1.jpg"
    },
    {
        "id": 3,
        "title_en": "Jera Plus helps you produce and sell products with maximum profitability",
        "title_ru": "Jera Plus помогает производить и реализовывать продукцию с максимальной выгодой",
        "subtitle_en": "High-quality products and flawless fulfillment of all contractual obligations are the foundation of our long-term cooperation.",
        "subtitle_ru": "Высокое качество продукции и строгое исполнение всех обязательств — основа долгосрочного партнерства.",
        "image_url": "/images/bn_3.jpg"
    }
]'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Advantages
INSERT INTO public.settings (key, value) VALUES 
('advantages', '[
    {
        "icon": "Award",
        "title_en": "High-Quality Products",
        "title_ru": "Высокое качество продукции",
        "desc_en": "Sourced from leading refineries and certified global manufacturers.",
        "desc_ru": "Поставки от ведущих нефтеперерабатывающих заводов и проверенных производителей."
    },
    {
        "icon": "Ship",
        "title_en": "Global Multimodal Logistics",
        "title_ru": "Международная логистика",
        "desc_en": "Experienced transport managers organizing sea, rail, and road deliveries.",
        "desc_ru": "Опытные менеджеры, организующие морские, железнодорожные и автоперевозки."
    },
    {
        "icon": "ShieldCheck",
        "title_en": "Proven Experience",
        "title_ru": "Многолетний опыт",
        "desc_en": "Decades of combined practical expertise in energy trading and storage infrastructure.",
        "desc_ru": "Десятилетия практического опыта в трейдинге энергоносителей и топливной инфраструктуре."
    },
    {
        "icon": "TrendingUp",
        "title_en": "Favorable Prices & Financing",
        "title_ru": "Выгодные цены и факторинг",
        "desc_en": "Competitive pricing, trade financing, and an individualized commercial approach.",
        "desc_ru": "Конкурентные котировки, торговое финансирование и индивидуальный подход к каждому партнеру."
    }
]'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
