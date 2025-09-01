import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Search, 
  Bookmark, 
  BarChart3, 
  TrendingUp, 
  Clock,
  MapPin, 
  Building,
  ExternalLink,
  Key,
  Webhook
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

interface DashboardStats {
  totalProfiles: number;
  totalScraped: number;
  totalSaved: number;
  recentActivity: any[];
  topCompanies: { company: string; count: number }[];
  topLocations: { location: string; count: number }[];
}

export const DashboardOverview: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalProfiles: 0,
    totalScraped: 0,
    totalSaved: 0,
    recentActivity: [],
    topCompanies: [],
    topLocations: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadDashboardStats();
    }
  }, [user]);

  const loadDashboardStats = async () => {
    try {
      setLoading(true);

      // Get user's saved profiles count
      const { data: savedProfiles, error: savedError } = await supabase
        .rpc('get_user_saved_profiles', { user_uuid: user?.id });

      if (savedError) throw savedError;

      // Get scraping logs
      const { data: scrapingLogs, error: logsError } = await supabase
        .from('scraping_logs')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (logsError) throw logsError;

      // Calculate statistics
      const totalSaved = savedProfiles?.length || 0;
      const totalScraped = scrapingLogs?.reduce((sum, log) => sum + (log.profiles_scraped || 0), 0) || 0;

      // Get top companies and locations from saved profiles
      const companies = savedProfiles?.reduce((acc: any, profile: any) => {
        if (profile.company) {
          acc[profile.company] = (acc[profile.company] || 0) + 1;
        }
        return acc;
      }, {}) || {};

      const locations = savedProfiles?.reduce((acc: any, profile: any) => {
        if (profile.location) {
          acc[profile.location] = (acc[profile.location] || 0) + 1;
        }
        return acc;
      }, {}) || {};

      const topCompanies = Object.entries(companies)
        .map(([company, count]) => ({ company, count: count as number }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const topLocations = Object.entries(locations)
        .map(([location, count]) => ({ location, count: count as number }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setStats({
        totalProfiles: totalSaved + totalScraped,
        totalScraped,
        totalSaved,
        recentActivity: scrapingLogs || [],
        topCompanies,
        topLocations
      });
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const navigateToSection = (section: string) => {
    window.dispatchEvent(new CustomEvent('navigateToSection', { detail: section }));
  };

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-4">
              <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
              </div>
            <p className="text-gray-600">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back, {user?.full_name}!</h1>
        <p className="text-gray-600">
          Here's an overview of your LinkedIn scraping activity and saved profiles.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <button
          onClick={() => navigateToSection('scraper')}
          className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 transform hover:scale-105"
        >
          <div className="flex items-center">
            <Search className="w-8 h-8 mr-4" />
            <div className="text-left">
              <h3 className="text-lg font-semibold">Start Scraping</h3>
              <p className="text-blue-100">Scrape new LinkedIn profiles</p>
            </div>
          </div>
        </button>
                    
                    <button 
          onClick={() => navigateToSection('profiles')}
          className="bg-gradient-to-r from-green-600 to-green-700 text-white p-6 rounded-lg hover:from-green-700 hover:to-green-800 transition-all duration-200 transform hover:scale-105"
        >
          <div className="flex items-center">
            <Bookmark className="w-8 h-8 mr-4" />
            <div className="text-left">
              <h3 className="text-lg font-semibold">My Profiles</h3>
              <p className="text-green-100">View saved profiles</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => navigateToSection('analytics')}
          className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-6 rounded-lg hover:from-purple-700 hover:to-purple-800 transition-all duration-200 transform hover:scale-105"
        >
          <div className="flex items-center">
            <BarChart3 className="w-8 h-8 mr-4" />
            <div className="text-left">
              <h3 className="text-lg font-semibold">Analytics</h3>
              <p className="text-purple-100">View detailed insights</p>
            </div>
          </div>
        </button>
        </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Profiles</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalProfiles}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <Search className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Profiles Scraped</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalScraped}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Bookmark className="w-6 h-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Saved Profiles</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalSaved}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-2 bg-orange-100 rounded-lg">
              <TrendingUp className="w-6 h-6 text-orange-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Success Rate</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats.totalScraped > 0 ? Math.round((stats.totalSaved / stats.totalScraped) * 100) : 0}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity and Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
          {stats.recentActivity.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No recent scraping activity</p>
              <button
                onClick={() => navigateToSection('scraper')}
                className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
              >
                Start your first scraping session
              </button>
        </div>
          ) : (
            <div className="space-y-4">
              {stats.recentActivity.map((activity, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <Search className="w-4 h-4 text-blue-600 mr-3" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Scraped {activity.profiles_scraped || 0} profiles
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(activity.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    activity.status === 'completed' 
                      ? 'bg-green-100 text-green-800' 
                      : activity.status === 'failed'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {activity.status}
                    </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Companies */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Companies</h3>
          {stats.topCompanies.length === 0 ? (
            <div className="text-center py-8">
              <Building className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No company data yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stats.topCompanies.map((company, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="text-sm font-medium text-gray-900">{company.company}</span>
                  </div>
                  <span className="text-sm text-gray-600">{company.count} profiles</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Setup */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">Quick Setup</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => navigateToSection('api-keys')}
            className="flex items-center p-3 bg-white rounded-lg border border-blue-200 hover:border-blue-300 transition-colors duration-200"
          >
            <Key className="w-5 h-5 text-blue-600 mr-3" />
            <span className="text-sm font-medium text-blue-900">Add API Keys</span>
          </button>
          
          <button
            onClick={() => navigateToSection('webhook')}
            className="flex items-center p-3 bg-white rounded-lg border border-blue-200 hover:border-blue-300 transition-colors duration-200"
          >
            <Webhook className="w-5 h-5 text-blue-600 mr-3" />
            <span className="text-sm font-medium text-blue-900">Configure Webhook</span>
          </button>
          
          <button
            onClick={() => navigateToSection('scraper')}
            className="flex items-center p-3 bg-white rounded-lg border border-blue-200 hover:border-blue-300 transition-colors duration-200"
          >
            <Search className="w-5 h-5 text-blue-600 mr-3" />
            <span className="text-sm font-medium text-blue-900">Start Scraping</span>
          </button>
        </div>
      </div>
    </div>
  );
};