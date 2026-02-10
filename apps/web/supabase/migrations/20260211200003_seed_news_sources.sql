-- FILM-1130: Seed default news sources
-- Depends on: 20260211200000_create_external_context_tables.sql

INSERT INTO external_sources (
  name, slug, description, website_url, category, provider_type,
  credibility_tier, bias_label, rate_limit_per_hour, cache_ttl_hours, config
) VALUES
  -- Tier 1: Wire Services (highest credibility, center bias)
  ('Reuters', 'reuters', 'Global news wire service', 'https://reuters.com',
   'news', 'newsapi', 'tier_1', 'center', 100, 6,
   '{"source_id": "reuters", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  ('Associated Press', 'ap-news', 'American news agency', 'https://apnews.com',
   'news', 'newsapi', 'tier_1', 'center', 100, 6,
   '{"source_id": "associated-press", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  ('Agence France-Presse', 'afp', 'French news agency', 'https://afp.com',
   'news', 'newsapi', 'tier_1', 'center', 100, 6,
   '{"source_id": "agence-france-presse", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  -- Tier 2: Major outlets (with political bias labels from Ad Fontes / AllSides)
  ('BBC News', 'bbc-news', 'British Broadcasting Corporation', 'https://bbc.com/news',
   'news', 'newsapi', 'tier_2', 'center_left', 100, 6,
   '{"source_id": "bbc-news", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  ('The New York Times', 'nytimes', 'American newspaper', 'https://nytimes.com',
   'news', 'newsapi', 'tier_2', 'center_left', 100, 6,
   '{"source_id": "the-new-york-times", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  ('The Guardian', 'guardian', 'British daily newspaper', 'https://theguardian.com',
   'news', 'newsapi', 'tier_2', 'left', 100, 6,
   '{"source_id": "the-guardian-uk", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  ('The Wall Street Journal', 'wsj', 'American business newspaper', 'https://wsj.com',
   'news', 'newsapi', 'tier_2', 'center_right', 100, 6,
   '{"source_id": "the-wall-street-journal", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  ('Al Jazeera English', 'aljazeera', 'Qatari news network', 'https://aljazeera.com',
   'news', 'newsapi', 'tier_2', 'center', 100, 6,
   '{"source_id": "al-jazeera-english", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  ('CNN', 'cnn', 'American news network', 'https://cnn.com',
   'news', 'newsapi', 'tier_2', 'center_left', 100, 6,
   '{"source_id": "cnn", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  ('NPR', 'npr', 'National Public Radio', 'https://npr.org',
   'news', 'newsapi', 'tier_2', 'center_left', 100, 6,
   '{"source_id": "npr", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  -- Tier 2: Right-leaning sources for perspective balance
  ('Fox News', 'fox-news', 'American news network', 'https://foxnews.com',
   'news', 'newsapi', 'tier_2', 'center_right', 100, 6,
   '{"source_id": "fox-news", "api_key_env": "NEWSAPI_KEY"}'::jsonb),

  ('The Daily Telegraph', 'daily-telegraph', 'British broadsheet newspaper', 'https://telegraph.co.uk',
   'news', 'newsapi', 'tier_2', 'center_right', 100, 6,
   '{"source_id": "the-telegraph", "api_key_env": "NEWSAPI_KEY"}'::jsonb)

ON CONFLICT (slug) DO UPDATE SET
  description = EXCLUDED.description,
  bias_label = EXCLUDED.bias_label,
  rate_limit_per_hour = EXCLUDED.rate_limit_per_hour,
  cache_ttl_hours = EXCLUDED.cache_ttl_hours,
  config = EXCLUDED.config;
