//formating fixed
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createClient } from '@supabase/supabase-js';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { v4 as uuidv4 } from 'uuid';

// Initialize Express app
const app = express();
app.use(helmet());

// Configure CORS for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Allow Netlify domains
    if (origin.includes('netlify.app')) {
      return callback(null, true);
    }
    
    // Allow your custom domain (replace with your actual domain)
    if (origin.includes('your-domain.com')) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// Serve static files from the React app build
app.use(express.static('dist'));

// Initialize Supabase (prefer Service Role key on the server)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Use service role key if available to allow secure server-side inserts/updates under RLS
export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
);

// Simple auth via webhook token (Bearer <token>)
export const authMiddleware = async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Missing token' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id')
      .eq('webhook_token', token)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
    }

    req.user = { id: user.id };
    next();
  } catch (err) {
    next(err);
  }
};

// Rate limiting
const rateLimiter = new RateLimiterMemory({ points: 60, duration: 60 }); // 60 req/min
export const rateLimitMiddleware = async (req, res, next) => {
  try {
    const key = req.user?.id || req.ip;
    await rateLimiter.consume(key);
    next();
  } catch {
    res.status(429).json({ error: 'Too Many Requests', message: 'Rate limit exceeded' });
  }
};

// 🚀 IMPROVED API Key Rotation & Reactivation Logic for Apify
// Priority-based initial assignment (active → rate_limited → failed) with runtime replacement system

// Smart key assignment - True Round-Robin with intelligent batch key recovery
async function getSmartKeyAssignment(supabase, userId, provider, requiredCount, failedKeysInRequest = new Set()) {
  console.log(`🔍 Smart Key Assignment: Need ${requiredCount} keys for user ${userId}`);
  
  // Get all keys for this provider
  const { data: allKeys } = await supabase
    .from('api_keys')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .order('last_used', { ascending: true, nullsFirst: true });

  if (!allKeys || allKeys.length === 0) {
    throw new Error(`No API keys found for provider: ${provider}`);
  }

  // 🔄 IMPROVED: Smart cooldown system that allows LRU rotation for potentially refreshed keys
  const COOLDOWN_MINUTES = 2; // Reduced from 5 to 2 minutes for faster rotation
  const now = new Date();
  
  // Separate keys by priority and filter out keys that failed in current request
  const activeKeys = allKeys.filter(key => key.status === 'active' && !failedKeysInRequest.has(key.id));
  
  // 🔑 RATE_LIMITED keys - ALWAYS test them for recovery (they might have new credits)
  const rateLimitedKeys = allKeys.filter(key => {
    if (key.status === 'rate_limited' && !failedKeysInRequest.has(key.id)) {
      // Always test rate_limited keys - they might have new credits or rate limit reset
      console.log(`🔄 Rate-limited key ${key.key_name} will be tested for recovery`);
      return true;
    }
    return false;
  });
  
  // 🔄 FAILED keys - implement proper LRU rotation for potentially refreshed keys
  const failedKeys = allKeys.filter(key => {
    if (key.status === 'failed' && !failedKeysInRequest.has(key.id)) {
      // 🔑 KEY INSIGHT: Failed keys might have new credits now - use LRU rotation
      if (key.last_failed) {
        const lastFailedTime = new Date(key.last_failed);
        const cooldownExpired = (now - lastFailedTime) > (COOLDOWN_MINUTES * 60 * 1000);
        
        // If cooldown expired, this key could work now (new credits, rate limit reset, etc.)
        if (cooldownExpired) {
          console.log(`🔄 Key ${key.key_name} cooldown expired - may have new credits/rate limit reset`);
          return true;
        }
      } else {
        // No last_failed time, can use
        return true;
      }
    }
    return false;
  });

  console.log(`🔑 Key Inventory: ${activeKeys.length} active, ${rateLimitedKeys.length} rate_limited, ${failedKeys.length} failed (excluding ${failedKeysInRequest.size} failed in current request)`);

  // 🎯 STRATEGY: If we have enough active keys, use them directly
  if (activeKeys.length >= requiredCount) {
    console.log(`✅ SUFFICIENT ACTIVE KEYS: ${activeKeys.length} active >= ${requiredCount} needed`);
    console.log(`🔄 Using Round-Robin distribution across ${activeKeys.length} active keys`);
    
    // Return keys in LRU order for round-robin distribution
    const selectedKeys = activeKeys.slice(0, requiredCount);
    console.log(`🎯 Round-Robin Assignment: ${selectedKeys.length} ACTIVE keys selected for distribution`);
    return selectedKeys;
  }

  // ⚠️ INSUFFICIENT ACTIVE KEYS: Check if we need to test failed keys
  const MIN_ACTIVE_KEYS_NEEDED = 3; // Only test if we have less than 3 active keys
  
  if (activeKeys.length >= MIN_ACTIVE_KEYS_NEEDED) {
    console.log(`✅ SUFFICIENT ACTIVE KEYS: ${activeKeys.length} active >= ${MIN_ACTIVE_KEYS_NEEDED} minimum needed`);
    console.log(`🔄 No need to test failed keys - using available active keys with rotation`);
    
    // Use available active keys with rotation (will cycle back as needed)
    const selectedKeys = activeKeys.slice(0, Math.min(requiredCount, activeKeys.length));
    console.log(`🎯 Using ${selectedKeys.length} active keys with rotation for ${requiredCount} operations`);
    return selectedKeys;
  }

  // 🔄 NEED TO TEST FAILED KEYS: Only when we have less than 3 active keys
  console.log(`⚠️ INSUFFICIENT ACTIVE KEYS: ${activeKeys.length} active < ${MIN_ACTIVE_KEYS_NEEDED} minimum needed`);
  console.log(`🔄 Testing rate-limited and failed keys in BATCH PARALLEL to increase active pool...`);

  // 🔄 BATCH PARALLEL TESTING: Test all keys at once instead of one by one
  let recoveredKeys = [];
  
  if (rateLimitedKeys.length > 0 || failedKeys.length > 0) {
    // Combine all keys that need testing
    const keysToTest = [...rateLimitedKeys, ...failedKeys];
    console.log(`🧪 BATCH TESTING: ${keysToTest.length} keys (${rateLimitedKeys.length} rate_limited + ${failedKeys.length} failed)`);
    
    // Test all keys in parallel using Promise.all for maximum speed
    const testPromises = keysToTest.map(async (key) => {
      try {
        const testResult = await testAndUpdateApiKey(supabase, key);
        return {
          key: key,
          success: testResult.success,
          status: testResult.key.status,
          keyName: key.key_name
        };
      } catch (error) {
        return {
          key: key,
          success: false,
          status: 'failed',
          keyName: key.key_name,
          error: error.message
        };
      }
    });
    
    // Wait for all tests to complete in parallel
    console.log(`⚡ Starting parallel testing of ${keysToTest.length} keys...`);
    const testResults = await Promise.all(testPromises);
    
    // Process results and categorize keys
    let newlyActive = 0;
    let stillRateLimited = 0;
    let stillFailed = 0;
    
    for (const result of testResults) {
      if (result.success && result.status === 'active') {
        recoveredKeys.push(result.key);
        newlyActive++;
        console.log(`✅ Key recovered: ${result.keyName} - now ACTIVE`);
      } else if (result.success && result.status === 'rate_limited') {
        stillRateLimited++;
        console.log(`⚠️ Key still rate limited: ${result.keyName}`);
      } else {
        stillFailed++;
        console.log(`❌ Key still failed: ${result.keyName}${result.error ? ` (${result.error})` : ''}`);
      }
    }
    
    console.log(`🔄 BATCH TESTING COMPLETED: ${newlyActive} recovered, ${stillRateLimited} still rate_limited, ${stillFailed} still failed`);
  }

  // 🔄 PHASE 3: Combine all available keys and distribute
  const allAvailableKeys = [...activeKeys, ...recoveredKeys];
  console.log(`🔑 Final Key Pool: ${allAvailableKeys.length} total available (${activeKeys.length} original + ${recoveredKeys.length} recovered)`);

  if (allAvailableKeys.length >= requiredCount) {
    // We have enough keys now - distribute them
    const selectedKeys = allAvailableKeys.slice(0, requiredCount);
    console.log(`🎯 SUCCESS: ${selectedKeys.length} keys selected for Round-Robin distribution`);
    console.log(`🔄 Keys will be distributed across ${requiredCount} operations`);
    return selectedKeys;
  } else {
    // Still not enough keys - use what we have with fallback
    console.log(`⚠️ WARNING: Only ${allAvailableKeys.length} keys available for ${requiredCount} operations`);
    console.log(`🔄 Will reuse keys across operations (not ideal but necessary)`);
    
    // If we have some keys, use them
    if (allAvailableKeys.length > 0) {
      return allAvailableKeys;
    }
    
    // No keys available at all
    console.log(`❌ No keys available for assignment`);
    return [];
  }
}

