/**
 * Freshdesk FAQ Fetcher
 * 
 * Fetches FAQ articles from a specific Freshdesk folder using the official API
 * API Docs: https://developers.freshdesk.com/api/#solution_article_attributes
 */

require('dotenv').config();
const axios = require('axios');

const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;
const FRESHDESK_DOMAIN = process.env.FRESHDESK_DOMAIN;
const FAQ_FOLDER_ID = process.env.FRESHDESK_FAQ_FOLDER_ID || '159000879558';

// Validate configuration
if (!FRESHDESK_API_KEY || !FRESHDESK_DOMAIN) {
    throw new Error('Missing required environment variables: FRESHDESK_API_KEY and FRESHDESK_DOMAIN');
}

// Create axios instance with auth
const freshdeskApi = axios.create({
    baseURL: `https://${FRESHDESK_DOMAIN}/api/v2`,
    auth: {
        username: FRESHDESK_API_KEY,
        password: 'X' // Freshdesk API uses API key as username, password can be anything
    },
    headers: {
        'Content-Type': 'application/json'
    }
});

/**
 * Fetch list of articles in a folder using Freshdesk API
 */
async function fetchFolderArticles(folderId) {
    try {
        console.log(`[Freshdesk API] Fetching articles from folder ${folderId}...`);
        
        const response = await freshdeskApi.get(`/solutions/folders/${folderId}/articles`, {
            params: {
                per_page: 100 // Get up to 100 articles
            }
        });
        
        const articles = response.data.map(article => ({
            id: article.id.toString(),
            title: article.title,
            description: article.description,
            description_text: article.description_text,
            status: article.status,
            article_type: article.article_type,
            folder_id: article.folder_id,
            category_id: article.category_id,
            created_at: article.created_at,
            updated_at: article.updated_at,
            tags: article.tags || [],
            seo_data: article.seo_data || {}
        }));
        
        console.log(`[Freshdesk API] Found ${articles.length} articles`);
        return articles;
        
    } catch (error) {
        console.error('[Freshdesk API] Error fetching folder articles:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Fetch detailed content of a single article using Freshdesk API
 */
async function fetchArticleContent(articleId) {
    try {
        console.log(`[Freshdesk API] Fetching article ${articleId}...`);
        
        const response = await freshdeskApi.get(`/solutions/articles/${articleId}`);
        const article = response.data;
        
        return {
            id: article.id.toString(),
            title: article.title,
            description: article.description, // HTML content
            description_text: article.description_text, // Plain text
            status: article.status,
            created_at: article.created_at,
            updated_at: article.updated_at,
            tags: article.tags || [],
            attachments: article.attachments || []
        };
        
    } catch (error) {
        console.error(`[Freshdesk API] Error fetching article ${articleId}:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Fetch all FAQs from the folder with full content
 */
async function fetchAllFAQs() {
    try {
        console.log(`[Freshdesk API] Fetching FAQs from folder ${FAQ_FOLDER_ID}...`);
        
        const articles = await fetchFolderArticles(FAQ_FOLDER_ID);
        
        // Filter for published articles only and sort by title
        const publishedArticles = articles
            .filter(a => a.status === 2) // Status 2 = Published
            .sort((a, b) => a.title.localeCompare(b.title));
        
        console.log(`[Freshdesk API] Found ${publishedArticles.length} published articles`);
        
        const faqs = publishedArticles.map(article => ({
            id: article.id,
            title: article.title,
            html: article.description,
            text: article.description_text,
            url: `https://${FRESHDESK_DOMAIN}/support/solutions/articles/${article.id}`,
            created_at: article.created_at,
            updated_at: article.updated_at,
            tags: article.tags
        }));
        
        return faqs;
        
    } catch (error) {
        console.error('[Freshdesk API] Error in fetchAllFAQs:', error);
        throw error;
    }
}

module.exports = {
    fetchFolderArticles,
    fetchArticleContent,
    fetchAllFAQs
};

// CLI usage
if (require.main === module) {
    fetchAllFAQs()
        .then(faqs => {
            console.log('\n=== FAQ Results ===');
            console.log(JSON.stringify(faqs, null, 2));
            console.log(`\nTotal FAQs: ${faqs.length}`);
        })
        .catch(error => {
            console.error('Failed:', error);
            process.exit(1);
        });
}
