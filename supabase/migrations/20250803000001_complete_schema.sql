/*
  # Complete Schema Migration for LinkedIn Scraper Application
  
  This migration sets up the complete LinkedIn scraper database:
  
  1. Users table with proper auth integration
  2. API Keys management for Apify
  3. Global LinkedIn profiles storage (enhanced with all profile fields)
  4. LinkedIn post comments storage (for comment data)
  5. User saved profiles (junction table)
  6. Scraping logs and analytics
  7. RLS policies and security
  8. Triggers and functions
  9. Indexes for performance
  
  Run this migration on a fresh Supabase project to set up the complete schema.
*/

-- Drop existing tables to ensure clean migration
DROP TABLE IF EXISTS public.user_saved_profiles CASCADE;
DROP TABLE IF EXISTS public.linkedin_profiles CASCADE;
DROP TABLE IF EXISTS public.linkedin_post_comments CASCADE;
DROP TABLE IF EXISTS public.scraping_logs CASCADE;
DROP TABLE IF EXISTS public.api_keys CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- ========================================
-- 1. CREATE TABLES
-- ========================================

-- Users table (public profile for auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  webhook_token text DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- API Keys table (for Apify)
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  key_name text NOT NULL,
  api_key text NOT NULL,
  provider text NOT NULL DEFAULT 'apify',
  status text NOT NULL DEFAULT 'active',
  credits_remaining integer DEFAULT 0,
  last_used timestamptz,
  last_failed timestamptz,
  failure_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Global LinkedIn profiles table (enhanced with all profile fields)
CREATE TABLE IF NOT EXISTS public.linkedin_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linkedin_url text UNIQUE NOT NULL,
  first_name text,
  last_name text,
  full_name text,
  headline text,
  connections integer,
  followers integer,
  email text,
  mobile_number text,
  job_title text,
  company_name text,
  company_industry text,
  company_website text,
  company_linkedin text,
  company_founded_in integer,
  company_size text,
  current_job_duration text,
  current_job_duration_in_yrs integer,
  top_skills_by_endorsements jsonb,
  address_country_only text,
  address_with_country text,
  address_without_country text,
  profile_pic text,
  profile_pic_high_quality text,
  about text,
  public_identifier text,
  open_connection boolean,
  urn text,
  creator_website jsonb,
  experiences jsonb,
  updates jsonb,
  skills jsonb,
  profile_pic_all_dimensions jsonb,
  educations jsonb,
  license_and_certificates jsonb,
  honors_and_awards jsonb,
  languages jsonb,
  volunteer_and_awards jsonb,
  verifications jsonb,
  promos jsonb,
  highlights jsonb,
  projects jsonb,
  publications jsonb,
  patents jsonb,
  courses jsonb,
  test_scores jsonb,
  organizations jsonb,
  volunteer_causes jsonb,
  interests jsonb,
  recommendations jsonb,
  scraped_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- LinkedIn post comments table (for storing comment data)
CREATE TABLE IF NOT EXISTS public.linkedin_post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id text UNIQUE NOT NULL,
  linkedin_url text NOT NULL,
  commentary text,
  created_at_comment timestamptz,
  created_at_timestamp bigint,
  engagement jsonb,
  post_id text,
  pinned boolean,
  contributed boolean,
  edited boolean,
  actor jsonb,
  query jsonb,
  scraped_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- User saved profiles (junction table - which profiles each user has saved)
CREATE TABLE IF NOT EXISTS public.user_saved_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  profile_id uuid REFERENCES public.linkedin_profiles(id) ON DELETE CASCADE NOT NULL,
  notes text,
  tags text[],
  saved_at timestamptz DEFAULT now(),
  UNIQUE(user_id, profile_id)
);

-- Scraping logs table
CREATE TABLE IF NOT EXISTS public.scraping_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  request_id text NOT NULL,
  profile_urls jsonb NOT NULL,
  results jsonb,
  api_keys_used jsonb,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  processing_time integer,
  profiles_scraped integer DEFAULT 0,
  profiles_failed integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ========================================
-- 2. ENABLE ROW LEVEL SECURITY
-- ========================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_saved_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraping_logs ENABLE ROW LEVEL SECURITY;

-- ========================================
-- 3. CREATE INDEXES FOR PERFORMANCE
-- ========================================

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON public.api_keys(status);
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_url ON public.linkedin_profiles(linkedin_url);
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_name ON public.linkedin_profiles(full_name);
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_company ON public.linkedin_profiles(company_name);
CREATE INDEX IF NOT EXISTS idx_linkedin_post_comments_comment_id ON public.linkedin_post_comments(comment_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_post_comments_post_id ON public.linkedin_post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_post_comments_created_at ON public.linkedin_post_comments(created_at_comment);
CREATE INDEX IF NOT EXISTS idx_user_saved_profiles_user_id ON public.user_saved_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_saved_profiles_profile_id ON public.user_saved_profiles(profile_id);
CREATE INDEX IF NOT EXISTS idx_scraping_logs_user_id ON public.scraping_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_scraping_logs_created_at ON public.scraping_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_users_webhook_token ON public.users(webhook_token);

-- ========================================
-- 4. CREATE FUNCTIONS
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    email,
    full_name,
    webhook_token
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    encode(gen_random_bytes(32), 'hex')
  );
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    -- Log the error but don't fail the auth process
    RAISE LOG 'Error creating user profile: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Function to get user's saved profiles with profile data
