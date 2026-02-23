async function navigateTo(url) {
    const main = document.querySelector('main');
    const bgLayer = document.querySelector('.bg-layer');
    
    // 1. Add slide-out class
    main.classList.add('page-exit');
    bgLayer.classList.add('page-exit');
    
    // Determine direction based on current page?
    // For now, simple fade/slide out
    
    try {
        // 2. Fetch new content
        const response = await fetch(url);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        
        // Wait for exit animation
        await new Promise(resolve => setTimeout(resolve, 500)); // Match CSS transition duration
        
        // 3. Swap Content
        const newMain = doc.querySelector('main');
        const newBgLayer = doc.querySelector('.bg-layer');
        const newTitle = doc.querySelector('title').innerText;
        const newHeader = doc.querySelector('header');
        
        if (main && newMain) {
            main.innerHTML = newMain.innerHTML;
            main.className = newMain.className; // Update class (e.g. blog-view)
        }
        
        if (bgLayer && newBgLayer) {
            bgLayer.innerHTML = newBgLayer.innerHTML;
        }

        if (newHeader) {
            const header = document.querySelector('header');
            if (header) header.innerHTML = newHeader.innerHTML;
        }

        // Handle Footer
        const footer = document.querySelector('footer');
        const newFooter = doc.querySelector('footer');
        if (newFooter) {
            if (footer) {
                footer.outerHTML = newFooter.outerHTML;
            } else {
                document.body.insertBefore(newFooter, document.querySelector('script')); 
            }
        } else if (footer) {
            footer.remove();
        }

        // Handle Overlay
        const overlay = document.getElementById('post-overlay');
        const newOverlay = doc.getElementById('post-overlay');
        if (newOverlay) {
            if (overlay) {
                overlay.outerHTML = newOverlay.outerHTML;
            } else {
                document.body.insertBefore(newOverlay, document.querySelector('script'));
            }
        } else if (overlay) {
            overlay.remove();
        }
        
        // Update document title
        document.title = newTitle;
        
        // Update URL
        history.pushState({}, newTitle, url);
        
        // 4. Re-initialize scripts
        if (url === 'blog.html' || url.includes('blog.html')) {
            if (window.loadBlogs) {
                window.loadBlogs();
            }
        }
        
        // 5. Enter animation
        main.classList.remove('page-exit');
        bgLayer.classList.remove('page-exit');
        
        main.classList.add('page-enter');
        bgLayer.classList.add('page-enter');
        
        setTimeout(() => {
            main.classList.remove('page-enter');
            bgLayer.classList.remove('page-enter');
        }, 500);
        
    } catch (err) {
        console.error('Navigation failed:', err);
        window.location.href = url; // Fallback
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Check for file protocol
    if (window.location.protocol === 'file:') {
        console.warn('Page transitions require a local server (e.g. Live Server) due to CORS restrictions on file:// protocol.');
    }

    document.body.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;
        
        const href = link.getAttribute('href');
        // Check if internal link
        if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || link.target === '_blank' || href.endsWith('.pdf')) return;
        
        // Normalize paths if needed, but simple check works for this structure
        const currentPath = window.location.pathname.split('/').pop() || 'index.html';
        
        if (href === currentPath) {
            e.preventDefault(); // Do nothing if same page
            return;
        }

        if (href === 'index.html' || href === 'blog.html') {
            e.preventDefault();
            navigateTo(href);
        }
    });
    
    window.addEventListener('popstate', () => {
        window.location.reload();
    });
});
