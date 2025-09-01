# Supabase Setup Guide

This guide will help you set up a new Supabase project and run the complete migration.

## Prerequisites

1. A Supabase account (free tier works fine)
2. Access to Supabase dashboard

## Step 1: Create New Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Choose your organization
4. Enter project details:
   - **Name**: `article-generator` (or your preferred name)
   - **Database Password**: Generate a strong password
   - **Region**: Choose closest to your users
5. Click "Create new project"
6. Wait for the project to be created (usually 2-3 minutes)

## Step 2: Get Project Credentials

1. In your Supabase dashboard, go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (looks like: `https://your-project.supabase.co`)
   - **anon public** key
   - **service_role** key (keep this secret!)

## Step 3: Run the Complete Migration

1. In your Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy the entire content from `supabase/migrations/20250803000001_complete_schema.sql`
4. Paste it into the SQL editor
5. Click **Run** to execute the migration

## Step 4: Verify Migration Success

After running the migration, you should see a success message with:
- Tables created: 3
- Policies created: 8
- Triggers created: 3

## Step 5: Configure Environment Variables

Update your `.env` file with your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

## Step 6: Test the Setup

1. Start your application
2. Try to sign up with a new account
3. Verify that:
   - User profile is created automatically
   - You can access the dashboard
   - API keys can be managed
   - Article generation works

## Troubleshooting

### Migration Fails
- Make sure you're running the migration in the correct project
- Check that you have admin privileges
- Try running the migration in smaller chunks if needed

### User Profile Not Created
- Check the Supabase logs in **Logs** → **Database**
- Verify the trigger function exists
- Ensure RLS policies are properly set

### API Access Issues
- Verify your environment variables are correct
- Check that the anon key is properly set
- Ensure the service role key is kept secure

## Security Notes

1. **Never expose the service_role key** in client-side code
2. **Keep your database password secure**
3. **Monitor your API usage** to stay within free tier limits
4. **Regularly backup your data** if needed

## Database Schema Overview

The migration creates three main tables:

### `users`
- Stores user profiles linked to Supabase Auth
- Contains webhook tokens for API access
- Automatically created when users sign up

### `api_keys`
- Manages API keys for external services
- Tracks usage and failure counts
- Supports multiple providers (Apify, Moz, etc.)

### `analysis_logs`
- Logs all article generation requests
- Stores results and processing metrics
- Enables analytics and debugging

## Next Steps

1. Configure your application to use the new Supabase project
2. Test all features thoroughly
3. Set up monitoring and alerts if needed
4. Consider setting up automated backups

## Support

If you encounter issues:
1. Check the Supabase documentation
2. Review the migration logs
3. Verify your environment configuration
4. Test with a fresh project if needed