// Function to get replacement key when current key fails (prioritizes newly activated keys)
async function getReplacementKey(supabase, userId, provider, failedKeysInRequest = new Set(), recentlyActivatedKeys = new Set()) {
  // Get all keys for this provider
  const { data: allKeys } = await supabase
    .from('api_keys')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .order('last_used', { ascending: true, nullsFirst: true });

  if (!allKeys || allKeys.length === 0) {
    throw new Error(`No API keys found for provider: ${provider}`);
  }

  // 🔄 IMPROVED: Smart filtering that allows LRU rotation for potentially refreshed keys
  const COOLDOWN_MINUTES = 2; // Same cooldown as main function
  const now = new Date();
  
  // Separate keys by priority and filter out keys that failed in current request
  const activeKeys = allKeys.filter(key => key.status === 'active' && !failedKeysInRequest.has(key.id));
  
  // 🔑 RATE_LIMITED keys - check if they might have been refreshed
  const rateLimitedKeys = allKeys.filter(key => {
    if (key.status === 'rate_limited' && !failedKeysInRequest.has(key.id)) {
      // Allow rate_limited keys to be used if cooldown passed (they might have new credits)
      if (key.last_failed) {
        const lastFailedTime = new Date(key.last_failed);
        const cooldownExpired = (now - lastFailedTime) > (COOLDOWN_MINUTES * 60 * 1000);
        return cooldownExpired;
      }
      return true; // No last_failed time, can use
    }
    return false;
  });
  
  // 🔄 FAILED keys - implement proper LRU rotation for potentially refreshed keys
  const failedKeys = allKeys.filter(key => {
    if (key.status === 'failed' && !failedKeysInRequest.has(key.id)) {
      // 🔑 KEY INSIGHT: Failed keys might have new credits now - use LRU rotation
      if (key.last_failed) {
        const lastFailedTime = new Date(key.last_failed);
        const cooldownExpired = (now - lastFailedTime) > (COOLDOWN_MINUTES * 60 * 1000);
        
        // If cooldown expired, this key could work now (new credits, rate limit reset, etc.)
        if (cooldownExpired) {
          console.log(`🔄 Replacement: Key ${key.key_name} cooldown expired - may have new credits/rate limit reset`);
          return true;
        }
      } else {
        // No last_failed time, can use
        return true;
      }
    }
    return false;
  });

  console.log(`🔄 Replacement Key Search: ${activeKeys.length} active, ${rateLimitedKeys.length} rate_limited, ${failedKeys.length} failed available`);

  // 🚀 PRIORITY 1: Recently activated keys (highest priority)
  const recentlyActivated = activeKeys.filter(key => recentlyActivatedKeys.has(key.id));
  if (recentlyActivated.length > 0) {
    const replacementKey = recentlyActivated[0]; // Get least recently used recently activated key
    console.log(`🚀 Found replacement: Recently activated key ${replacementKey.key_name} (highest priority)`);
    return replacementKey;
  }

  // ✅ PRIORITY 2: Other active keys (least recently used first)
  const otherActiveKeys = activeKeys.filter(key => !recentlyActivatedKeys.has(key.id));
  if (otherActiveKeys.length > 0) {
    const replacementKey = otherActiveKeys[0]; // Already sorted by LRU
    console.log(`✅ Found replacement: Active key ${replacementKey.key_name}`);
    return replacementKey;
  }

  // ⚠️ PRIORITY 3: Rate-limited keys (least recently used first)
  if (rateLimitedKeys.length > 0) {
    const replacementKey = rateLimitedKeys[0]; // Already sorted by LRU
    console.log(`⚠️ Found replacement: Rate-limited key ${replacementKey.key_name}`);
    return replacementKey;
  }

  // 🔴 PRIORITY 4: Failed keys (least recently used first) - IMPROVED LRU rotation
  if (failedKeys.length > 0) {
    const replacementKey = failedKeys[0]; // Already sorted by LRU
    console.log(`🔴 Found replacement: Failed key ${replacementKey.key_name}`);
    console.log(`🔄 Using LRU rotation - this key may have new credits or rate limit reset`);
    return replacementKey;
  }

  throw new Error('No replacement keys available');
}