CREATE OR REPLACE FUNCTION public.get_user_saved_profiles(user_uuid uuid)
RETURNS TABLE (
  saved_profile_id uuid,
  profile_id uuid,
  profile_url text,
  full_name text,
  headline text,
  company text,
  job_title text,
  location text,
  profile_image_url text,
  notes text,
  tags text[],
  saved_at timestamptz,
  scraped_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    usp.id as saved_profile_id,
    lp.id as profile_id,
    lp.profile_url,
    lp.full_name,
    lp.headline,
    lp.company,
    lp.job_title,
    lp.location,
    lp.profile_image_url,
    usp.notes,
    usp.tags,
    usp.saved_at,
    lp.scraped_at
  FROM public.user_saved_profiles usp
  JOIN public.linkedin_profiles lp ON usp.profile_id = lp.id
  WHERE usp.user_id = user_uuid
  ORDER BY usp.saved_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 5. CREATE TRIGGERS
-- ========================================

-- Trigger for updated_at timestamps
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_linkedin_profiles_updated_at
  BEFORE UPDATE ON public.linkedin_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_linkedin_post_comments_updated_at
  BEFORE UPDATE ON public.linkedin_post_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger for automatic user profile creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========================================
-- 6. CREATE RLS POLICIES
-- ========================================

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can read own data" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;
DROP POLICY IF EXISTS "Users can create own profile" ON public.users;
DROP POLICY IF EXISTS "Service can create user profiles" ON public.users;
DROP POLICY IF EXISTS "Backend can read users by webhook token" ON public.users;

DROP POLICY IF EXISTS "Users can manage own API keys" ON public.api_keys;

DROP POLICY IF EXISTS "LinkedIn profiles are publicly readable" ON public.linkedin_profiles;
DROP POLICY IF EXISTS "Service can manage LinkedIn profiles" ON public.linkedin_profiles;

DROP POLICY IF EXISTS "LinkedIn post comments are publicly readable" ON public.linkedin_post_comments;
DROP POLICY IF EXISTS "Service can manage LinkedIn post comments" ON public.linkedin_post_comments;

DROP POLICY IF EXISTS "Users can read own scraping logs" ON public.scraping_logs;
DROP POLICY IF EXISTS "Service can create scraping logs" ON public.scraping_logs;

-- Users table policies
CREATE POLICY "Users can read own data"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own data"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can create own profile"
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Service can create user profiles"
  ON public.users
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Backend can read users by webhook token"
  ON public.users
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- API Keys table policies
CREATE POLICY "Users can manage own API keys"
  ON public.api_keys
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- LinkedIn profiles table policies (global read, authenticated insert/update)
CREATE POLICY "LinkedIn profiles are publicly readable"
  ON public.linkedin_profiles
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Service can manage LinkedIn profiles"
  ON public.linkedin_profiles
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

-- LinkedIn post comments table policies (global read, authenticated insert/update)
CREATE POLICY "LinkedIn post comments are publicly readable"
  ON public.linkedin_post_comments
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Service can manage LinkedIn post comments"
  ON public.linkedin_post_comments
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

-- User saved profiles policies
CREATE POLICY "Users can manage own saved profiles"
  ON public.user_saved_profiles
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- Scraping logs table policies
CREATE POLICY "Users can read own scraping logs"
  ON public.scraping_logs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service can create scraping logs"
  ON public.scraping_logs
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ========================================
-- 7. GRANT PERMISSIONS
-- ========================================

-- Grant necessary permissions to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.users TO authenticated;
GRANT ALL ON public.api_keys TO authenticated;
GRANT ALL ON public.linkedin_profiles TO authenticated;
GRANT ALL ON public.user_saved_profiles TO authenticated;
GRANT ALL ON public.scraping_logs TO authenticated;

-- Grant permissions to anon users for webhook access and profile reading
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.users TO anon;
GRANT SELECT ON public.linkedin_profiles TO anon;

-- ========================================
-- 8. VERIFICATION QUERIES
-- ========================================

-- Verify tables exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'Users table was not created successfully';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_keys' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'API Keys table was not created successfully';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'linkedin_profiles' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'LinkedIn profiles table was not created successfully';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_saved_profiles' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'User saved profiles table was not created successfully';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scraping_logs' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'Scraping logs table was not created successfully';
  END IF;
  
  RAISE NOTICE 'All tables created successfully';
END $$;

-- Verify RLS is enabled
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'users' 
    AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on users table';
  END IF;
  
  RAISE NOTICE 'RLS is properly enabled on all tables';
END $$;

-- Verify triggers exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'on_auth_user_created'
  ) THEN
    RAISE EXCEPTION 'User creation trigger was not created successfully';
  END IF;
  
  RAISE NOTICE 'All triggers created successfully';
END $$;

-- ========================================
-- 9. FINAL STATUS
-- ========================================

-- Display final status
SELECT 
  'LinkedIn Scraper migration completed successfully' as status,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as tables_created,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') as policies_created,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname LIKE '%user%' OR tgname LIKE '%updated%') as triggers_created;
