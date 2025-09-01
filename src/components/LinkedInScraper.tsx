import React, { useState } from 'react';
import { Search, Users, AlertCircle, CheckCircle, Loader2, ExternalLink, Copy, Save, MessageSquare, UserCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

interface LinkedInScraperProps {
  onSuccess?: () => void;
}

type ScrapingType = 'post-comments' | 'profile-details' | 'mixed';

interface ScrapedProfile {
  id: string;
  profile_url: string;
  full_name: string;
  headline: string;
  location: string;
  industry: string;
  company: string;
  job_title?: string;
  experience: any[];
  education: any[];
  skills: string[];
  about: string;
  email: string;
  phone: string;
  website: string;
  linkedin_url: string;
  profile_image_url: string;
  connection_count: number;
  follower_count: number;
  scraped_at: string;
}

interface CommentData {
  id: string;
  linkedinUrl: string;
  commentary: string;
  createdAt: string;
  createdAtTimestamp: number;
  engagement: {
    likes: number;
    comments: number;
    shares: number;
    impressions: number;
    reactions: Array<{
      type: string;
      count: number;
    }>;
  };
  postId: string;
  pinned: boolean;
  contributed: boolean;
  edited: boolean;
  actor: {
    id: string;
    name: string;
    linkedinUrl: string;
    position: string;
    pictureUrl: string;
    picture: {
      url: string;
      width: number;
      height: number;
      expiresAt: number;
    };
    author: boolean;
  };
  query: {
    post: string;
  };
}

export const LinkedInScraper: React.FC<LinkedInScraperProps> = ({ onSuccess }) => {
  const { user } = useAuth();
  const [scrapingType, setScrapingType] = useState<ScrapingType>('post-comments');
  const [postUrls, setPostUrls] = useState<string>('');
  const [profileUrls, setProfileUrls] = useState<string>('');
  const [isScraping, setIsScraping] = useState(false);
  const [scrapedProfiles, setScrapedProfiles] = useState<ScrapedProfile[]>([]);
  const [commentData, setCommentData] = useState<CommentData[]>([]);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const handleScrape = async () => {
    let urls: string[] = [];
    let inputType = '';

    // Validate input based on scraping type
    if (scrapingType === 'post-comments' || scrapingType === 'mixed') {
      if (!postUrls.trim()) {
        setError('Please enter at least one LinkedIn post URL');
        return;
      }
      urls = postUrls
        .split('\n')
        .map(url => url.trim())
        .filter(url => url && url.includes('linkedin.com/posts/'));
      inputType = 'post';
    }

    if (scrapingType === 'profile-details') {
    if (!profileUrls.trim()) {
      setError('Please enter at least one LinkedIn profile URL');
      return;
    }
      urls = profileUrls
      .split('\n')
      .map(url => url.trim())
      .filter(url => url && url.includes('linkedin.com/in/'));
      inputType = 'profile';
    }

    // Mixed scraper only uses post URLs (no additional profile URLs needed)

    if (urls.length === 0) {
      setError(`Please enter valid LinkedIn ${inputType} URLs`);
      return;
    }

    setIsScraping(true);
    setError('');
    setSuccess('');

    try {
      // Call the appropriate backend API based on scraping type
      let endpoint, body;
      
      if (scrapingType === 'profile-details') {
        endpoint = '/api/scrape-linkedin';
        body = { profileUrls: urls };
      } else if (scrapingType === 'post-comments') {
        endpoint = '/api/scrape-post-comments';
        body = { postUrls: urls, scrapingType };
      } else if (scrapingType === 'mixed') {
        endpoint = '/api/scrape-mixed';
        body = { 
          postUrls: postUrls.split('\n').map(url => url.trim()).filter(url => url && url.includes('linkedin.com/posts/'))
        };
      }

      const response = await fetch(endpoint!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user?.webhook_token}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to start scraping');
      }

      setSuccess(`Scraping initiated for ${urls.length} ${inputType}(s). Check the results below.`);
      
      // Handle different response types
      if (data.profiles && data.profiles.length > 0) {
        setScrapedProfiles(data.profiles);
      }
      if (data.comments && data.comments.length > 0) {
        setCommentData(data.comments);
      }

      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during scraping');
    } finally {
      setIsScraping(false);
    }
  };

  const handleSaveProfile = async (profile: ScrapedProfile) => {
    try {
      const { error } = await supabase
        .from('user_saved_profiles')
        .insert({
          user_id: user?.id,
          profile_id: profile.id
        });

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          setError('Profile already saved');
        } else {
          throw error;
        }
      } else {
        setSuccess('Profile saved successfully!');
      }
    } catch (err) {
      setError('Failed to save profile');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
  };

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">LinkedIn Scraper</h1>
        <p className="text-gray-600">
          Scrape LinkedIn posts, profiles, or both using our advanced scraping technology. Choose your scraping type below.
        </p>
      </div>

      {/* Error and Success Messages */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-red-800">{error}</p>
            <button onClick={clearMessages} className="text-red-600 hover:text-red-800 text-sm mt-1">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start">
          <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-green-800">{success}</p>
            <button onClick={clearMessages} className="text-green-600 hover:text-green-800 text-sm mt-1">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Scraping Type Selection */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Scraping Type</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <button
            onClick={() => setScrapingType('post-comments')}
            className={`p-4 rounded-lg border-2 transition-all duration-200 ${
              scrapingType === 'post-comments'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex flex-col items-center text-center">
              <MessageSquare className={`w-8 h-8 mb-2 ${
                scrapingType === 'post-comments' ? 'text-blue-600' : 'text-gray-400'
              }`} />
              <h3 className="font-semibold text-gray-900">Post Comments</h3>
              <p className="text-sm text-gray-600">Scrape post engagers</p>
            </div>
          </button>

          <button
            onClick={() => setScrapingType('profile-details')}
            className={`p-4 rounded-lg border-2 transition-all duration-200 ${
              scrapingType === 'profile-details'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex flex-col items-center text-center">
              <UserCheck className={`w-8 h-8 mb-2 ${
                scrapingType === 'profile-details' ? 'text-blue-600' : 'text-gray-400'
              }`} />
              <h3 className="font-semibold text-gray-900">Profile Details</h3>
              <p className="text-sm text-gray-600">Scrape profile info</p>
            </div>
          </button>

          <button
            onClick={() => setScrapingType('mixed')}
            className={`p-4 rounded-lg border-2 transition-all duration-200 ${
              scrapingType === 'mixed'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex flex-col items-center text-center">
              <Users className={`w-8 h-8 mb-2 ${
                scrapingType === 'mixed' ? 'text-blue-600' : 'text-gray-400'
              }`} />
              <h3 className="font-semibold text-gray-900">Mixed</h3>
              <p className="text-sm text-gray-600">Post + Profiles</p>
            </div>
          </button>
        </div>

        {/* URL Input Section */}
        {(scrapingType === 'post-comments' || scrapingType === 'mixed') && (
          <div className="mb-4">
            <label htmlFor="postUrls" className="block text-sm font-medium text-gray-700 mb-2">
              LinkedIn Post URLs (one per line)
            </label>
            <textarea
              id="postUrls"
              value={postUrls}
              onChange={(e) => setPostUrls(e.target.value)}
              placeholder="https://www.linkedin.com/posts/..."
              className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isScraping}
            />
            <p className="text-sm text-gray-500 mt-1">
              Enter one LinkedIn post URL per line. Maximum 10 posts per request.
            </p>
          </div>
        )}

        {scrapingType === 'profile-details' && (
        <div className="mb-4">
          <label htmlFor="profileUrls" className="block text-sm font-medium text-gray-700 mb-2">
            LinkedIn Profile URLs (one per line)
          </label>
          <textarea
            id="profileUrls"
            value={profileUrls}
            onChange={(e) => setProfileUrls(e.target.value)}
            placeholder="https://linkedin.com/in/username1&#10;https://linkedin.com/in/username2&#10;https://linkedin.com/in/username3"
            className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isScraping}
          />
          <p className="text-sm text-gray-500 mt-1">
            Enter one LinkedIn profile URL per line. Maximum 10 profiles per request.
          </p>
        </div>
        )}

        <button
          onClick={handleScrape}
          disabled={isScraping || (scrapingType === 'mixed' ? !postUrls.trim() : (!postUrls.trim() && !profileUrls.trim()))}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
        >
          {isScraping ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Scraping...
            </>
          ) : (
            <>
              <Search className="w-4 h-4 mr-2" />
              Start Scraping
            </>
          )}
        </button>
      </div>

      {/* Comment Results Section */}
      {commentData.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Post Comments ({commentData.length})</h2>
          
          <div className="space-y-4">
            {commentData.map((comment, index) => (
              <div key={comment.id || index} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-start space-x-3">
                  {comment.actor?.pictureUrl && (
                    <img
                      src={comment.actor.pictureUrl}
                      alt={comment.actor.name}
                      className="w-10 h-10 rounded-full flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-2">
                      <h3 className="font-semibold text-gray-900 truncate">{comment.actor?.name}</h3>
                      <a
                        href={comment.actor?.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        View Profile
                      </a>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{comment.actor?.position}</p>
                    <p className="text-gray-800 mb-2">{comment.commentary}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span>{new Date(comment.createdAt).toLocaleDateString()}</span>
                      {comment.engagement?.likes > 0 && (
                        <span>{comment.engagement.likes} likes</span>
                      )}
                      {comment.engagement?.reactions && comment.engagement.reactions.length > 0 && (
                        <span>{comment.engagement.reactions.reduce((sum, r) => sum + r.count, 0)} reactions</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profile Results Section */}
      {scrapedProfiles.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Scraped Profiles</h2>
          
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {scrapedProfiles.map((profile) => (
              <div key={profile.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow duration-200">
                {/* Profile Header */}
                <div className="flex items-start mb-4">
                  {profile.profile_image_url && (
                    <img
                      src={profile.profile_image_url}
                      alt={profile.full_name}
                      className="w-12 h-12 rounded-full mr-3 flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{profile.full_name}</h3>
                    <p className="text-sm text-gray-600 truncate">{profile.headline}</p>
                    {profile.company && (
                      <p className="text-sm text-gray-500 truncate">{profile.company}</p>
                    )}
                  </div>
                </div>

                {/* Profile Details */}
                <div className="space-y-2 mb-4">
                  {profile.location && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Location:</span> {profile.location}
                    </p>
                  )}
                  {profile.industry && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Industry:</span> {profile.industry}
                    </p>
                  )}
                  {profile.connection_count && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Connections:</span> {profile.connection_count.toLocaleString()}
                    </p>
                  )}
                  {profile.email && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Email:</span> {profile.email}
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleSaveProfile(profile)}
                    className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
                  >
                    <Save className="w-3 h-3 mr-1" />
                    Save
                  </button>
                  <button
                    onClick={() => copyToClipboard(profile.profile_url)}
                    className="inline-flex items-center justify-center px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors duration-200"
                    title="Copy profile URL"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <a
                    href={profile.profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors duration-200"
                    title="Open profile"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">How it works</h3>
        <div className="space-y-2 text-sm text-blue-800">
          <p>• Enter LinkedIn profile URLs (one per line)</p>
          <p>• Our system will scrape detailed profile information</p>
          <p>• Save interesting profiles to your personal collection</p>
          <p>• View analytics and track your scraping history</p>
        </div>
      </div>
    </div>
  );
};
