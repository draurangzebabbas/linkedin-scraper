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
// Serve frontend if build exists; otherwise provide a simple root response
import fs from 'fs';
if (fs.existsSync('dist')) {
app.use(express.static('dist'));
} else {
  app.get('/', (req, res) => {
    res.send('Backend is running. Build the frontend to serve static files.');
  });
}

// Normalize LinkedIn URLs by removing query params, fragments, trimming, and removing trailing slashes
function normalizeLinkedInUrl(rawUrl) {
  try {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    // Ensure we have a protocol for URL parsing
    const candidate = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
    const url = new URL(candidate);
    // Only accept linkedin hostnames
    if (!url.hostname.includes('linkedin.com')) return '';
    // Drop search params and hash
    url.search = '';
    url.hash = '';
    // Remove trailing slash from pathname unless root
    url.pathname = url.pathname.replace(/\/+$/, '');
    // Return without trailing slash and without default port
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    // Fallback: strip everything after ? or # if URL constructor fails
    const base = String(rawUrl || '').trim();
    return base.split('#')[0].split('?')[0].replace(/\/+$/, '');
  }
}

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
// 🚀 OPTIMIZED FOR MULTI-ACCOUNT STRATEGY: Each key from different Apify accounts ($5/month each)
// This system automatically rotates between accounts and recovers keys when accounts get new credits
async function getSmartKeyAssignment(supabase, userId, provider, requiredCount, failedKeysInRequest = new Set()) {
  console.log(`🔍 Smart Key Assignment: Need ${requiredCount} keys for user ${userId} (Multi-Account Strategy)`);
  
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
  const COOLDOWN_MINUTES = 1; // Reduced to 1 minute for faster rotation with multiple accounts
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
  const MIN_ACTIVE_KEYS_NEEDED = 2; // Reduced to 2 for better multi-account utilization
  
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
        console.log(`✅ Key recovered: ${result.keyName} - now ACTIVE (from different account)`);
      } else if (result.success && result.status === 'rate_limited') {
        stillRateLimited++;
        console.log(`⚠️ Key still rate limited: ${result.keyName} (account may have daily limit)`);
      } else {
        stillFailed++;
        console.log(`❌ Key still failed: ${result.keyName}${result.error ? ` (${result.error})` : ''} (account may be exhausted)`);
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
  const COOLDOWN_MINUTES = 1; // Same cooldown as main function for faster rotation
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
      const errorText = await testResponse.text().catch(() => 'Unknown error');
      await supabase.from('api_keys').update({
        status: 'failed',
        last_failed: new Date().toISOString()
      }).eq('id', key.id);

      console.log(`❌ Key ${key.key_name} is FAILED (HTTP ${testResponse.status}): ${errorText}`);
      
      // Special handling for account-level limits
      if (testResponse.status === 402 || errorText.includes('insufficient') || errorText.includes('platform-feature-disabled')) {
        console.log(`💳 Account limit detected for key ${key.key_name} - will retry after cooldown`);
      }
      
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
  const requestId = `prof_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
  let logId = null;
  
  // Track keys that failed during this request to prevent reuse
  const failedKeysInRequest = new Set();
  
  try {
    const { profileUrls, saveAllProfiles = false } = req.body;
    
    if (!profileUrls || !Array.isArray(profileUrls) || profileUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'profileUrls array is required' 
      });
    }

    // Validate and sanitize profile URLs
    const validUrls = profileUrls
      .map(u => normalizeLinkedInUrl(u))
      .filter(url => url && url.includes('linkedin.com/in/'));

    if (validUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'No valid LinkedIn profile URLs provided' 
      });
    }

    // Log the request (aligned with schema)
    try {
      const { data: logRow } = await supabase
        .from('scraping_logs')
        .insert({
        user_id: req.user.id,
          scraping_type: 'profile-details',
          input_urls: validUrls,
          status: 'running',
          started_at: new Date().toISOString()
        })
        .select('id')
        .single();
      logId = logRow?.id || null;
    } catch (dbError) {
      console.warn('⚠️ Failed to log request to database:', dbError.message);
      // Continue with scraping even if logging fails
    }

    // 🚀 IMPROVED: Use the new smart key assignment system
    console.log(`🔍 Looking for API keys for user: ${req.user.id}`);
    
    // Track keys that become active during scraping
    const recentlyActivatedKeys = new Set();
    
    // Determine batches and request keys accordingly (round-robin per batch)
    const INITIAL_BATCH_SIZE = 10; // Changed to 10 for maximum speed as requested
    const initialBatches = [];
    for (let i = 0; i < validUrls.length; i += INITIAL_BATCH_SIZE) {
      initialBatches.push(validUrls.slice(i, i + INITIAL_BATCH_SIZE));
    }
    const requiredKeyCount = Math.max(1, initialBatches.length);

    // Get Apify keys for scraping - ensure we have at least 5 active keys
    let selectedKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', requiredKeyCount, failedKeysInRequest);
    
    // Check total active keys available (not just selected ones)
    const { data: allActiveKeys } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('provider', 'apify')
      .eq('status', 'active');
    
    // If we have less than 5 active keys, test all failed/rate_limited keys to reactivate them
    if (allActiveKeys.length < 5) {
      console.log(`🔧 Less than 5 active keys (${allActiveKeys.length}), testing failed/rate_limited keys...`);
      
      // Get all non-active keys
      const { data: inactiveKeys } = await supabase
        .from('api_keys')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('provider', 'apify')
        .in('status', ['failed', 'rate_limited']);
      
      if (inactiveKeys && inactiveKeys.length > 0) {
        console.log(`🧪 Testing ${inactiveKeys.length} inactive keys...`);
        
        // Test each inactive key
        const testPromises = inactiveKeys.map(async (key) => {
          const testResult = await testAndUpdateApiKey(supabase, key);
          if (testResult.success) {
            console.log(`✅ Reactivated key: ${key.key_name}`);
            return testResult.key;
          }
          return null;
        });
        
        const testResults = await Promise.allSettled(testPromises);
        const reactivatedKeys = testResults
          .filter(result => result.status === 'fulfilled' && result.value)
          .map(result => result.value);
        
        if (reactivatedKeys.length > 0) {
          console.log(`🎉 Reactivated ${reactivatedKeys.length} keys!`);
          // Get fresh key assignment with reactivated keys
          selectedKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', requiredKeyCount, failedKeysInRequest);
        }
      }
    }
    
    console.log(`🔑 Using ${selectedKeys.length} active keys for processing`);
    
    // Check if we have any profiles from database first
    console.log(`📊 Database check complete: ${profilesFromDb.length} found, ${profilesToScrape.length} to scrape`);
    
    // If no API keys but we have database profiles, return them
    if ((!selectedKeys || selectedKeys.length === 0) && profilesFromDb.length > 0) {
      console.log(`⚠️ No API keys available, but returning ${profilesFromDb.length} profiles from database`);
      
      const response = {
        success: true,
        status: 'partial_success',
        message: `Found ${profilesFromDb.length} profiles in database! No API keys available for scraping remaining profiles.`,
        profiles: profilesFromDb,
        total_profiles_processed: validUrls.length,
        profiles_from_db: profilesFromDb.length,
        profiles_scraped: 0,
        profiles_failed: profilesToScrape.length,
        processing_time_ms: Date.now() - startTime,
        warning: 'Some profiles could not be scraped due to API key limits. Database profiles are still available.'
      };
      
      if (logId) {
        await supabase
          .from('scraping_logs')
          .update({
            status: 'partial_success',
            profiles_scraped: 0,
            profiles_failed: profilesToScrape.length,
            completed_at: new Date().toISOString()
          })
          .eq('id', logId);
      }
      
      return res.json(response);
    }
    
    // If no API keys and no database profiles, then fail
    if (!selectedKeys || selectedKeys.length === 0) {
      console.log(`❌ No API keys available and no profiles in database for user ${req.user.id}`);
      
      if (logId) {
        await supabase
          .from('scraping_logs')
          .update({
        status: 'failed',
        error_message: 'No Apify API keys available (all keys are inactive)',
            completed_at: new Date().toISOString()
          })
          .eq('id', logId);
      }

      return res.status(400).json({ 
        error: 'No API keys', 
        message: 'All your Apify API keys have hit their monthly usage limits. Please add credits to your Apify accounts or wait for monthly reset. You can also add more API keys from different accounts.',
        status: 'failed',
        profiles: [],
        profiles_scraped: 0,
        profiles_failed: validUrls.length
      });
    }

    console.log(`🔑 Found ${selectedKeys.length} Apify API keys for user ${req.user.id}`);
    
    const scrapedProfiles = [];
    let profilesScraped = 0;
    let profilesFailed = 0;

    // 🚀 CRYSTAL CLEAR PROFILE PROCESSING - Database First Approach
    console.log(`🚀 Starting crystal clear processing of ${validUrls.length} profiles...`);
    
    // Database check already completed above, now process remaining profiles to scrape
    
    // Step 2: Process profiles that need scraping
    if (profilesToScrape.length === 0) {
      console.log(`✅ All profiles found in database! No scraping needed.`);
      const response = {
        success: true,
        status: 'completed',
        message: `All ${profilesFromDb.length} profiles found in database!`,
        profiles: profilesFromDb,
        total_profiles_processed: validUrls.length,
        profiles_from_db: profilesFromDb.length,
        profiles_scraped: 0,
        profiles_failed: 0,
        processing_time_ms: Date.now() - startTime
      };
      
      if (logId) {
        await supabase
          .from('scraping_logs')
          .update({
            status: 'completed',
            profiles_scraped: 0,
            profiles_failed: 0,
            completed_at: new Date().toISOString()
          })
          .eq('id', logId);
      }
      
      return res.json(response);
    }
    
    // Step 3: Create batches for profiles to scrape
    const SCRAPING_BATCH_SIZE = 10; // Crystal clear batch size
    const scrapingBatches = [];
    for (let i = 0; i < profilesToScrape.length; i += SCRAPING_BATCH_SIZE) {
      scrapingBatches.push(profilesToScrape.slice(i, i + SCRAPING_BATCH_SIZE));
    }
    
    console.log(`📦 Created ${scrapingBatches.length} batches of up to ${SCRAPING_BATCH_SIZE} profiles each`);
    
    // Step 4: Process batches in parallel with round-robin key assignment
    console.log(`🚀 Starting parallel batch processing...`);
    
    // Helper function to process a single profile with an assigned key
    const processProfile = async (profileUrl, initialKey) => {
      let currentApiKey = initialKey;
      let attempts = 0;
      const maxAttempts = Math.min(2, selectedKeys.length); // Try up to 2 different keys
      const failedKeysInThisRequest = new Set(); // Track keys that fail in this specific request
      
      while (attempts < maxAttempts) {
        try {
          console.log(`🔍 Scraping profile: ${profileUrl} (attempt ${attempts + 1}/${maxAttempts}) with key: ${currentApiKey.key_name}`);
        
        // Start the LinkedIn profile scraper actor
          const actorRun = await callApifyAPI('acts/2SyF0bVxmgGr8IVCZ/runs', currentApiKey.api_key, {
          method: 'POST',
            body: { profileUrls: [profileUrl] }
        });

        if (!actorRun.data?.id) {
          throw new Error('Failed to start actor run');
        }

        const runId = actorRun.data.id;
        console.log(`🎬 Actor run started: ${runId}`);

        // Poll for completion (max 60 attempts ~5 minutes)
        let pollAttempts = 0;
        let runStatus = 'RUNNING';
        
        while (pollAttempts < 60 && runStatus === 'RUNNING') {
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
          pollAttempts++;
          
          const statusResponse = await callApifyAPI(`acts/2SyF0bVxmgGr8IVCZ/runs/${runId}`, currentApiKey.api_key);
          runStatus = statusResponse.data?.status;
          
          if (runStatus === 'FAILED') {
            throw new Error('Actor run failed');
          }
        }

        if (runStatus !== 'SUCCEEDED') {
          throw new Error(`Actor run timed out or failed: ${runStatus}`);
        }

        // Get the dataset ID
        const runInfo = await callApifyAPI(`acts/2SyF0bVxmgGr8IVCZ/runs/${runId}`, currentApiKey.api_key);
        const datasetId = runInfo.data?.defaultDatasetId;
        
        if (!datasetId) {
          throw new Error('No dataset ID from actor run');
        }

        // Wait a bit for data to be available
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Fetch the scraped data
        const datasetResponse = await callApifyAPI(`datasets/${datasetId}/items`, currentApiKey.api_key);
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
            company_founded_in: safeNumber(profileData.companyFoundedIn),
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
            company_founded_in: safeNumber(profileData.companyFoundedIn),
            current_job_duration_in_yrs: safeNumber(profileData.currentJobDurationInYrs),
            open_connection: safeBoolean(profileData.openConnection)
          });
          throw new Error(`Failed to save profile data: ${insertError.message}`);
        }

          console.log(`✅ New profile saved: ${profileUrl}`);

        // Per-profile immediate auto-save to user's collection
        if (saveAllProfiles && newProfile?.id) {
          try {
            const { data: existingSaved } = await supabase
              .from('user_saved_profiles')
              .select('profile_id')
              .eq('user_id', req.user.id)
              .eq('profile_id', newProfile.id)
              .limit(1);
            if (!existingSaved || existingSaved.length === 0) {
              const { error: saveError } = await supabase.from('user_saved_profiles').insert({
                user_id: req.user.id,
                profile_id: newProfile.id,
                tags: []
              });
              if (saveError) {
                console.error('Error auto-saving profile:', saveError);
              } else {
                console.log(`✅ Auto-saved profile: ${profileUrl}`);
              }
            } else {
              console.log(`ℹ️ Profile already saved: ${profileUrl}`);
            }
          } catch (error) {
            console.error('Error in per-profile auto-save:', error);
          }
        }

        return { profile: newProfile, fromDb: false };

      } catch (error) {
          console.error(`❌ Failed to scrape profile ${profileUrl} with key ${currentApiKey.key_name}:`, error.message);
          
          // Check if this is an account limit error - mark key as failed immediately
          if (error.message.includes('Monthly usage hard limit exceeded') || 
              error.message.includes('platform-feature-disabled') ||
              error.message.includes('Insufficient credits') ||
              error.message.includes('403') ||
              error.message.includes('Rate limited')) {
            console.log(`💳 Account limit detected for key ${currentApiKey.key_name} - marking as failed immediately`);
            // Mark this key as failed in the database immediately
            await supabase.from('api_keys').update({
              status: 'failed',
              last_failed: new Date().toISOString()
            }).eq('id', currentApiKey.id);
            
            // Add to failed keys for this request
            failedKeysInThisRequest.add(currentApiKey.id);
          }
          
          attempts++;
          if (attempts < maxAttempts) {
            // Find next available key (not failed in this request)
            let nextKeyIndex = -1;
            for (let i = 0; i < selectedKeys.length; i++) {
              const keyIndex = (selectedKeys.indexOf(initialKey) + attempts + i) % selectedKeys.length;
              const candidateKey = selectedKeys[keyIndex];
              if (!failedKeysInThisRequest.has(candidateKey.id)) {
                nextKeyIndex = keyIndex;
                break;
              }
            }
            
            if (nextKeyIndex !== -1) {
              currentApiKey = selectedKeys[nextKeyIndex];
              console.log(`🔄 Retrying with next available key: ${currentApiKey.key_name} (attempt ${attempts + 1}/${maxAttempts})`);
            } else {
              console.log(`❌ No more available keys for profile ${profileUrl}`);
              return { error: 'All keys failed in this request' };
            }
          } else {
            console.log(`❌ All attempts failed for profile ${profileUrl}`);
        return { error: error.message };
      }
        }
      }
      
      // If we get here, all attempts failed
      return { error: 'All key attempts failed' };
    };

        // Process ALL batches in parallel, each batch assigned a key via round-robin
    const batchPromises = scrapingBatches.map((batch, batchIndex) => {
      const assignedKey = selectedKeys[Math.max(0, batchIndex % Math.max(1, selectedKeys.length))];
      console.log(`🔄 Batch ${batchIndex + 1}/${scrapingBatches.length} assigned key: ${assignedKey.key_name}`);
      return Promise.allSettled(batch.map(url => processProfile(url, assignedKey)));
    });

    const batchResults = await Promise.allSettled(batchPromises);

    // Accumulate results from all batches
    batchResults.forEach((batchResult, bIdx) => {
      if (batchResult.status === 'fulfilled') {
        const results = batchResult.value;
        results.forEach((result, i) => {
          const url = scrapingBatches[bIdx][i];
          if (result.status === 'fulfilled') {
            const { profile } = result.value;
            if (profile) {
              scrapedProfiles.push(profile);
              profilesScraped++;
            } else {
              profilesFailed++;
            }
          } else {
            console.error(`❌ Profile processing failed: ${url}`, result.reason);
            profilesFailed++;
          }
        });
      } else {
        // Entire batch failed (unlikely), count all in batch as failed
        console.error(`❌ Batch processing failed: batch ${bIdx + 1}`, batchResult.reason);
        profilesFailed += scrapingBatches[bIdx].length;
      }
    });
    
    // Combine all profiles (from DB + scraped)
    const allProfiles = [...profilesFromDb, ...scrapedProfiles];
    
    console.log(`📊 Final results: ${allProfiles.length} total profiles (${profilesFromDb.length} from DB, ${profilesScraped} scraped), ${profilesFailed} failed`);

        // Update key usage
        // Mark all used keys as used
        const usedKeyIds = new Set(
          scrapingBatches.map((_, idx) => {
            const k = selectedKeys[Math.max(0, idx % Math.max(1, selectedKeys.length))];
            return k?.id;
          }).filter(Boolean)
        );
        for (const keyId of usedKeyIds) {
        await supabase.from('api_keys').update({
          last_used: new Date().toISOString(),
          failure_count: 0,
          status: 'active'
          }).eq('id', keyId);
        }

    const processingTime = Date.now() - startTime;
    const apiKeysUsed = usedKeyIds.size;

    // Update the log with results
    if (logId) {
      await supabase
        .from('scraping_logs')
        .update({
          status: profilesFailed === 0 ? 'completed' : 'failed',
          api_key_used: selectedKeys[0]?.id || null,
      profiles_scraped: profilesScraped,
          profiles_failed: profilesFailed,
          completed_at: new Date().toISOString()
        })
        .eq('id', logId);
    }

    // Auto-save profiles if requested (both scraped and from DB)
    if (saveAllProfiles && allProfiles.length > 0) {
      try {
        console.log(`💾 Auto-saving ${allProfiles.length} profiles...`);
        
        // Check which profiles are already saved
        const { data: existingSaved, error: checkError } = await supabase
          .from('user_saved_profiles')
          .select('profile_id')
          .eq('user_id', req.user.id)
          .in('profile_id', allProfiles.map(p => p.id));

        if (checkError) {
          console.error('Error checking existing saved profiles:', checkError);
        } else {
          const existingProfileIds = new Set(existingSaved?.map(p => p.profile_id) || []);
          const newProfilesToSave = allProfiles.filter(p => !existingProfileIds.has(p.id));

          if (newProfilesToSave.length > 0) {
            const { error: saveError } = await supabase
              .from('user_saved_profiles')
              .insert(
                newProfilesToSave.map(profile => ({
                  user_id: req.user.id,
                  profile_id: profile.id,
                  tags: []
                }))
              );

            if (saveError) {
              console.error('Error auto-saving profiles:', saveError);
            } else {
              console.log(`✅ Auto-saved ${newProfilesToSave.length} profiles successfully!`);
            }
          } else {
            console.log(`ℹ️ All profiles were already saved`);
          }
        }
      } catch (autoSaveError) {
        console.error('Error in auto-save process:', autoSaveError);
        // Don't fail the request if auto-save fails
      }
    }

    // Create response - ALWAYS return results to user
    const response = {
      success: true,
      request_id: requestId,
      profile_urls: validUrls,
      profiles: allProfiles,
      total_profiles_processed: validUrls.length,
      profiles_from_db: profilesFromDb.length,
      profiles_scraped: profilesScraped,
      profiles_failed: profilesFailed,
      processing_time_ms: processingTime,
      api_keys_used: apiKeysUsed,
      status: profilesFailed === 0 ? 'completed' : (allProfiles.length > 0 ? 'partial_success' : 'failed'),
      auto_saved: saveAllProfiles ? allProfiles.length : 0,
      message: profilesFailed > 0 ? 
        `Processing complete! ${allProfiles.length} profiles processed (${profilesFromDb.length} from DB, ${profilesScraped} scraped), ${profilesFailed} failed.` : 
        `All profiles processed successfully! ${allProfiles.length} profiles (${profilesFromDb.length} from DB, ${profilesScraped} scraped).`
    };

    console.log(`🎉 LinkedIn scraping completed!`);
    console.log(`📊 Final stats:`, {
      request_id: requestId,
      processing_time: processingTime,
      total_profiles: allProfiles.length,
      profiles_from_db: profilesFromDb.length,
      profiles_scraped: profilesScraped,
      profiles_failed: profilesFailed
    });

    res.json(response);

  } catch (error) {
    console.error('LinkedIn scraping error:', error);
    
    const processingTime = Date.now() - startTime;
    
    // Update log with error
    if (logId) {
      await supabase
        .from('scraping_logs')
        .update({
      status: 'failed',
      error_message: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', logId);
    }

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
  const requestId = `cmt_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
  let logId = null;
  
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
      .map(u => normalizeLinkedInUrl(u))
      .filter(url => url && url.includes('linkedin.com/posts/'))
      .slice(0, 10); // Limit to 10 posts per request

    if (validUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'No valid LinkedIn post URLs provided' 
      });
    }

    // Log the request (aligned with schema)
    try {
      const { data: logRow } = await supabase
        .from('scraping_logs')
        .insert({
        user_id: req.user.id,
          scraping_type: 'post-comments',
          input_urls: validUrls,
          status: 'running',
          started_at: new Date().toISOString()
        })
        .select('id')
        .single();
      logId = logRow?.id || null;
    } catch (dbError) {
      console.warn('⚠️ Failed to log request to database:', dbError.message);
    }

    // Determine required keys for round-robin per post
    const failedKeysInRequest = new Set();
    const requiredKeyCount = Math.max(1, validUrls.length);

    // Get Apify keys for scraping (round-robin across comment runs)
    const selectedKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', requiredKeyCount, failedKeysInRequest);
    
    if (!selectedKeys || selectedKeys.length === 0) {
      return res.status(400).json({ 
        error: 'No API keys available', 
        message: 'All your Apify API keys have hit their monthly usage limits. Please add credits to your Apify accounts or wait for monthly reset. You can also add more API keys from different accounts.',
        status: 'failed',
        comments: [],
        comments_scraped: 0,
        comments_failed: validUrls.length
      });
    }

    console.log(`🔑 Using ${selectedKeys.length} keys for comments (round-robin)`);

    let commentsScraped = 0;
    let commentsFailed = 0;
    const allComments = [];

    // Scrape each post for comments in parallel, round-robin assign keys per post
    const commentPromises = validUrls.map(async (postUrl, idx) => {
      let apiKey = selectedKeys[Math.max(0, idx % Math.max(1, selectedKeys.length))];
      let attempts = 0;
      const maxAttempts = Math.min(3, selectedKeys.length); // Try up to 3 different keys
      
      while (attempts < maxAttempts) {
        try {
          console.log(`🔍 Scraping post comments: ${postUrl} (attempt ${attempts + 1}/${maxAttempts})`);
        
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
        let pollAttempts = 0;
        let runStatus = 'RUNNING';
        
        while (pollAttempts < 60 && runStatus === 'RUNNING') {
          await new Promise(resolve => setTimeout(resolve, 5000));
          pollAttempts++;
          
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
            break; // Success, exit retry loop
        } else {
          commentsFailed++;
            break; // No comments found, exit retry loop
        }

      } catch (error) {
          console.error(`❌ Failed to scrape post ${postUrl} with key ${apiKey.key_name}:`, error.message);
          
          // Check if this is an account limit error
          if (error.message.includes('Monthly usage hard limit exceeded') || 
              error.message.includes('platform-feature-disabled') ||
              error.message.includes('Insufficient credits')) {
            console.log(`💳 Account limit detected for key ${apiKey.key_name} - marking as failed`);
            // Mark this key as failed in the database
            await supabase.from('api_keys').update({
              status: 'failed',
              last_failed: new Date().toISOString()
            }).eq('id', apiKey.id);
          }
          
          attempts++;
          if (attempts < maxAttempts) {
            // Try next key
            const nextKeyIndex = (idx + attempts) % selectedKeys.length;
            apiKey = selectedKeys[nextKeyIndex];
            console.log(`🔄 Retrying with next key: ${apiKey.key_name} (attempt ${attempts + 1}/${maxAttempts})`);
          } else {
            console.log(`❌ All attempts failed for post ${postUrl}`);
        commentsFailed++;
      }
    }
      }
    });

    await Promise.allSettled(commentPromises);

    const processingTime = Date.now() - startTime;

    // Update log with results
    if (logId) {
      await supabase
        .from('scraping_logs')
        .update({
          status: commentsFailed === 0 ? 'completed' : 'failed',
          comments_scraped: commentsScraped,
          comments_failed: commentsFailed,
          completed_at: new Date().toISOString()
        })
        .eq('id', logId);
    }

    // Create response - ALWAYS return results to user
    const response = {
      success: true,
      request_id: requestId,
      post_urls: validUrls,
      comments_scraped: commentsScraped,
      comments_failed: commentsFailed,
      processing_time_ms: processingTime,
      comments: allComments,
      status: commentsFailed === 0 ? 'completed' : (commentsScraped > 0 ? 'partial_success' : 'failed'),
      message: commentsFailed > 0 ? 
        `Post comments scraping complete! ${commentsScraped} comments scraped successfully, ${commentsFailed} posts failed.` : 
        `All comments scraped successfully! ${commentsScraped} comments processed.`
    };

    console.log(`🎉 Post comment scraping completed!`);
    console.log(`📊 Results: ${commentsScraped} comments scraped, ${commentsFailed} posts failed`);
    res.json(response);

  } catch (error) {
    console.error('Post comment scraping error:', error);
    
    const processingTime = Date.now() - startTime;
    
    if (logId) {
      await supabase
        .from('scraping_logs')
        .update({
      status: 'failed',
      error_message: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', logId);
    }

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
  const requestId = `mix_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
  let logId = null;
  
  try {
    const { postUrls, saveAllProfiles = false } = req.body;
    
    // Validate post URLs
    const validPostUrls = postUrls && Array.isArray(postUrls) 
      ? postUrls
          .map(u => normalizeLinkedInUrl(u))
          .filter(url => url && url.includes('linkedin.com/posts/'))
          .slice(0, 10)
      : [];

    if (validPostUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'At least one LinkedIn post URL is required' 
      });
    }

    // Log the request (aligned with schema)
    try {
      const { data: logRow } = await supabase
        .from('scraping_logs')
        .insert({
        user_id: req.user.id,
          scraping_type: 'mixed',
          input_urls: validPostUrls,
          status: 'running',
          started_at: new Date().toISOString()
        })
        .select('id')
        .single();
      logId = logRow?.id || null;
    } catch (dbError) {
      console.warn('⚠️ Failed to log request to database:', dbError.message);
    }

    let commentsScraped = 0;
    let commentsFailed = 0;
    let profilesScraped = 0;
    let profilesFromDb = 0;
    let profilesFailed = 0;
    const allComments = [];
    const allProfiles = [];
    const extractedProfileUrls = new Set();

    // Step 1: Scrape post comments in parallel (round-robin assign keys per post) and extract profile URLs
    const requiredCommentKeyCount = Math.max(1, validPostUrls.length);
    let commentKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', requiredCommentKeyCount, new Set());
    
    // Check total active keys available (not just selected ones)
    const { data: allActiveKeysForComments } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('provider', 'apify')
      .eq('status', 'active');
    
    // If we have less than 5 active keys, test all failed/rate_limited keys to reactivate them
    if (allActiveKeysForComments.length < 5) {
      console.log(`🔧 Less than 5 active keys (${allActiveKeysForComments.length}), testing failed/rate_limited keys...`);
      
      // Get all non-active keys
      const { data: inactiveKeys } = await supabase
        .from('api_keys')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('provider', 'apify')
        .in('status', ['failed', 'rate_limited']);
      
      if (inactiveKeys && inactiveKeys.length > 0) {
        console.log(`🧪 Testing ${inactiveKeys.length} inactive keys...`);
        
        // Test each inactive key
        const testPromises = inactiveKeys.map(async (key) => {
          const testResult = await testAndUpdateApiKey(supabase, key);
          if (testResult.success) {
            console.log(`✅ Reactivated key: ${key.key_name}`);
            return testResult.key;
          }
          return null;
        });
        
        const testResults = await Promise.allSettled(testPromises);
        const reactivatedKeys = testResults
          .filter(result => result.status === 'fulfilled' && result.value)
          .map(result => result.value);
        
        if (reactivatedKeys.length > 0) {
          console.log(`🎉 Reactivated ${reactivatedKeys.length} keys!`);
          // Get fresh key assignment with reactivated keys
          commentKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', requiredCommentKeyCount, new Set());
        }
      }
    }
    
    console.log(`🔑 Using ${commentKeys.length} active keys for comment processing`);
    
    if (!commentKeys || commentKeys.length === 0) {
      return res.status(400).json({ 
        error: 'No API keys available', 
        message: 'All your Apify API keys have hit their monthly usage limits. Please add credits to your Apify accounts or wait for monthly reset. You can also add more API keys from different accounts.',
        status: 'failed',
        profiles: [],
        total_profiles_processed: 0,
        profiles_scraped: 0,
        profiles_failed: 0
      });
    }
    const commentPromises = validPostUrls.map(async (postUrl, idx) => {
      let apiKey = commentKeys[Math.max(0, idx % Math.max(1, commentKeys.length))];
      let attempts = 0;
      const maxAttempts = Math.min(2, commentKeys.length); // Try up to 2 different keys
      
      while (attempts < maxAttempts) {
        try {
          console.log(`🔍 Scraping post comments: ${postUrl} (attempt ${attempts + 1}/${maxAttempts})`);
          const actorRun = await callApifyAPI('acts/ZI6ykbLlGS3APaPE8/runs', apiKey.api_key, {
          method: 'POST',
          body: { posts: [postUrl] }
        });

        if (!actorRun.data?.id) throw new Error('Failed to start actor run');
        const runId = actorRun.data.id;

        // Poll for completion
        let pollAttempts = 0;
        let runStatus = 'RUNNING';
        while (pollAttempts < 60 && runStatus === 'RUNNING') {
          await new Promise(resolve => setTimeout(resolve, 5000));
          pollAttempts++;
          const statusResponse = await callApifyAPI(`acts/ZI6ykbLlGS3APaPE8/runs/${runId}`, apiKey.api_key);
          runStatus = statusResponse.data?.status;
          if (runStatus === 'FAILED') throw new Error('Actor run failed');
        }
        if (runStatus !== 'SUCCEEDED') throw new Error(`Actor run timed out or failed: ${runStatus}`);

        // Get comments
        const runInfo = await callApifyAPI(`acts/ZI6ykbLlGS3APaPE8/runs/${runId}`, apiKey.api_key);
        const datasetId = runInfo.data?.defaultDatasetId;
        if (!datasetId) throw new Error('No dataset ID from actor run');
        await new Promise(resolve => setTimeout(resolve, 10000));
        const datasetResponse = await callApifyAPI(`datasets/${datasetId}/items`, apiKey.api_key);
        const comments = datasetResponse || [];

        if (comments.length > 0) {
          for (const comment of comments) {
              if (comment.actor && comment.actor.linkedinUrl) {
                extractedProfileUrls.add(comment.actor.linkedinUrl);
            }
          }
          allComments.push(...comments);
          commentsScraped += comments.length;
            break; // Success, exit retry loop
        } else {
          commentsFailed++;
            break; // No comments found, exit retry loop
        }
      } catch (error) {
          console.error(`❌ Failed to scrape post ${postUrl} with key ${apiKey.key_name}:`, error.message);
          
          // Check if this is an account limit error - mark key as failed immediately
          if (error.message.includes('Monthly usage hard limit exceeded') || 
              error.message.includes('platform-feature-disabled') ||
              error.message.includes('Insufficient credits') ||
              error.message.includes('403') ||
              error.message.includes('Rate limited')) {
            console.log(`💳 Account limit detected for key ${apiKey.key_name} - marking as failed immediately`);
            // Mark this key as failed in the database immediately
            await supabase.from('api_keys').update({
              status: 'failed',
              last_failed: new Date().toISOString()
            }).eq('id', apiKey.id);
          }
          
          attempts++;
          if (attempts < maxAttempts) {
            // Try next key
            const nextKeyIndex = (idx + attempts) % commentKeys.length;
            apiKey = commentKeys[nextKeyIndex];
            console.log(`🔄 Retrying with next key: ${apiKey.key_name} (attempt ${attempts + 1}/${maxAttempts})`);
          } else {
            console.log(`❌ All attempts failed for post ${postUrl}`);
        commentsFailed++;
      }
    }
      }
    });
    await Promise.allSettled(commentPromises);

    // Step 2: Use extracted profile URLs (no additional profile URLs needed)
    const allProfileUrls = [...extractedProfileUrls];

    // Determine profile batches and request keys accordingly (round-robin per batch)
    const BATCH_SIZE = 10; // Changed to 10 for maximum speed as requested
    const profileBatches = [];
    for (let i = 0; i < allProfileUrls.length; i += BATCH_SIZE) {
      profileBatches.push(allProfileUrls.slice(i, i + BATCH_SIZE));
    }
    const requiredKeyCount = Math.max(1, profileBatches.length);

    // Get Apify keys for scraping - ensure we have at least 5 active keys
    let selectedKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', requiredKeyCount, new Set());
    
    // Check total active keys available (not just selected ones)
    const { data: allActiveKeysForProfiles } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('provider', 'apify')
      .eq('status', 'active');
    
    // If we have less than 5 active keys, test all failed/rate_limited keys to reactivate them
    if (allActiveKeysForProfiles.length < 5) {
      console.log(`🔧 Less than 5 active keys (${allActiveKeysForProfiles.length}), testing failed/rate_limited keys...`);
      
      // Get all non-active keys
      const { data: inactiveKeys } = await supabase
        .from('api_keys')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('provider', 'apify')
        .in('status', ['failed', 'rate_limited']);
      
      if (inactiveKeys && inactiveKeys.length > 0) {
        console.log(`🧪 Testing ${inactiveKeys.length} inactive keys...`);
        
        // Test each inactive key
        const testPromises = inactiveKeys.map(async (key) => {
          const testResult = await testAndUpdateApiKey(supabase, key);
          if (testResult.success) {
            console.log(`✅ Reactivated key: ${key.key_name}`);
            return testResult.key;
          }
          return null;
        });
        
        const testResults = await Promise.allSettled(testPromises);
        const reactivatedKeys = testResults
          .filter(result => result.status === 'fulfilled' && result.value)
          .map(result => result.value);
        
        if (reactivatedKeys.length > 0) {
          console.log(`🎉 Reactivated ${reactivatedKeys.length} keys!`);
          // Get fresh key assignment with reactivated keys
          selectedKeys = await getSmartKeyAssignment(supabase, req.user.id, 'apify', requiredKeyCount, new Set());
        }
      }
    }
    
    console.log(`🔑 Using ${selectedKeys.length} active keys for profile processing`);
    
    if (!selectedKeys || selectedKeys.length === 0) {
      return res.status(400).json({ 
        error: 'No API keys available', 
        message: 'All your Apify API keys have hit their monthly usage limits. Please add credits to your Apify accounts or wait for monthly reset. You can also add more API keys from different accounts.',
        status: 'failed',
        profiles: [],
        total_profiles_processed: allProfileUrls.length,
        profiles_scraped: 0,
        profiles_failed: allProfileUrls.length
      });
    }

    console.log(`🔑 Using ${selectedKeys.length} keys for profiles (round-robin)`);

    // Step 3: PARALLEL profile processing - check database first, then scrape in batches
    console.log(`🚀 Starting parallel processing of ${allProfileUrls.length} profiles...`);
    
    // Helper function to process a single profile (with a batch-assigned key)
    const processProfile = async (profileUrl, assignedKey) => {
      let apiKey = assignedKey;
      let attempts = 0;
      const maxAttempts = Math.min(2, selectedKeys.length); // Try up to 2 different keys
      const failedKeysInThisRequest = new Set(); // Track keys that fail in this specific request
      
      while (attempts < maxAttempts) {
        try {
          console.log(`🔍 Scraping profile: ${profileUrl} (attempt ${attempts + 1}/${maxAttempts}) with key: ${apiKey.key_name}`);
          
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
          console.log(`🔄 Scraping profile: ${profileUrl} (attempt ${attempts + 1}/${maxAttempts})`);
        
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
        let pollAttempts = 0;
        let runStatus = 'RUNNING';
        
        while (pollAttempts < 60 && runStatus === 'RUNNING') {
          await new Promise(resolve => setTimeout(resolve, 5000));
          pollAttempts++;
          
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
              company_founded_in: safeNumber(profileData.companyFoundedIn),
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
              company_founded_in: safeNumber(profileData.companyFoundedIn),
              current_job_duration_in_yrs: safeNumber(profileData.currentJobDurationInYrs),
              open_connection: safeBoolean(profileData.openConnection)
            });
            return { error: `Failed to save profile data: ${insertError.message}` };
          } else {
            console.log(`✅ Profile scraped and stored: ${profileUrl}`);

            // Per-profile immediate auto-save to user's collection (mixed endpoint)
            if (saveAllProfiles && newProfile?.id) {
              try {
                const { data: existingSaved } = await supabase
                  .from('user_saved_profiles')
                  .select('profile_id')
                  .eq('user_id', req.user.id)
                  .eq('profile_id', newProfile.id)
                  .limit(1);
                if (!existingSaved || existingSaved.length === 0) {
                  const { error: saveError } = await supabase.from('user_saved_profiles').insert({
                    user_id: req.user.id,
                    profile_id: newProfile.id,
                    tags: []
                  });
                  if (saveError) {
                    console.error('Error auto-saving profile:', saveError);
                  } else {
                    console.log(`✅ Auto-saved profile: ${profileUrl}`);
                  }
                } else {
                  console.log(`ℹ️ Profile already saved: ${profileUrl}`);
                }
              } catch (error) {
                console.error('Error in per-profile auto-save:', error);
              }
            }

            return { profile: newProfile, fromDb: false };
          }
        } else {
          return { error: 'No profile data received' };
        }

      } catch (error) {
          console.error(`❌ Failed to process profile ${profileUrl} with key ${apiKey.key_name}:`, error.message);
          
          // Check if this is an account limit error - mark key as failed immediately
          if (error.message.includes('Monthly usage hard limit exceeded') || 
              error.message.includes('platform-feature-disabled') ||
              error.message.includes('Insufficient credits') ||
              error.message.includes('403') ||
              error.message.includes('Rate limited')) {
            console.log(`💳 Account limit detected for key ${apiKey.key_name} - marking as failed immediately`);
            // Mark this key as failed in the database immediately
            await supabase.from('api_keys').update({
              status: 'failed',
              last_failed: new Date().toISOString()
            }).eq('id', apiKey.id);
            
            // Add to failed keys for this request
            failedKeysInThisRequest.add(apiKey.id);
          }
          
          attempts++;
          if (attempts < maxAttempts) {
            // Find next available key (not failed in this request)
            let nextKeyIndex = -1;
            for (let i = 0; i < selectedKeys.length; i++) {
              const keyIndex = (selectedKeys.indexOf(assignedKey) + attempts + i) % selectedKeys.length;
              const candidateKey = selectedKeys[keyIndex];
              if (!failedKeysInThisRequest.has(candidateKey.id)) {
                nextKeyIndex = keyIndex;
                break;
              }
            }
            
            if (nextKeyIndex !== -1) {
              apiKey = selectedKeys[nextKeyIndex];
              console.log(`🔄 Retrying with next available key: ${apiKey.key_name} (attempt ${attempts + 1}/${maxAttempts})`);
            } else {
              console.log(`❌ No more available keys for profile ${profileUrl}`);
              return { error: 'All keys failed in this request' };
            }
          } else {
            console.log(`❌ All attempts failed for profile ${profileUrl}`);
            return { error: error.message };
          }
        }
      }
      
      // If we get here, all attempts failed
      return { error: 'All key attempts failed' };
    };

    // Process ALL profile batches in parallel, each batch assigned a key via round-robin
    console.log(`📦 Processing ${profileBatches.length} batches of up to ${BATCH_SIZE} profiles each...`);
    const batchPromises = profileBatches.map((batch, batchIndex) => {
      const assignedKey = selectedKeys[Math.max(0, batchIndex % Math.max(1, selectedKeys.length))];
      return Promise.allSettled(batch.map(url => processProfile(url, assignedKey)));
    });

    const batchResults = await Promise.allSettled(batchPromises);

    // Accumulate results
    batchResults.forEach((batchResult, bIdx) => {
      if (batchResult.status === 'fulfilled') {
        const results = batchResult.value;
        results.forEach((result, i) => {
          const url = profileBatches[bIdx][i];
        if (result.status === 'fulfilled') {
            const { profile, fromDb } = result.value;
          if (profile) {
            allProfiles.push(profile);
              if (fromDb) profilesFromDb++; else profilesScraped++;
            } else {
              profilesFailed++;
            }
          } else {
            console.error(`❌ Profile processing failed: ${url}`, result.reason);
            profilesFailed++;
          }
        });
        } else {
        console.error(`❌ Batch processing failed: batch ${bIdx + 1}`, batchResult.reason);
        profilesFailed += profileBatches[bIdx].length;
        }
      });

    const processingTime = Date.now() - startTime;

    // Update log with results
    if (logId) {
      await supabase
        .from('scraping_logs')
        .update({
          status: profilesFailed === 0 ? 'completed' : 'failed',
          api_key_used: (selectedKeys[0]?.id || commentKeys[0]?.id || null),
      profiles_scraped: profilesScraped,
          profiles_failed: profilesFailed,
          completed_at: new Date().toISOString()
        })
        .eq('id', logId);
    }

    // Auto-save profiles if requested
    if (saveAllProfiles && allProfiles.length > 0) {
      try {
        console.log(`💾 Auto-saving ${allProfiles.length} profiles...`);
        
        // Check which profiles are already saved
        const { data: existingSaved, error: checkError } = await supabase
          .from('user_saved_profiles')
          .select('profile_id')
          .eq('user_id', req.user.id)
          .in('profile_id', allProfiles.map(p => p.id));

        if (checkError) {
          console.error('Error checking existing saved profiles:', checkError);
        } else {
          const existingProfileIds = new Set(existingSaved?.map(p => p.profile_id) || []);
          const newProfilesToSave = allProfiles.filter(p => !existingProfileIds.has(p.id));

          if (newProfilesToSave.length > 0) {
            const { error: saveError } = await supabase
              .from('user_saved_profiles')
              .insert(
                newProfilesToSave.map(profile => ({
                  user_id: req.user.id,
                  profile_id: profile.id,
                  tags: []
                }))
              );

            if (saveError) {
              console.error('Error auto-saving profiles:', saveError);
            } else {
              console.log(`✅ Auto-saved ${newProfilesToSave.length} profiles successfully!`);
            }
          } else {
            console.log(`ℹ️ All profiles were already saved`);
          }
        }
      } catch (autoSaveError) {
        console.error('Error in auto-save process:', autoSaveError);
        // Don't fail the request if auto-save fails
      }
    }

    // Create response - ALWAYS return results to user
    const response = {
      success: true,
      request_id: requestId,
      post_urls: validPostUrls,
      comments_scraped: commentsScraped,
      comments_failed: commentsFailed,
      total_profiles_processed: allProfileUrls.length,
      profiles_from_database: profilesFromDb,
      profiles_scraped: profilesScraped,
      profiles_failed: profilesFailed,
      processing_time_ms: processingTime,
      profiles: allProfiles,
      comments: allComments,
      status: profilesFailed === 0 ? 'completed' : (allProfiles.length > 0 ? 'partial_success' : 'failed'),
      auto_saved: saveAllProfiles ? allProfiles.length : 0,
      message: profilesFailed > 0 ? 
        `Mixed scraping complete! ${commentsScraped} comments scraped, ${allProfiles.length} profiles processed (${profilesFromDb} from DB, ${profilesScraped} scraped), ${profilesFailed} profiles failed.` : 
        `Mixed scraping successful! ${commentsScraped} comments scraped, ${allProfiles.length} profiles processed (${profilesFromDb} from DB, ${profilesScraped} scraped).`
    };

    console.log(`🎉 Mixed scraping completed! Profiles: ${allProfiles.length} (${profilesFromDb} from DB, ${profilesScraped} scraped)`);
    console.log(`📊 Results: ${allProfiles.length} profiles processed, ${profilesFailed} failed`);
    res.json(response);

  } catch (error) {
    console.error('Mixed scraping error:', error);
    
    const processingTime = Date.now() - startTime;
    
    if (logId) {
      await supabase
        .from('scraping_logs')
        .update({
      status: 'failed',
      error_message: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', logId);
    }

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


// Catch-all handler: serve index.html only if build exists
app.get('*', (req, res) => {
  const indexPath = 'dist/index.html';
  if (fs.existsSync(indexPath)) {
  res.sendFile('index.html', { root: 'dist' });
  } else {
    res.status(200).send('Backend is running. Frontend build not found.');
  }
});

// Update single profile endpoint
app.post('/api/update-profile', async (req, res) => {
  try {
    const { profileId } = req.body;
    const userId = req.headers['x-user-id'];

    if (!profileId || !userId) {
      return res.status(400).json({ error: 'Profile ID and User ID are required' });
    }

    // Get the profile from user's saved profiles
    const { data: savedProfile, error: savedError } = await supabase
      .from('user_saved_profiles')
      .select('profile_id, linkedin_profiles(*)')
      .eq('id', profileId)
      .eq('user_id', userId)
      .single();

    if (savedError || !savedProfile) {
      return res.status(404).json({ error: 'Profile not found in your saved profiles' });
    }

    const linkedinUrl = savedProfile.linkedin_profiles.linkedin_url;

    // Get user's API keys
    const { data: apiKeys, error: keysError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (keysError || !apiKeys || apiKeys.length === 0) {
      return res.status(400).json({ error: 'No active API keys found' });
    }

    // Use the first available key
    const apiKey = apiKeys[0];

    // Scrape the profile using Apify
    const profileData = await scrapeLinkedInProfile(linkedinUrl, apiKey.api_key);

    if (!profileData) {
      return res.status(500).json({ error: 'Failed to scrape profile data' });
    }

    // Update the profile in the global database
    const { error: updateError } = await supabase
      .from('linkedin_profiles')
      .update({
        ...profileData,
        updated_at: new Date().toISOString()
      })
      .eq('id', savedProfile.profile_id);

    if (updateError) {
      console.error('Error updating profile:', updateError);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    res.json({ 
      success: true, 
      message: 'Profile updated successfully',
      profileId: savedProfile.profile_id
    });

  } catch (error) {
    console.error('Error in update-profile endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update multiple profiles endpoint
app.post('/api/update-profiles', async (req, res) => {
  try {
    const { profileIds } = req.body;
    const userId = req.headers['x-user-id'];

    if (!profileIds || !Array.isArray(profileIds) || profileIds.length === 0) {
      return res.status(400).json({ error: 'Profile IDs array is required' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Get user's API keys
    const { data: apiKeys, error: keysError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (keysError || !apiKeys || apiKeys.length === 0) {
      return res.status(400).json({ error: 'No active API keys found' });
    }

    const apiKey = apiKeys[0];
    let updatedCount = 0;
    const errors = [];

    // Process profiles in parallel
    const updatePromises = profileIds.map(async (savedProfileId) => {
      try {
        // Get the profile from user's saved profiles
        const { data: savedProfile, error: savedError } = await supabase
          .from('user_saved_profiles')
          .select('profile_id, linkedin_profiles(*)')
          .eq('id', savedProfileId)
          .eq('user_id', userId)
          .single();

        if (savedError || !savedProfile) {
          errors.push(`Profile ${savedProfileId} not found`);
          return;
        }

        const linkedinUrl = savedProfile.linkedin_profiles.linkedin_url;

        // Scrape the profile
        const profileData = await scrapeLinkedInProfile(linkedinUrl, apiKey.api_key);

        if (!profileData) {
          errors.push(`Failed to scrape ${linkedinUrl}`);
          return;
        }

        // Update the profile
        const { error: updateError } = await supabase
          .from('linkedin_profiles')
          .update({
            ...profileData,
            updated_at: new Date().toISOString()
          })
          .eq('id', savedProfile.profile_id);

        if (updateError) {
          errors.push(`Failed to update ${linkedinUrl}: ${updateError.message}`);
          return;
        }

        updatedCount++;
      } catch (error) {
        errors.push(`Error updating profile ${savedProfileId}: ${error.message}`);
      }
    });

    await Promise.allSettled(updatePromises);

    res.json({ 
      success: true, 
      updated: updatedCount,
      total: profileIds.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error in update-profiles endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to scrape LinkedIn profile (used by update endpoints)
async function scrapeLinkedInProfile(linkedinUrl, apiKey) {
  try {
    console.log(`🔍 Scraping profile: ${linkedinUrl}`);
    
    // Start the LinkedIn profile scraper actor
    const actorRun = await callApifyAPI('acts/2SyF0bVxmgGr8IVCZ/runs', apiKey, {
      method: 'POST',
      body: { profileUrls: [linkedinUrl] }
    });

    if (!actorRun.data?.id) {
      throw new Error('Failed to start actor run');
    }

    const runId = actorRun.data.id;
    console.log(`🎬 Actor run started: ${runId}`);

    // Poll for completion (max 60 attempts ~5 minutes)
    let pollAttempts = 0;
    let runStatus = 'RUNNING';
    
    while (pollAttempts < 60 && runStatus === 'RUNNING') {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      pollAttempts++;
      
      const statusResponse = await callApifyAPI(`acts/2SyF0bVxmgGr8IVCZ/runs/${runId}`, apiKey);
      runStatus = statusResponse.data?.status;
      
      if (runStatus === 'FAILED') {
        throw new Error('Actor run failed');
      }
    }

    if (runStatus !== 'SUCCEEDED') {
      throw new Error(`Actor run timed out or failed: ${runStatus}`);
    }

    // Get the dataset ID
    const runInfo = await callApifyAPI(`acts/2SyF0bVxmgGr8IVCZ/runs/${runId}`, apiKey);
    const datasetId = runInfo.data?.defaultDatasetId;
    
    if (!datasetId) {
      throw new Error('No dataset ID from actor run');
    }

    // Wait a bit for data to be available
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Fetch the scraped data
    const datasetResponse = await callApifyAPI(`datasets/${datasetId}/items`, apiKey);
    const scrapedData = datasetResponse || [];

    if (scrapedData.length === 0) {
      throw new Error('No data returned from scraper');
    }

    // Process the scraped profile data
    const profileData = scrapedData[0]; // First item should be the profile data
    
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

    // Return processed profile data
    return {
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
      company_founded_in: safeNumber(profileData.companyFoundedIn),
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
    };

  } catch (error) {
    console.error(`❌ Error scraping profile ${linkedinUrl}:`, error.message);
    return null;
  }
}

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 LinkedIn Scraper API server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
});