// Test a single API key and update its status
async function testAndUpdateApiKey(supabase, key) {
  try {
    console.log(`🧪 Testing key: ${key.key_name} (current status: ${key.status})`);
    
    // Test Apify API key by making a simple request
    const testResponse = await fetch('https://api.apify.com/v2/users/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key.api_key}`,
        'Content-Type': 'application/json'
      }
    });

    if (testResponse.ok) {
      // Key works - mark as active regardless of previous status
      await supabase.from('api_keys').update({
        last_used: new Date().toISOString(),
        status: 'active',
        failure_count: 0
      }).eq('id', key.id);

      console.log(`✅ Key ${key.key_name} is now ACTIVE`);
      return { success: true, key: { ...key, status: 'active' } };
      
    } else if (testResponse.status === 429) {
      // Rate limited - mark as rate_limited
      await supabase.from('api_keys').update({
        status: 'rate_limited',
        last_failed: new Date().toISOString()
      }).eq('id', key.id);

      console.log(`⏳ Key ${key.key_name} is RATE_LIMITED`);
      return { success: false, key: { ...key, status: 'rate_limited' } };
      
    } else {
      // Other error - mark as failed
      await supabase.from('api_keys').update({
        status: 'failed',
        last_failed: new Date().toISOString()
      }).eq('id', key.id);

      console.log(`❌ Key ${key.key_name} is FAILED (HTTP ${testResponse.status})`);
      return { success: false, key: { ...key, status: 'failed' } };
    }
    
  } catch (error) {
    // Network/other error - mark as failed
    await supabase.from('api_keys').update({
      status: 'failed',
      last_failed: new Date().toISOString()
    }).eq('id', key.id);

    console.log(`❌ Key ${key.key_name} is FAILED (error: ${error.message})`);
    return { success: false, key: { ...key, status: 'failed' } };
  }
}

