import React, { useState, useEffect } from 'react';
import { Bookmark, ExternalLink, Copy, Trash2, Search, Filter, Users, MapPin, Building, Mail, Phone, Globe } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

interface SavedProfile {
  saved_profile_id: string;
  profile_id: string;
  profile_url: string;
  full_name: string;
  headline: string;
  company: string;
  job_title: string;
  location: string;
  profile_image_url: string;
  notes: string;
  tags: string[];
  saved_at: string;
  scraped_at: string;
}

export const SavedProfiles: React.FC = () => {
  const { user } = useAuth();
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [success, setSuccess] = useState<string>('');

  useEffect(() => {
    loadSavedProfiles();
  }, [user]);

  const loadSavedProfiles = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .rpc('get_user_saved_profiles', { user_uuid: user.id });

      if (error) {
        throw error;
      }

      setSavedProfiles(data || []);
    } catch (err) {
      setError('Failed to load saved profiles');
      console.error('Error loading saved profiles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveProfile = async (savedProfileId: string) => {
    try {
      const { error } = await supabase
        .from('user_saved_profiles')
        .delete()
        .eq('id', savedProfileId);

      if (error) {
        throw error;
      }

      setSavedProfiles(prev => prev.filter(profile => profile.saved_profile_id !== savedProfileId));
      setSuccess('Profile removed from saved list');
    } catch (err) {
      setError('Failed to remove profile');
    }
  };

  const handleUpdateNotes = async (savedProfileId: string, notes: string) => {
    try {
      const { error } = await supabase
        .from('user_saved_profiles')
        .update({ notes })
        .eq('id', savedProfileId);

      if (error) {
        throw error;
      }

      setSavedProfiles(prev => 
        prev.map(profile => 
          profile.saved_profile_id === savedProfileId 
            ? { ...profile, notes }
            : profile
        )
      );
      setSuccess('Notes updated successfully');
    } catch (err) {
      setError('Failed to update notes');
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

  // Filter profiles based on search and filters
  const filteredProfiles = savedProfiles.filter(profile => {
    const matchesSearch = !searchTerm || 
      profile.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.headline.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.company?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCompany = !filterCompany || 
      profile.company?.toLowerCase().includes(filterCompany.toLowerCase());
    
    const matchesLocation = !filterLocation || 
      profile.location?.toLowerCase().includes(filterLocation.toLowerCase());
    
    return matchesSearch && matchesCompany && matchesLocation;
  });

  // Get unique companies and locations for filter dropdowns
  const companies = [...new Set(savedProfiles.map(p => p.company).filter(Boolean))];
  const locations = [...new Set(savedProfiles.map(p => p.location).filter(Boolean))];

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-4">
              <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
            </div>
            <p className="text-gray-600">Loading your saved profiles...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">My Saved Profiles</h1>
        <p className="text-gray-600">
          View and manage your saved LinkedIn profiles. You have {savedProfiles.length} saved profile{savedProfiles.length !== 1 ? 's' : ''}.
        </p>
      </div>

      {/* Error and Success Messages */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start">
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
          <div className="flex-1">
            <p className="text-green-800">{success}</p>
            <button onClick={clearMessages} className="text-green-600 hover:text-green-800 text-sm mt-1">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search profiles..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Company</label>
            <select
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Companies</option>
              {companies.map(company => (
                <option key={company} value={company}>{company}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
            <select
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Locations</option>
              {locations.map(location => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-end">
            <button
              onClick={() => {
                setSearchTerm('');
                setFilterCompany('');
                setFilterLocation('');
              }}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors duration-200"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Profiles Grid */}
      {filteredProfiles.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Bookmark className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {savedProfiles.length === 0 ? 'No saved profiles yet' : 'No profiles match your filters'}
          </h3>
          <p className="text-gray-600">
            {savedProfiles.length === 0 
              ? 'Start scraping LinkedIn profiles to save them here for easy access.'
              : 'Try adjusting your search terms or filters.'
            }
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredProfiles.map((profile) => (
            <div key={profile.saved_profile_id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow duration-200">
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
                    <p className="text-sm text-gray-500 truncate flex items-center">
                      <Building className="w-3 h-3 mr-1" />
                      {profile.company}
                    </p>
                  )}
                </div>
              </div>

              {/* Profile Details */}
              <div className="space-y-2 mb-4">
                {profile.location && (
                  <p className="text-sm text-gray-600 flex items-center">
                    <MapPin className="w-3 h-3 mr-1" />
                    {profile.location}
                  </p>
                )}
                {profile.job_title && (
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Position:</span> {profile.job_title}
                  </p>
                )}
                <p className="text-sm text-gray-500">
                  Saved {new Date(profile.saved_at).toLocaleDateString()}
                </p>
              </div>

              {/* Notes Section */}
              <div className="mb-4">
                <textarea
                  value={profile.notes || ''}
                  onChange={(e) => handleUpdateNotes(profile.saved_profile_id, e.target.value)}
                  placeholder="Add notes about this profile..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  rows={2}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-2">
                <button
                  onClick={() => copyToClipboard(profile.profile_url)}
                  className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors duration-200"
                  title="Copy profile URL"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy URL
                </button>
                <a
                  href={profile.profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
                  title="Open profile"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  onClick={() => handleRemoveProfile(profile.saved_profile_id)}
                  className="inline-flex items-center justify-center px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors duration-200"
                  title="Remove from saved"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stats */}
      {savedProfiles.length > 0 && (
        <div className="mt-8 bg-gray-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{savedProfiles.length}</div>
              <div className="text-sm text-gray-600">Total Saved</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{companies.length}</div>
              <div className="text-sm text-gray-600">Companies</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{locations.length}</div>
              <div className="text-sm text-gray-600">Locations</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {new Date(Math.max(...savedProfiles.map(p => new Date(p.saved_at).getTime()))).toLocaleDateString()}
              </div>
              <div className="text-sm text-gray-600">Last Saved</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
