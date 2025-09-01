# Article Generator API - Deployment Guide

## Deploying on Render

### 1. Prerequisites
- Node.js 18+ 
- npm or yarn
- Supabase project with API keys
- OpenRouter API keys

### 2. Environment Variables
Set these environment variables in your Render dashboard:

```
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
OPENROUTER_REFERER=https://your-app.com
OPENROUTER_TITLE=Article Generator
NODE_ENV=production
```

### 3. Build & Deploy Commands
- **Build Command**: `npm install`
- **Start Command**: `npm start`

### 4. Health Check
The API includes a health check endpoint at `/health` for monitoring.

### 5. Available Endpoints
- `POST /api/generate-article` - Main article generation
- `POST /api/generate-article-background` - Background processing
- `GET /health` - Health check
- `GET /api/test` - API information

### 6. CORS Configuration
The API is configured to allow:
- localhost (development)
- netlify.app domains
- Custom domains (configure in CORS settings)

### 7. Troubleshooting
- Check Render logs for any startup errors
- Ensure all environment variables are set
- Verify Supabase connection
- Check API key validity

### 8. Performance
- API includes rate limiting (60 requests/minute)
- Smart API key rotation system
- Graceful error handling
- Process management for production deployment