// Function to call Apify API with smart key rotation
async function callApifyAPI(endpoint, apiKey, options = {}) {
  const { method = 'GET', body = null, timeoutMs = 30000 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log(`🤖 Calling Apify API: ${endpoint}`);
    
    const response = await fetch(`https://api.apify.com/v2/${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : null,
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Apify API error:`, errorText);
      
      if (response.status === 401) {
        throw new Error('Invalid API key');
      } else if (response.status === 429) {
          throw new Error('Rate limited - please try again later');
      } else if (response.status === 402) {
        throw new Error('Insufficient credits');
      } else {
        throw new Error(`Apify API error: ${response.status} - ${errorText}`);
      }
    }

    const data = await response.json();
    console.log(`✅ Apify API call successful`);
    return data;

  } catch (error) {
    console.error(`❌ Error with Apify API:`, error.message);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Main LinkedIn scraping endpoint
app.post('/api/scrape-linkedin', rateLimitMiddleware, authMiddleware, async (req, res) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  // Track keys that failed during this request to prevent reuse
  const failedKeysInRequest = new Set();
  
  try {
    const { profileUrls } = req.body;
    
    if (!profileUrls || !Array.isArray(profileUrls) || profileUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'profileUrls array is required' 
      });
    }

    // Validate and sanitize profile URLs
    const validUrls = profileUrls
      .map(url => url.trim())
      .filter(url => url && url.includes('linkedin.com/in/'))
      .slice(0, 10); // Limit to 10 profiles per request

    if (validUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'No valid LinkedIn profile URLs provided' 
      });
    }

    // Log the request
    try {
      await supabase.from('scraping_logs').insert({
        user_id: req.user.id,
        request_id: requestId,
        profile_urls: validUrls,
        status: 'pending'
      });
    } catch (dbError) {
      console.warn('⚠️ Failed to log request to database:', dbError.message);
      // Continue with scraping even if logging fails
    }

    // 🚀 IMPROVED: Use the new smart key assignment system
    console.log(`🔍 Looking for API keys for user: ${req.user.id}`);
    
    // Track keys that become active during scraping
    const recentlyActivatedKeys = new Set();
    
    // Get Apify keys for scraping
    const selectedKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', 1, failedKeysInRequest);
    
    if (!selectedKeys || selectedKeys.length === 0) {
      console.log(`❌ No API keys available for user ${req.user.id}`);
      
      await supabase.from('scraping_logs').update({
        status: 'failed',
        error_message: 'No Apify API keys available (all keys are inactive)',
        processing_time: Date.now() - startTime
      }).eq('request_id', requestId);

      return res.status(400).json({ 
        error: 'No API keys', 
        message: 'All your Apify API keys have hit their daily rate limits. Please add credits to your Apify accounts or wait for daily reset.' 
      });
    }

    console.log(`🔑 Found ${selectedKeys.length} Apify API keys for user ${req.user.id}`);
    
    // Test the selected key
    const testResult = await testAndUpdateApiKey(supabase, selectedKeys[0]);
    if (testResult.success) {
      recentlyActivatedKeys.add(selectedKeys[0].id);
    }

    const apiKey = selectedKeys[0];
    const scrapedProfiles = [];
    let profilesScraped = 0;
    let profilesFailed = 0;

    // 🚀 PARALLEL PROFILE SCRAPING - Process all profiles simultaneously
    console.log(`🚀 Starting parallel scraping of ${validUrls.length} profiles...`);
    
    // Helper function to process a single profile
    const processProfile = async (profileUrl) => {
      try {
        console.log(`🔍 Scraping profile: ${profileUrl}`);
        
        // First, check if profile already exists in global table
        const { data: existingProfiles } = await supabase
          .from('linkedin_profiles')
          .select('*')
          .eq('linkedin_url', profileUrl)
          .limit(1);

        if (existingProfiles && existingProfiles.length > 0) {
          console.log(`📋 Profile already exists: ${profileUrl}`);
          return { profile: existingProfiles[0], fromDb: true };
        }
        
        // Start the LinkedIn profile scraper actor
        const actorRun = await callApifyAPI('acts/2SyF0bVxmgGr8IVCZ/runs', apiKey.api_key, {
          method: 'POST',
          body: {
            profileUrls: [profileUrl]
          }
        });

        if (!actorRun.data?.id) {
          throw new Error('Failed to start actor run');
        }

        const runId = actorRun.data.id;
        console.log(`🎬 Actor run started: ${runId}`);

        // Poll for completion (max 60 attempts ~5 minutes)
        let attempts = 0;
        let runStatus = 'RUNNING';
        
        while (attempts < 60 && runStatus === 'RUNNING') {
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
          attempts++;
          
          const statusResponse = await callApifyAPI(`acts/2SyF0bVxmgGr8IVCZ/runs/${runId}`, apiKey.api_key);
          runStatus = statusResponse.data?.status;
          
          if (runStatus === 'FAILED') {
            throw new Error('Actor run failed');
          }
        }

        if (runStatus !== 'SUCCEEDED') {
          throw new Error(`Actor run timed out or failed: ${runStatus}`);
        }

        // Get the dataset ID
        const runInfo = await callApifyAPI(`acts/2SyF0bVxmgGr8IVCZ/runs/${runId}`, apiKey.api_key);
        const datasetId = runInfo.data?.defaultDatasetId;
        
        if (!datasetId) {
          throw new Error('No dataset ID from actor run');
        }

        // Wait a bit for data to be available
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Fetch the scraped data
        const datasetResponse = await callApifyAPI(`datasets/${datasetId}/items`, apiKey.api_key);
        const scrapedData = datasetResponse || [];

        if (scrapedData.length === 0) {
          throw new Error('No data returned from scraper');
        }

        // Process the scraped profile data
        const profileData = scrapedData[0]; // First item should be the profile data
        
        // Debug: Log the raw data from Apify to understand the structure
        console.log(`🔍 Raw profile data from Apify for ${profileUrl}:`, {
          companyFoundedIn: profileData.companyFoundedIn,
          currentJobDurationInYrs: profileData.currentJobDurationInYrs,
          connections: profileData.connections,
          followers: profileData.followers,
          openConnection: profileData.openConnection
        });
        
        // Helper function to safely convert values to integers
        const safeInteger = (value) => {
          if (value === null || value === undefined || value === '') return null;
          const parsed = parseInt(value);
          return isNaN(parsed) ? null : parsed;
        };

        // Helper function to safely convert values to numbers
        const safeNumber = (value) => {
          if (value === null || value === undefined || value === '') return null;
          const parsed = parseFloat(value);
          return isNaN(parsed) ? null : parsed;
        };

        // Helper function to safely convert values to strings
        const safeString = (value) => {
          if (value === null || value === undefined) return null;
          return String(value).trim() || null;
        };

        // Helper function to safely convert values to booleans
        const safeBoolean = (value) => {
          if (value === null || value === undefined) return null;
          if (typeof value === 'boolean') return value;
          if (typeof value === 'string') {
            const lower = value.toLowerCase();
            return lower === 'true' || lower === '1' || lower === 'yes';
          }
          return Boolean(value);
        };

          // Insert new profile into global table with enhanced structure
          const { data: newProfile, error: insertError } = await supabase
            .from('linkedin_profiles')
            .insert({
            linkedin_url: safeString(profileUrl),
            first_name: safeString(profileData.firstName),
            last_name: safeString(profileData.lastName),
            full_name: safeString(profileData.fullName),
            headline: safeString(profileData.headline),
            connections: safeInteger(profileData.connections),
            followers: safeInteger(profileData.followers),
            email: safeString(profileData.email),
            mobile_number: safeString(profileData.mobileNumber),
            job_title: safeString(profileData.jobTitle),
            company_name: safeString(profileData.companyName),
            company_industry: safeString(profileData.companyIndustry),
            company_website: safeString(profileData.companyWebsite),
            company_linkedin: safeString(profileData.companyLinkedin),
            company_founded_in: safeInteger(profileData.companyFoundedIn),
            company_size: safeString(profileData.companySize),
            current_job_duration: safeString(profileData.currentJobDuration),
            current_job_duration_in_yrs: safeNumber(profileData.currentJobDurationInYrs),
            top_skills_by_endorsements: profileData.topSkillsByEndorsements || null,
            address_country_only: safeString(profileData.addressCountryOnly),
            address_with_country: safeString(profileData.addressWithCountry),
            address_without_country: safeString(profileData.addressWithoutCountry),
            profile_pic: safeString(profileData.profilePic),
            profile_pic_high_quality: safeString(profileData.profilePicHighQuality),
            about: safeString(profileData.about),
            public_identifier: safeString(profileData.publicIdentifier),
            open_connection: safeBoolean(profileData.openConnection),
            urn: safeString(profileData.urn),
            creator_website: profileData.creatorWebsite || null,
            experiences: profileData.experiences || null,
            updates: profileData.updates || null,
            skills: profileData.skills || null,
            profile_pic_all_dimensions: profileData.profilePicAllDimensions || null,
            educations: profileData.educations || null,
            license_and_certificates: profileData.licenseAndCertificates || null,
            honors_and_awards: profileData.honorsAndAwards || null,
            languages: profileData.languages || null,
            volunteer_and_awards: profileData.volunteerAndAwards || null,
            verifications: profileData.verifications || null,
            promos: profileData.promos || null,
            highlights: profileData.highlights || null,
            projects: profileData.projects || null,
            publications: profileData.publications || null,
            patents: profileData.patents || null,
            courses: profileData.courses || null,
            test_scores: profileData.testScores || null,
            organizations: profileData.organizations || null,
            volunteer_causes: profileData.volunteerCauses || null,
            interests: profileData.interests || null,
            recommendations: profileData.recommendations || null
            })
            .select()
            .single();

          if (insertError) {
          console.error('❌ Database insertion error for profile:', profileUrl);
          console.error('Error details:', insertError);
          console.error('Profile data being inserted:', {
            linkedin_url: safeString(profileUrl),
            first_name: safeString(profileData.firstName),
            last_name: safeString(profileData.lastName),
            full_name: safeString(profileData.fullName),
            headline: safeString(profileData.headline),
            connections: safeInteger(profileData.connections),
            followers: safeInteger(profileData.followers),
            company_founded_in: safeInteger(profileData.companyFoundedIn),
            current_job_duration_in_yrs: safeNumber(profileData.currentJobDurationInYrs),
            open_connection: safeBoolean(profileData.openConnection)
          });
          throw new Error(`Failed to save profile data: ${insertError.message}`);
        }

          console.log(`✅ New profile saved: ${profileUrl}`);
        return { profile: newProfile, fromDb: false };

      } catch (error) {
        console.error(`❌ Error scraping profile ${profileUrl}:`, error.message);
        return { error: error.message };
      }
    };

    // Process all profiles in parallel using Promise.allSettled
    const profilePromises = validUrls.map(profileUrl => processProfile(profileUrl));
    const results = await Promise.allSettled(profilePromises);

    // Process results
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { profile, fromDb, error } = result.value;
        if (profile) {
          scrapedProfiles.push(profile);
        profilesScraped++;
        } else {
          profilesFailed++;
        }
      } else {
        console.error(`❌ Profile processing failed: ${validUrls[index]}`, result.reason);
        profilesFailed++;
      }
    });

        // Update key usage
        await supabase.from('api_keys').update({
          last_used: new Date().toISOString(),
          failure_count: 0,
          status: 'active'
        }).eq('id', apiKey.id);

    const processingTime = Date.now() - startTime;

    // Update the log with results
    await supabase.from('scraping_logs').update({
      status: profilesFailed === 0 ? 'completed' : 'partial',
      results: { profiles: scrapedProfiles },
      api_keys_used: [apiKey.id],
      processing_time: processingTime,
      profiles_scraped: profilesScraped,
      profiles_failed: profilesFailed
    }).eq('request_id', requestId);

    // Create response
    const response = {
      request_id: requestId,
      profile_urls: validUrls,
      profiles_scraped: profilesScraped,
      profiles_failed: profilesFailed,
      processing_time: processingTime,
      api_keys_used: 1,
      profiles: scrapedProfiles,
      status: profilesFailed === 0 ? 'completed' : 'partial'
    };

    console.log(`🎉 LinkedIn scraping completed!`);
    console.log(`📊 Final stats:`, {
      request_id: requestId,
      processing_time: processingTime,
      profiles_scraped: profilesScraped,
      profiles_failed: profilesFailed
    });

    res.json(response);

  } catch (error) {
    console.error('LinkedIn scraping error:', error);
    
    const processingTime = Date.now() - startTime;
    
    // Update log with error
    await supabase.from('scraping_logs').update({
      status: 'failed',
      error_message: error.message,
      processing_time: processingTime
    }).eq('request_id', requestId);

    res.status(500).json({ 
      error: 'LinkedIn scraping failed', 
      message: error.message,
      request_id: requestId,
      processing_time: processingTime
    });
  }
});

