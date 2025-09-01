# LinkedIn Scraper Webhook API Documentation

## Overview
The LinkedIn Scraper API provides webhook endpoints for scraping LinkedIn posts, profiles, and comments using Apify actors. The API supports three types of scraping operations with intelligent API key rotation and comprehensive data extraction.

## Base URL
```
https://your-domain.com
```

## Authentication
All requests require a Bearer token in the Authorization header:
```
Authorization: Bearer YOUR_WEBHOOK_TOKEN
```

## Endpoints

### POST /api/scrape-linkedin
Scrape LinkedIn profile details from profile URLs.

**Request Body:**
```json
{
  "profileUrls": [
    "https://www.linkedin.com/in/username1",
    "https://www.linkedin.com/in/username2"
  ]
}
```

**Response:**
```json
{
  "request_id": "uuid",
  "profile_urls": ["https://www.linkedin.com/in/username1"],
  "profiles_scraped": 1,
  "profiles_failed": 0,
  "processing_time": 45000,
  "profiles": [
    {
      "id": "uuid",
      "linkedin_url": "https://www.linkedin.com/in/username1",
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
}
```

### POST /api/scrape-post-comments
Scrape LinkedIn post comments and commenters.

**Request Body:**
```json
{
  "postUrls": [
    "https://www.linkedin.com/posts/username_post-id",
    "https://www.linkedin.com/posts/username_post-id-2"
  ],
  "scrapingType": "post-comments"
}
```

**Response:**
```json
{
  "request_id": "uuid",
  "post_urls": ["https://www.linkedin.com/posts/username_post-id"],
  "comments_scraped": 15,
  "comments_failed": 0,
  "processing_time": 30000,
  "comments": [
    {
      "id": "comment-id",
      "linkedinUrl": "https://www.linkedin.com/feed/update/...",
      "commentary": "Great post! Thanks for sharing.",
      "createdAt": "2025-01-03T10:00:00Z",
      "engagement": {
        "likes": 5,
        "reactions": [
          {
            "type": "APPRECIATION",
            "count": 3
          }
        ]
      },
      "actor": {
        "id": "actor-id",
        "name": "Jane Smith",
        "linkedinUrl": "https://www.linkedin.com/in/janesmith",
        "position": "Marketing Manager",
        "pictureUrl": "https://media.licdn.com/..."
      }
    }
  ],
  "status": "completed"
}
```

### POST /api/scrape-mixed
Scrape post comments and then extract full profile details of commenters.

**Request Body:**
```json
{
  "postUrls": [
    "https://www.linkedin.com/posts/username_post-id"
  ],
  "profileUrls": [
    "https://www.linkedin.com/in/username1"
  ]
}
```

**Response:**
```json
{
  "request_id": "uuid",
  "post_urls": ["https://www.linkedin.com/posts/username_post-id"],
  "profile_urls": ["https://www.linkedin.com/in/username1", "https://www.linkedin.com/in/janesmith"],
  "comments_scraped": 15,
  "profiles_scraped": 2,
  "comments_failed": 0,
  "profiles_failed": 0,
  "processing_time": 120000,
  "comments": [...],
  "profiles": [...],
  "status": "completed"
}
```

## Data Fields

### Profile Data Fields
- **linkedin_url**: LinkedIn profile URL
- **first_name**: First name
- **last_name**: Last name
- **full_name**: Full name
- **headline**: Professional headline
- **connections**: Number of connections
- **followers**: Number of followers
- **email**: Email address (if available)
- **mobile_number**: Mobile number (if available)
- **job_title**: Current job title
- **company_name**: Current company name
- **company_industry**: Company industry
- **company_website**: Company website
- **company_linkedin**: Company LinkedIn URL
- **company_founded_in**: Company founding year
- **company_size**: Company size
- **current_job_duration**: Current job duration
- **current_job_duration_in_yrs**: Current job duration in years
- **address_country_only**: Country
- **address_with_country**: Full address with country
- **address_without_country**: Address without country
- **profile_pic**: Profile picture URL
- **profile_pic_high_quality**: High-quality profile picture URL
- **about**: About section text
- **public_identifier**: LinkedIn public identifier
- **open_connection**: Whether connection is open
- **urn**: LinkedIn URN
- **experiences**: Work experience array
- **educations**: Education array
- **skills**: Skills array
- **interests**: Interests array
- **honors_and_awards**: Awards and honors
- **languages**: Languages spoken
- **projects**: Projects array
- **publications**: Publications array
- **patents**: Patents array
- **courses**: Courses array
- **test_scores**: Test scores
- **organizations**: Organizations
- **volunteer_causes**: Volunteer causes
- **recommendations**: Recommendations

