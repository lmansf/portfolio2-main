// Supabase Configuration
const SUPABASE_URL = 'https://xcubnwvyvhjfyiixunfg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_K5k9vLXtDUo8qoyWrwX3qg_qN_3xWfy';

const CACHE_KEY = 'portfolio_blogs_cache';
const CACHE_TIME_KEY = 'portfolio_blogs_cache_time';
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let supabaseClient;

function initSupabase() {
    if (window.supabase && !supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
}

// Function to fetch fresh data from Supabase without using cache
async function fetchFreshBlogs(isBackgroundUpdate = false) {
    initSupabase();
    if (!supabaseClient) return;

    const blogGrid = document.getElementById('blog-grid');
    if (!blogGrid) return;

    console.log('Fetching fresh blogs from Supabase...');
    try {
        const { data, error } = await supabaseClient
            .from('blogposts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        const blogs = data || [];
        // Update cache
        localStorage.setItem(CACHE_KEY, JSON.stringify(blogs));
        localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
        
        renderBlogs(blogs, blogGrid);
    } catch (err) {
        console.error('Error fetching blogs:', err);
    }
}

// Realtime Subscription Setup
function setupRealtime() {
    initSupabase();
    if (!supabaseClient) return;

    const channel = supabaseClient
        .channel('public:blogposts')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'blogposts' },
            (payload) => {
                console.log('Change received!', payload);
                fetchFreshBlogs(true);
            }
        )
        .subscribe();
}

async function loadBlogs() {
    const blogGrid = document.getElementById('blog-grid');
    if (!blogGrid) return;

    initSupabase();

    const now = Date.now();
    const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
    const cachedBlogs = localStorage.getItem(CACHE_KEY);

    // 1. Render cache immediately for speed (Stale-while-revalidate)
    if (cachedBlogs) {
        console.log('Displaying cached blogs while fetching fresh data...');
        renderBlogs(JSON.parse(cachedBlogs), blogGrid);
    }

    // 2. ALWAYS fetch fresh data to ensure we show the latest posts
    // This fixes the issue where new posts don't appear if cache is "valid"
    await fetchFreshBlogs();

    // 3. Set up Realtime listener to catch any new events
    setupRealtime();
    
    setupOverlay();
}

function renderBlogs(blogs, container) {
    container.innerHTML = '';
    
    if (!blogs) {
        container.innerHTML = '<div class="blog-empty-state"><p>No blog posts found.</p></div>';
        return;
    }

    console.log('Received blogs from Supabase:', blogs); // DEBUG: Check console for actual column names

    // Filter: Ensure we have at least some content
    const validBlogs = blogs.filter(post => {
        // Check if 'blog' OR 'content' column exists
        const content = post.blog || post.content || post.body;
        return content && content.trim().length > 0;
    });

    if (validBlogs.length === 0) {
        container.innerHTML = '<div class="blog-empty-state"><p>No blog posts found.</p></div>';
        return;
    }

    validBlogs.forEach(post => {
        const card = document.createElement('div');
        card.className = 'project-card';
        
        // COLUMN MAPPING: Adjust these if your Supabase columns are named differently
        const bgImage = post.image_url || post.cover_image || post.image || 'assets/crane.jpg'; 
        const category = post.category || post.tags || 'Update';

        // Format Date
        let dateStr = '';
        if (post.created_at) {
            const dateObj = new Date(post.created_at);
            if (!isNaN(dateObj)) {
                dateStr = dateObj.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
            }
        }
        
        // Content mapping - check 'blog', then 'content', then 'body'
        let rawMarkdown = post.blog || post.content || post.body || '';
        
        let title = 'Untitled Post';

        // 1. Try explicit 'title' column first
        if (post.title) {
            title = post.title;
        } else {
            // 2. Fallback: Parse first line of markdown if it looks like a header
            const lines = rawMarkdown.split('\n');
            if (lines.length > 0 && lines[0].trim().startsWith('# ')) {
                title = lines[0].replace('# ', '').trim();
                // Optional: remove title from body if duplicated
                // lines.shift(); 
                // rawMarkdown = lines.join('\n').trim(); 
            }
        }
        
        // Create plain text excerpt for card
        // Remove markdown syntax for cleaner preview
        const excerpt = rawMarkdown
            .replace(/[#*`_\[\]]/g, '') // Remove basic markdown chars
            .replace(/\(http[^)]+\)/g, '') // Remove links
            .substring(0, 150) + '...';
        
        // Parse full HTML for overlay
        const parsedHtml = (typeof marked !== 'undefined') ? marked.parse(rawMarkdown) : rawMarkdown;

        card.innerHTML = `
            <div class="project-card-content">
                <div>
                    <div class="blog-card-meta">
                        <span class="project-tag">${category}</span>
                        <span class="blog-card-date">${dateStr}</span>
                    </div>
                    <h2>${title}</h2>
                    <p class="post-excerpt">${excerpt}</p>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            openPostOverlay(title, category, dateStr, bgImage, parsedHtml, card);
        });

        container.appendChild(card);
    });
}

// Overlay Logic
function setupOverlay() {
    const postOverlay = document.getElementById('post-overlay');
    const postOverlayClose = document.getElementById('post-overlay-close');
    
    if (postOverlayClose && postOverlay) {
        // Remove existing listener to avoid duplicates if re-run
        const newClose = postOverlayClose.cloneNode(true);
        postOverlayClose.parentNode.replaceChild(newClose, postOverlayClose);
        
        newClose.addEventListener('click', () => {
            postOverlay.style.display = 'none';
            document.body.style.overflow = '';
        });
    }
}

function openPostOverlay(title, category, date, bgImage, parsedHtml, card) {
    const postOverlay = document.getElementById('post-overlay');
    if (!postOverlay) return;
    
    const overlayImage = document.getElementById('post-overlay-image');
    if (overlayImage) overlayImage.style.display = 'none'; 
    
    const overlayCategory = document.getElementById('post-overlay-category');
    if (overlayCategory) overlayCategory.textContent = category;
    
    const overlayTitle = document.getElementById('post-overlay-title');
    if (overlayTitle) overlayTitle.textContent = title;
    
    const overlayDate = document.getElementById('post-overlay-date');
    if (overlayDate) overlayDate.textContent = date;
    
    const overlayContent = document.getElementById('post-overlay-content');
    if (overlayContent) overlayContent.innerHTML = parsedHtml;
    
    postOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

document.addEventListener('DOMContentLoaded', loadBlogs);
// Export loadBlogs to be called manually
window.loadBlogs = loadBlogs;