// Post comment scraping endpoint
app.post('/api/scrape-post-comments', rateLimitMiddleware, authMiddleware, async (req, res) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  try {
    const { postUrls, scrapingType } = req.body;
    
    if (!postUrls || !Array.isArray(postUrls) || postUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'postUrls array is required' 
      });
    }

    // Validate and sanitize post URLs
    const validUrls = postUrls
      .map(url => url.trim())
      .filter(url => url && url.includes('linkedin.com/posts/'))
      .slice(0, 10); // Limit to 10 posts per request

    if (validUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'No valid LinkedIn post URLs provided' 
      });
    }

    // Log the request
    try {
      await supabase.from('scraping_logs').insert({
        user_id: req.user.id,
        request_id: requestId,
        profile_urls: validUrls,
        status: 'pending'
      });
    } catch (dbError) {
      console.warn('⚠️ Failed to log request to database:', dbError.message);
    }

    // Get Apify keys for scraping
    const selectedKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', 1, new Set());
    
    if (!selectedKeys || selectedKeys.length === 0) {
      return res.status(400).json({ 
        error: 'No API keys available', 
        message: 'Please add an Apify API key to start scraping' 
      });
    }

    const apiKey = selectedKeys[0];
    console.log(`🔑 Using API key: ${apiKey.key_name}`);

    let commentsScraped = 0;
    let commentsFailed = 0;
    const allComments = [];

    // Scrape each post for comments using the post comments actor
    for (const postUrl of validUrls) {
      try {
        console.log(`🔍 Scraping post comments: ${postUrl}`);
        
        // Use the post comments actor: ZI6ykbLlGS3APaPE8
        const actorRun = await callApifyAPI('acts/ZI6ykbLlGS3APaPE8/runs', apiKey.api_key, {
          method: 'POST',
          body: {
            posts: [postUrl]
          }
        });

        if (!actorRun.data?.id) {
          throw new Error('Failed to start actor run');
        }

        const runId = actorRun.data.id;
        console.log(`🎬 Actor run started: ${runId}`);

        // Poll for completion
        let attempts = 0;
        let runStatus = 'RUNNING';
        
        while (attempts < 60 && runStatus === 'RUNNING') {
          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;
          
          const statusResponse = await callApifyAPI(`acts/ZI6ykbLlGS3APaPE8/runs/${runId}`, apiKey.api_key);
          runStatus = statusResponse.data?.status;
          
          if (runStatus === 'FAILED') {
            throw new Error('Actor run failed');
          }
        }

        if (runStatus !== 'SUCCEEDED') {
          throw new Error(`Actor run timed out or failed: ${runStatus}`);
        }

        // Get the dataset ID and fetch comments
        const runInfo = await callApifyAPI(`acts/ZI6ykbLlGS3APaPE8/runs/${runId}`, apiKey.api_key);
        const datasetId = runInfo.data?.defaultDatasetId;
        
        if (!datasetId) {
          throw new Error('No dataset ID from actor run');
        }

        await new Promise(resolve => setTimeout(resolve, 10000));

        const datasetResponse = await callApifyAPI(`datasets/${datasetId}/items`, apiKey.api_key);
        const comments = datasetResponse || [];

        if (comments.length > 0) {
          // Don't store comments in database - just return them for display
          allComments.push(...comments);
          commentsScraped += comments.length;
        } else {
          commentsFailed++;
        }

      } catch (error) {
        console.error(`❌ Failed to scrape post ${postUrl}:`, error.message);
        commentsFailed++;
      }
    }

    const processingTime = Date.now() - startTime;

    // Update log with results
    await supabase.from('scraping_logs').update({
      status: 'completed',
      results: { comments: allComments },
      processing_time: processingTime,
      profiles_scraped: commentsScraped,
      profiles_failed: commentsFailed
    }).eq('request_id', requestId);

    // Create response
    const response = {
      request_id: requestId,
      post_urls: validUrls,
      comments_scraped: commentsScraped,
      comments_failed: commentsFailed,
      processing_time: processingTime,
      comments: allComments,
      status: commentsFailed === 0 ? 'completed' : 'partial'
    };

    console.log(`🎉 Post comment scraping completed!`);
    res.json(response);

  } catch (error) {
    console.error('Post comment scraping error:', error);
    
    const processingTime = Date.now() - startTime;
    
    await supabase.from('scraping_logs').update({
      status: 'failed',
      error_message: error.message,
      processing_time: processingTime
    }).eq('request_id', requestId);

    res.status(500).json({ 
      error: 'Post comment scraping failed', 
      message: error.message,
      request_id: requestId,
      processing_time: processingTime
    });
  }
});