### Comment Data Fields
- **id**: Comment ID
- **linkedinUrl**: Comment URL
- **commentary**: Comment text
- **createdAt**: Comment creation date
- **createdAtTimestamp**: Comment creation timestamp
- **engagement**: Engagement data (likes, reactions)
- **postId**: Post ID
- **pinned**: Whether comment is pinned
- **contributed**: Whether comment is contributed
- **edited**: Whether comment was edited
- **actor**: Commenter information
  - **id**: Actor ID
  - **name**: Actor name
  - **linkedinUrl**: Actor LinkedIn URL
  - **position**: Actor position
  - **pictureUrl**: Actor profile picture URL
  - **author**: Whether actor is post author

## Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "error": "Invalid request",
  "message": "No valid LinkedIn URLs provided"
}
```

**401 Unauthorized:**
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing webhook token"
}
```

**429 Too Many Requests:**
```json
{
  "error": "Rate limited",
  "message": "Too many requests. Please try again later."
}
```

**500 Internal Server Error:**
```json
{
  "error": "Scraping failed",
  "message": "Failed to scrape LinkedIn data",
  "request_id": "uuid",
  "processing_time": 5000
}
```

## Rate Limiting
- Maximum 10 URLs per request
- Rate limiting applied per user
- Automatic retry with exponential backoff

## API Key Management
- Automatic API key rotation
- Health monitoring and cooldown periods
- Smart key assignment based on usage and success rates

## Webhook Integration Examples

### Make.com Integration
```json
{
  "module": "http:ActionSendData",
  "parameters": {
    "url": "https://your-domain.com/api/scrape-linkedin",
    "method": "post",
    "headers": [
      {
        "name": "Authorization",
        "value": "Bearer YOUR_WEBHOOK_TOKEN"
      },
      {
        "name": "Content-Type",
        "value": "application/json"
      }
    ],
    "bodyType": "raw",
    "contentType": "application/json",
    "data": "{\"profileUrls\": [\"https://www.linkedin.com/in/username\"]}"
  }
}
```

### Zapier Integration
1. Create a new Zap
2. Add "Webhooks by Zapier" trigger
3. Choose "POST" method
4. Set URL to your webhook endpoint
5. Add Authorization header with Bearer token
6. Configure request body with LinkedIn URLs

### Python Integration
```python
import requests

url = "https://your-domain.com/api/scrape-linkedin"
headers = {
    "Authorization": "Bearer YOUR_WEBHOOK_TOKEN",
    "Content-Type": "application/json"
}
data = {
    "profileUrls": [
        "https://www.linkedin.com/in/username1",
        "https://www.linkedin.com/in/username2"
    ]
}

response = requests.post(url, json=data, headers=headers)
result = response.json()
```

## Best Practices

1. **URL Validation**: Always validate LinkedIn URLs before sending requests
2. **Batch Processing**: Use batch requests for multiple URLs to improve efficiency
3. **Error Handling**: Implement proper error handling for failed requests
4. **Rate Limiting**: Respect rate limits and implement retry logic
5. **Data Storage**: Store scraped data appropriately and respect LinkedIn's terms of service
6. **API Key Management**: Monitor API key usage and implement rotation strategies

## Support
For technical support and questions:
- Check the application dashboard for detailed logs
- Review API key status and usage
- Monitor scraping success rates
- Contact support for integration assistance