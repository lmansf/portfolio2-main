function syncBodyElement(currentSelector, incomingDoc) {
    const currentElement = document.querySelector(currentSelector);
    const incomingElement = incomingDoc.querySelector(currentSelector);

    if (incomingElement) {
        if (currentElement) {
            currentElement.outerHTML = incomingElement.outerHTML;
        } else {
            document.body.insertBefore(incomingElement, document.querySelector('script'));
        }
    } else if (currentElement) {
        currentElement.remove();
    }
}

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

        // Handle overlays and modal containers outside <main>
        syncBodyElement('#post-overlay', doc);
        syncBodyElement('.project-modal-overlay', doc);
        activeProjectModal = null;
        
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

let activeProjectModal = null;

function openProjectModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    activeProjectModal = modal;
}

function closeProjectModal(modal) {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (activeProjectModal === modal) {
        activeProjectModal = null;
    }
}

function shudderDisabledBlog(link) {
    if (!link) return;
    link.classList.remove('blog-shuddering');
    void link.offsetWidth;
    link.classList.add('blog-shuddering');
}

let blogHoverPopup = null;

function ensureBlogHoverPopup() {
    if (blogHoverPopup && document.body.contains(blogHoverPopup)) return blogHoverPopup;
    blogHoverPopup = document.createElement('div');
    blogHoverPopup.className = 'blog-hover-popup';
    blogHoverPopup.textContent = 'This page is under construction';
    document.body.appendChild(blogHoverPopup);
    return blogHoverPopup;
}

function moveBlogHoverPopup(e) {
    if (!blogHoverPopup) return;
    blogHoverPopup.style.left = `${e.clientX + 12}px`;
    blogHoverPopup.style.top = `${e.clientY + 12}px`;
}

function showBlogHoverPopup(e) {
    const popup = ensureBlogHoverPopup();
    moveBlogHoverPopup(e);
    popup.classList.add('is-visible');
}

function hideBlogHoverPopup() {
    if (!blogHoverPopup) return;
    blogHoverPopup.classList.remove('is-visible');
}

document.addEventListener('DOMContentLoaded', () => {
    // Check for file protocol
    if (window.location.protocol === 'file:') {
        console.warn('Page transitions require a local server (e.g. Live Server) due to CORS restrictions on file:// protocol.');
    }

    document.body.addEventListener('click', (e) => {
        const disabledBlogLink = e.target.closest('a[data-disabled-blog="true"]');
        if (disabledBlogLink) {
            e.preventDefault();
            hideBlogHoverPopup();
            shudderDisabledBlog(disabledBlogLink);
            return;
        }

        const modalTrigger = e.target.closest('[data-project-modal-open]');
        if (modalTrigger) {
            e.preventDefault();
            openProjectModal(modalTrigger.getAttribute('data-project-modal-open'));
            return;
        }

        const modalClose = e.target.closest('[data-project-modal-close]');
        if (modalClose) {
            closeProjectModal(modalClose.closest('.project-modal-overlay'));
            return;
        }

        const modalBackdrop = e.target.closest('.project-modal-overlay');
        if (modalBackdrop && e.target === modalBackdrop) {
            closeProjectModal(modalBackdrop);
            return;
        }

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

        if (href === 'index.html' || href === 'blog.html' || href === 'projects.html') {
            e.preventDefault();
            navigateTo(href);
        }
    });

    document.body.addEventListener('mouseenter', (e) => {
        const disabledBlogLink = e.target.closest('a[data-disabled-blog="true"]');
        if (!disabledBlogLink) return;
        showBlogHoverPopup(e);
    }, true);

    document.body.addEventListener('mousemove', (e) => {
        const disabledBlogLink = e.target.closest('a[data-disabled-blog="true"]');
        if (!disabledBlogLink) return;
        showBlogHoverPopup(e);
    });

    document.body.addEventListener('mouseleave', (e) => {
        const disabledBlogLink = e.target.closest('a[data-disabled-blog="true"]');
        if (!disabledBlogLink) return;
        hideBlogHoverPopup();
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && activeProjectModal) {
            closeProjectModal(activeProjectModal);
        }
    });
    
    window.addEventListener('popstate', () => {
        window.location.reload();
    });
});