// Mixed scraping endpoint (post URLs → commenter profiles with parallel processing)
app.post('/api/scrape-mixed', rateLimitMiddleware, authMiddleware, async (req, res) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  try {
    const { postUrls } = req.body;
    
    // Validate post URLs
    const validPostUrls = postUrls && Array.isArray(postUrls) 
      ? postUrls
          .map(url => url.trim())
          .filter(url => url && url.includes('linkedin.com/posts/'))
          .slice(0, 10)
      : [];

    if (validPostUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'At least one LinkedIn post URL is required' 
      });
    }

    // Log the request
    try {
      await supabase.from('scraping_logs').insert({
        user_id: req.user.id,
        request_id: requestId,
        profile_urls: validPostUrls,
        status: 'pending'
      });
    } catch (dbError) {
      console.warn('⚠️ Failed to log request to database:', dbError.message);
    }

    // Get Apify keys for scraping
    const selectedKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', 1, new Set());
    
    if (!selectedKeys || selectedKeys.length === 0) {
      return res.status(400).json({ 
        error: 'No API keys available', 
        message: 'Please add an Apify API key to start scraping' 
      });
    }

    const apiKey = selectedKeys[0];
    console.log(`🔑 Using API key: ${apiKey.key_name}`);

    let commentsScraped = 0;
    let commentsFailed = 0;
    let profilesScraped = 0;
    let profilesFromDb = 0;
    let profilesFailed = 0;
    const allComments = [];
    const allProfiles = [];
    const extractedProfileUrls = new Set();

    // Step 1: Scrape post comments and extract profile URLs
    for (const postUrl of validPostUrls) {
      try {
        console.log(`🔍 Scraping post comments: ${postUrl}`);
        
        // Use the post comments actor: ZI6ykbLlGS3APaPE8
        const actorRun = await callApifyAPI('acts/ZI6ykbLlGS3APaPE8/runs', apiKey.api_key, {
          method: 'POST',
          body: {
            posts: [postUrl]
          }
        });

        if (!actorRun.data?.id) {
          throw new Error('Failed to start actor run');
        }

        const runId = actorRun.data.id;
        console.log(`🎬 Post comments actor run started: ${runId}`);

        // Poll for completion
        let attempts = 0;
        let runStatus = 'RUNNING';
        
        while (attempts < 60 && runStatus === 'RUNNING') {
          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;
          
          const statusResponse = await callApifyAPI(`acts/ZI6ykbLlGS3APaPE8/runs/${runId}`, apiKey.api_key);
          runStatus = statusResponse.data?.status;
          
          if (runStatus === 'FAILED') {
            throw new Error('Actor run failed');
          }
        }

        if (runStatus !== 'SUCCEEDED') {
          throw new Error(`Actor run timed out or failed: ${runStatus}`);
        }

        // Get the dataset ID and fetch comments
        const runInfo = await callApifyAPI(`acts/ZI6ykbLlGS3APaPE8/runs/${runId}`, apiKey.api_key);
        const datasetId = runInfo.data?.defaultDatasetId;
        
        if (!datasetId) {
          throw new Error('No dataset ID from actor run');
        }

        await new Promise(resolve => setTimeout(resolve, 10000));

        const datasetResponse = await callApifyAPI(`datasets/${datasetId}/items`, apiKey.api_key);
        const comments = datasetResponse || [];

        if (comments.length > 0) {
          // Don't store comments in database - just return them for display
              // Extract profile URL from comment actor
          for (const comment of comments) {
              if (comment.actor && comment.actor.linkedinUrl) {
                extractedProfileUrls.add(comment.actor.linkedinUrl);
            }
          }
          
          allComments.push(...comments);
          commentsScraped += comments.length;
        } else {
          commentsFailed++;
        }

      } catch (error) {
        console.error(`❌ Failed to scrape post ${postUrl}:`, error.message);
        commentsFailed++;
      }
    }

    // Step 2: Use extracted profile URLs (no additional profile URLs needed)
    const allProfileUrls = [...extractedProfileUrls];

    // Step 3: PARALLEL profile processing - check database first, then scrape in batches
    console.log(`🚀 Starting parallel processing of ${allProfileUrls.length} profiles...`);
    
    // Helper function to process a single profile
    const processProfile = async (profileUrl) => {
      try {
        // First, check if profile exists in our database
        const { data: existingProfile, error: dbError } = await supabase
          .from('linkedin_profiles')
          .select('*')
          .eq('linkedin_url', profileUrl)
          .single();

        if (existingProfile && !dbError) {
          console.log(`✅ Profile found in database: ${profileUrl}`);
          return { profile: existingProfile, fromDb: true };
        }

        // Profile not in database, scrape it using Apify
        console.log(`🔄 Scraping profile: ${profileUrl}`);
        
        // Use the profile details actor: 2SyF0bVxmgGr8IVCZ
        const actorRun = await callApifyAPI('acts/2SyF0bVxmgGr8IVCZ/runs', apiKey.api_key, {
          method: 'POST',
          body: {
            profileUrls: [profileUrl]
          }
        });

        if (!actorRun.data?.id) {
          throw new Error('Failed to start actor run');
        }

        const runId = actorRun.data.id;

        // Poll for completion
        let attempts = 0;
        let runStatus = 'RUNNING';
        
        while (attempts < 60 && runStatus === 'RUNNING') {
          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;
          
          const statusResponse = await callApifyAPI(`acts/2SyF0bVxmgGr8IVCZ/runs/${runId}`, apiKey.api_key);
          runStatus = statusResponse.data?.status;
          
          if (runStatus === 'FAILED') {
            throw new Error('Actor run failed');
          }
        }

        if (runStatus !== 'SUCCEEDED') {
          throw new Error(`Actor run timed out or failed: ${runStatus}`);
        }

        // Get the dataset ID and fetch profile data
        const runInfo = await callApifyAPI(`acts/2SyF0bVxmgGr8IVCZ/runs/${runId}`, apiKey.api_key);
        const datasetId = runInfo.data?.defaultDatasetId;
        
        if (!datasetId) {
          throw new Error('No dataset ID from actor run');
        }

        await new Promise(resolve => setTimeout(resolve, 10000));

        const datasetResponse = await callApifyAPI(`datasets/${datasetId}/items`, apiKey.api_key);
        const profileData = datasetResponse[0] || {};

        if (profileData && profileData.linkedinUrl) {
          // Helper functions for data type conversion
          const safeInteger = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const parsed = parseInt(value);
            return isNaN(parsed) ? null : parsed;
          };

          const safeNumber = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const parsed = parseFloat(value);
            return isNaN(parsed) ? null : parsed;
          };

          const safeString = (value) => {
            if (value === null || value === undefined) return null;
            return String(value).trim() || null;
          };

          const safeBoolean = (value) => {
            if (value === null || value === undefined) return null;
            if (typeof value === 'boolean') return value;
            if (typeof value === 'string') {
              const lower = value.toLowerCase();
              return lower === 'true' || lower === '1' || lower === 'yes';
            }
            return Boolean(value);
          };

          // Store profile in database
          const { data: newProfile, error: insertError } = await supabase
            .from('linkedin_profiles')
            .upsert({
              linkedin_url: safeString(profileData.linkedinUrl),
              first_name: safeString(profileData.firstName),
              last_name: safeString(profileData.lastName),
              full_name: safeString(profileData.fullName),
              headline: safeString(profileData.headline),
              connections: safeInteger(profileData.connections),
              followers: safeInteger(profileData.followers),
              email: safeString(profileData.email),
              mobile_number: safeString(profileData.mobileNumber),
              job_title: safeString(profileData.jobTitle),
              company_name: safeString(profileData.companyName),
              company_industry: safeString(profileData.companyIndustry),
              company_website: safeString(profileData.companyWebsite),
              company_linkedin: safeString(profileData.companyLinkedin),
              company_founded_in: safeInteger(profileData.companyFoundedIn),
              company_size: safeString(profileData.companySize),
              current_job_duration: safeString(profileData.currentJobDuration),
              current_job_duration_in_yrs: safeNumber(profileData.currentJobDurationInYrs),
              top_skills_by_endorsements: profileData.topSkillsByEndorsements || null,
              address_country_only: safeString(profileData.addressCountryOnly),
              address_with_country: safeString(profileData.addressWithCountry),
              address_without_country: safeString(profileData.addressWithoutCountry),
              profile_pic: safeString(profileData.profilePic),
              profile_pic_high_quality: safeString(profileData.profilePicHighQuality),
              about: safeString(profileData.about),
              public_identifier: safeString(profileData.publicIdentifier),
              open_connection: safeBoolean(profileData.openConnection),
              urn: safeString(profileData.urn),
              creator_website: profileData.creatorWebsite || null,
              experiences: profileData.experiences || null,
              updates: profileData.updates || null,
              skills: profileData.skills || null,
              profile_pic_all_dimensions: profileData.profilePicAllDimensions || null,
              educations: profileData.educations || null,
              license_and_certificates: profileData.licenseAndCertificates || null,
              honors_and_awards: profileData.honorsAndAwards || null,
              languages: profileData.languages || null,
              volunteer_and_awards: profileData.volunteerAndAwards || null,
              verifications: profileData.verifications || null,
              promos: profileData.promos || null,
              highlights: profileData.highlights || null,
              projects: profileData.projects || null,
              publications: profileData.publications || null,
              patents: profileData.patents || null,
              courses: profileData.courses || null,
              test_scores: profileData.testScores || null,
              organizations: profileData.organizations || null,
              volunteer_causes: profileData.volunteerCauses || null,
              interests: profileData.interests || null,
              recommendations: profileData.recommendations || null
            }, { onConflict: 'linkedin_url' })
            .select()
            .single();

          if (insertError) {
            console.error('❌ Database insertion error for profile:', profileData.linkedinUrl);
            console.error('Error details:', insertError);
            console.error('Profile data being inserted:', {
              linkedin_url: safeString(profileData.linkedinUrl),
              first_name: safeString(profileData.firstName),
              last_name: safeString(profileData.lastName),
              full_name: safeString(profileData.fullName),
              headline: safeString(profileData.headline),
              connections: safeInteger(profileData.connections),
              followers: safeInteger(profileData.followers),
              company_founded_in: safeInteger(profileData.companyFoundedIn),
              current_job_duration_in_yrs: safeNumber(profileData.currentJobDurationInYrs),
              open_connection: safeBoolean(profileData.openConnection)
            });
            return { error: `Failed to save profile data: ${insertError.message}` };
          } else {
            console.log(`✅ Profile scraped and stored: ${profileUrl}`);
            return { profile: newProfile, fromDb: false };
          }
        } else {
          return { error: 'No profile data received' };
        }

      } catch (error) {
        console.error(`❌ Failed to process profile ${profileUrl}:`, error.message);
        return { error: error.message };
      }
    };

    // Process profiles in parallel batches (50 at a time for optimal performance)
    const BATCH_SIZE = 50;
    const batches = [];
    for (let i = 0; i < allProfileUrls.length; i += BATCH_SIZE) {
      batches.push(allProfileUrls.slice(i, i + BATCH_SIZE));
    }

    console.log(`📦 Processing ${batches.length} batches of up to ${BATCH_SIZE} profiles each...`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`🔄 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} profiles)...`);
      
      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(profileUrl => processProfile(profileUrl))
      );

      // Process results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { profile, fromDb, error } = result.value;
          if (profile) {
            allProfiles.push(profile);
            if (fromDb) {
              profilesFromDb++;
            } else {
              profilesScraped++;
            }
          } else {
            profilesFailed++;
          }
        } else {
          console.error(`❌ Profile processing failed: ${batch[index]}`, result.reason);
          profilesFailed++;
        }
      });

      console.log(`✅ Batch ${batchIndex + 1} completed. Total profiles so far: ${allProfiles.length}`);
    }

    const processingTime = Date.now() - startTime;

    // Update log with results
    await supabase.from('scraping_logs').update({
      status: 'completed',
      results: { profiles: allProfiles },
      processing_time: processingTime,
      profiles_scraped: profilesScraped,
      profiles_failed: profilesFailed
    }).eq('request_id', requestId);

    // Create response - ONLY profile details, no comments
    const response = {
      request_id: requestId,
      post_urls: validPostUrls,
      total_profiles_processed: allProfileUrls.length,
      profiles_from_database: profilesFromDb,
      profiles_scraped: profilesScraped,
      profiles_failed: profilesFailed,
      processing_time: processingTime,
      profiles: allProfiles,
      status: profilesFailed === 0 ? 'completed' : 'partial'
    };

    console.log(`🎉 Mixed scraping completed! Profiles: ${allProfiles.length} (${profilesFromDb} from DB, ${profilesScraped} scraped)`);
    res.json(response);

  } catch (error) {
    console.error('Mixed scraping error:', error);
    
    const processingTime = Date.now() - startTime;
    
    await supabase.from('scraping_logs').update({
      status: 'failed',
      error_message: error.message,
      processing_time: processingTime
    }).eq('request_id', requestId);

    res.status(500).json({ 
      error: 'Mixed scraping failed', 
      message: error.message,
      request_id: requestId,
      processing_time: processingTime
    });
  }
});

