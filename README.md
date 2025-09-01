# LinkedIn Scraper

A modern React application for scraping LinkedIn posts, profiles, and comments using Apify actors. Built with TypeScript, Tailwind CSS, and Supabase.

## 🚀 Features

- **Post Comments Scraping**: Extract all commenters from LinkedIn posts
- **Profile Details Scraping**: Get complete LinkedIn profile information
- **Mixed Scraping**: Scrape post comments and then extract full profile details
- **User Authentication**: Secure login system with Supabase
- **API Key Management**: Rotate and manage multiple Apify API keys
- **Real-time Progress**: Track scraping progress with live updates
- **Profile Storage**: Save and manage scraped profiles
- **Export Options**: Download data in CSV, JSON, and Excel formats

## 🛠️ Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Backend**: Supabase (Database + Auth)
- **Deployment**: Netlify (Static Site Hosting)

## 📋 Prerequisites

- Node.js 18+ 
- npm 8+
- Supabase account and project
- Apify account with API keys

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd linkedin-scraper
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Setup
Copy `env.example` to `.env.local` and fill in your credentials:
```bash
cp env.example .env.local
```

Required environment variables:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
VITE_API_BASE_URL=https://your-domain.com
```

### 4. Development
```bash
npm run dev
```

### 5. Build for Production
```bash
npm run build
```

## 🌐 Deployment to Netlify

### Option 1: Deploy via Netlify UI

1. **Build the Project**
   ```bash
   npm run build
   ```

2. **Deploy to Netlify**
   - Go to [netlify.com](https://netlify.com)
   - Drag and drop the `dist` folder to deploy
   - Or connect your GitHub repository for automatic deployments

3. **Set Environment Variables**
   - In Netlify dashboard, go to Site Settings > Environment Variables
   - Add your credentials:
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `VITE_API_BASE_URL`

### Option 2: Deploy via Git (Recommended)

1. **Push to GitHub**
```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Connect to Netlify**
   - Connect your GitHub repository in Netlify
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Set environment variables as above

3. **Automatic Deployments**
   - Every push to main branch will trigger a new deployment
   - Preview deployments for pull requests

## 🔧 Configuration

### Netlify Configuration
The `netlify.toml` file is pre-configured with:
- Build settings
- Redirects for SPA routing
- Security headers
- Cache optimization

### Vite Configuration
Optimized for production with:
- Code splitting
- Chunk optimization
- Asset optimization

## 📁 Project Structure

```
src/
├── components/          # React components
│   ├── LinkedInScraper.tsx
│   ├── SavedProfiles.tsx
│   ├── ApiKeyManager.tsx
│   ├── Dashboard.tsx
│   ├── AuthProvider.tsx
│   └── ...
├── hooks/              # Custom React hooks
├── lib/                # Utility libraries
│   └── supabase.ts     # Supabase client
└── main.tsx           # App entry point
```

## 🔒 Security Features

- Content Security Policy (CSP) headers
- XSS protection
- Frame options
- Secure referrer policy
- Rate limiting (if using server functions)

## 📊 Performance

- Code splitting for optimal loading
- Lazy loading of components
- Optimized bundle sizes
- CDN-ready static assets

## 🐛 Troubleshooting

### Build Issues
```bash
# Clean and rebuild
npm run clean
npm run build

# Check for TypeScript errors
npm run type-check
```

### Environment Variables
- Ensure all required Supabase variables are set
- Check Netlify environment variables in dashboard
- Verify variable names start with `VITE_`

### Supabase Issues
- Verify project URL and API keys
- Check RLS policies
- Ensure database migrations are applied

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📞 Support

For support and questions:
- Check the documentation
- Review Supabase setup guide
- Open an issue on GitHub

---

**Ready for Production**: This app is optimized and ready for deployment on Netlify with all necessary configurations in place.