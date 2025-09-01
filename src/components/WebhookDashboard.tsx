import React, { useState } from 'react';
import { 
  Copy, 
  CheckCircle,
  BookOpen,
  Key,
  Code,
  Zap
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export const WebhookDashboard: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const { user } = useAuth();

  const baseUrl = import.meta.env.VITE_API_BASE_URL || 'https://your-domain.com';
  const authToken = user?.webhook_token || '';

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Webhook API</h1>
        <p className="text-gray-600">
          Integrate LinkedIn Scraper with external services using our powerful webhook API.
        </p>
      </div>

      {/* Authentication Section */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-6 mb-8">
        <div className="flex items-center mb-4">
          <Key className="w-6 h-6 text-blue-600 mr-3" />
          <h2 className="text-xl font-semibold text-gray-900">Authentication</h2>
          </div>
          
          <div className="space-y-4">
          {/* Base URL */}
            <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Base API URL</label>
              <div className="flex">
                <input
                  type="text"
                value={baseUrl}
                  readOnly
                className="flex-1 px-4 py-3 border border-gray-300 rounded-l-lg bg-white text-sm font-mono"
                />
                <button
                onClick={() => copyToClipboard(baseUrl, 'base-url')}
                className="px-4 py-3 bg-gray-600 text-white rounded-r-lg hover:bg-gray-700 transition-colors duration-200 flex items-center"
                >
                {copied === 'base-url' ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
            </div>
            {!import.meta.env.VITE_API_BASE_URL && (
              <p className="text-sm text-yellow-600 mt-1">
                Set <code className="bg-yellow-100 px-2 py-1 rounded">VITE_API_BASE_URL</code> in your environment variables
              </p>
            )}
            </div>

          {/* Auth Token */}
            <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Authentication Token</label>
              <div className="flex">
                <input
                  type="text"
                value={authToken}
                  readOnly
                className="flex-1 px-4 py-3 border border-gray-300 rounded-l-lg bg-white text-sm font-mono"
              />
              <button
                onClick={() => copyToClipboard(authToken, 'auth-token')}
                className="px-4 py-3 bg-blue-600 text-white rounded-r-lg hover:bg-blue-700 transition-colors duration-200 flex items-center"
              >
                {copied === 'auth-token' ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-sm text-gray-600 mt-2">
              Include this token in the Authorization header: <code className="bg-gray-100 px-2 py-1 rounded">Authorization: Bearer {authToken}</code>
            </p>
            </div>
          </div>
        </div>

      

      {/* Complete HTTP Request Examples */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
        <div className="flex items-center mb-6">
          <Code className="w-6 h-6 text-gray-600 mr-3" />
          <h2 className="text-xl font-semibold text-gray-900">Complete HTTP Request Examples</h2>
        </div>
        
        <div className="space-y-6">
          {/* Profile Details Example */}
          <div>
            <h3 className="font-medium text-gray-900 mb-3">Profile Details Scraper - cURL</h3>
            <div className="bg-gray-900 rounded-lg p-4">
              <pre className="text-green-400 text-sm overflow-x-auto">
{`curl -X POST "${baseUrl}/api/scrape-linkedin" \\
  -H "Authorization: Bearer ${authToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "profileUrls": [
      "https://www.linkedin.com/in/username1",
      "https://www.linkedin.com/in/username2"
    ]
  }'`}
              </pre>
            </div>
          </div>

          {/* Post Comments Example */}
          <div>
            <h3 className="font-medium text-gray-900 mb-3">Post Comments Scraper - cURL</h3>
            <div className="bg-gray-900 rounded-lg p-4">
              <pre className="text-green-400 text-sm overflow-x-auto">
{`curl -X POST "${baseUrl}/api/scrape-post-comments" \\
  -H "Authorization: Bearer ${authToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "postUrls": [
      "https://www.linkedin.com/posts/username_post-id"
    ],
    "scrapingType": "post-comments"
  }'`}
              </pre>
            </div>
          </div>

          {/* Mixed Scraper Example */}
          <div>
            <h3 className="font-medium text-gray-900 mb-3">Mixed Scraper - cURL</h3>
            <div className="bg-gray-900 rounded-lg p-4">
              <pre className="text-green-400 text-sm overflow-x-auto">
{`curl -X POST "${baseUrl}/api/scrape-mixed" \\
  -H "Authorization: Bearer ${authToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "postUrls": [
      "https://www.linkedin.com/posts/username_post-id"
    ]
  }'`}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Response Format */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
        <div className="flex items-center mb-4">
          <BookOpen className="w-6 h-6 text-gray-600 mr-3" />
          <h2 className="text-xl font-semibold text-gray-900">Response Format</h2>
        </div>
        
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Success Response</h3>
            <div className="bg-gray-50 rounded-lg p-4">
              <pre className="text-sm text-gray-700 overflow-x-auto">
{`{
  "request_id": "uuid",
  "post_urls": ["https://www.linkedin.com/posts/..."],
  "total_profiles_processed": 15,
  "profiles_from_database": 5,
  "profiles_scraped": 10,
  "profiles_failed": 0,
  "processing_time": 120000,
  "profiles": [
    {
      "id": "uuid",
      "linkedin_url": "https://www.linkedin.com/in/username",
      "full_name": "John Doe",
      "headline": "Software Engineer at Tech Corp",
      "connections": 500,
      "followers": 1200,
      "email": "john@example.com",
      "company_name": "Tech Corp",
      "location": "San Francisco, CA",
      "about": "Experienced software engineer...",
      "experiences": [...],
      "educations": [...],
      "skills": [...],
      "scraped_at": "2025-01-03T10:30:00Z"
    }
  ],
  "status": "completed"
}`}
              </pre>
            </div>
          </div>

          <div>
            <h3 className="font-medium text-gray-900 mb-2">Error Response</h3>
            <div className="bg-red-50 rounded-lg p-4">
              <pre className="text-sm text-red-700 overflow-x-auto">
{`{
  "error": "Invalid request",
  "message": "At least one LinkedIn post URL is required"
}`}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Integration Guides */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center mb-4">
          <Zap className="w-6 h-6 text-gray-600 mr-3" />
          <h2 className="text-xl font-semibold text-gray-900">Integration Guides</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-900 mb-2">Make.com Integration</h3>
            <p className="text-sm text-gray-600 mb-3">
              Use our HTTP module to integrate with Make.com workflows.
            </p>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Add HTTP module</li>
              <li>• Set method to POST</li>
              <li>• Add Authorization header</li>
              <li>• Configure request body</li>
            </ul>
          </div>

          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-900 mb-2">Zapier Integration</h3>
            <p className="text-sm text-gray-600 mb-3">
              Connect LinkedIn Scraper to your Zapier automations.
            </p>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Use Webhooks by Zapier</li>
              <li>• Choose POST method</li>
              <li>• Add custom headers</li>
              <li>• Map your data fields</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};