// Get user's saved profiles
app.get('/api/saved-profiles', rateLimitMiddleware, authMiddleware, async (req, res) => {
  try {
    const { data: savedProfiles, error } = await supabase
      .rpc('get_user_saved_profiles', { user_uuid: req.user.id });

    if (error) {
      throw error;
    }

    res.json({ profiles: savedProfiles || [] });
  } catch (error) {
    console.error('Error fetching saved profiles:', error);
    res.status(500).json({ error: 'Failed to fetch saved profiles', message: error.message });
  }
});

// Save a profile to user's collection
app.post('/api/save-profile', rateLimitMiddleware, authMiddleware, async (req, res) => {
  try {
    const { profile_id, notes, tags } = req.body;
    
    if (!profile_id) {
      return res.status(400).json({ error: 'profile_id is required' });
    }

    const { data, error } = await supabase
      .from('user_saved_profiles')
      .insert({
        user_id: req.user.id,
        profile_id,
        notes: notes || '',
        tags: tags || []
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return res.status(409).json({ error: 'Profile already saved' });
      }
      throw error;
    }

    res.json({ success: true, saved_profile: data });
  } catch (error) {
    console.error('Error saving profile:', error);
    res.status(500).json({ error: 'Failed to save profile', message: error.message });
  }
});

// Remove a profile from user's collection
app.delete('/api/save-profile/:id', rateLimitMiddleware, authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('user_saved_profiles')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) {
      throw error;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing saved profile:', error);
    res.status(500).json({ error: 'Failed to remove saved profile', message: error.message });
  }
});

// Update notes for a saved profile
app.put('/api/save-profile/:id', rateLimitMiddleware, authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, tags } = req.body;
    
    const { data, error } = await supabase
      .from('user_saved_profiles')
      .update({ 
        notes: notes || '',
        tags: tags || []
      })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({ success: true, saved_profile: data });
  } catch (error) {
    console.error('Error updating saved profile:', error);
    res.status(500).json({ error: 'Failed to update saved profile', message: error.message });
  }
});

// Lightweight health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Test endpoint for API information
app.get('/api/test', (_req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'LinkedIn Scraper API is running',
    version: '1.0.0',
    endpoints: [
      '/api/scrape-linkedin',
      '/api/saved-profiles',
      '/api/save-profile',
      '/api/test-webhook',
      '/api/test-apify',
      '/api/debug/keys'
    ]
  });
});

// Test webhook functionality
app.post('/api/test-webhook', rateLimitMiddleware, authMiddleware, async (req, res) => {
  try {
    res.json({ 
      status: 'success', 
      message: 'Webhook test successful',
      user_id: req.user.id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Webhook test failed', message: error.message });
  }
});

// Test Apify API key
app.post('/api/test-apify', rateLimitMiddleware, authMiddleware, async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }

    // Test the API key
    const testResult = await callApifyAPI('users/me', apiKey);
    
      res.json({ 
        status: 'success', 
      message: 'Apify API key is valid',
      user_info: testResult
      });
  } catch (error) {
      res.status(400).json({ 
      error: 'Invalid API key', 
      message: error.message 
      });
  }
});

// Debug endpoint to check API keys
app.get('/api/debug/keys', rateLimitMiddleware, authMiddleware, async (req, res) => {
  try {
    const { data: keys, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('provider', 'apify');
    
    if (error) {
      throw error;
    }
    
    res.json({ 
      status: 'success', 
      keys: keys || [],
      count: keys?.length || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch keys', message: error.message });
  }
});

// Catch-all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'dist' });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 LinkedIn Scraper API server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
});
