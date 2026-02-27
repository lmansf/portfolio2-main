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

function animateProjectsLoadIn() {
    const main = document.querySelector('main.projects-view');
    if (!main) return;

    const animationTargets = [
        document.querySelector('.bg-layer'),
        main.querySelector('.projects-intro'),
        main.querySelector('.projects-layout'),
        document.querySelector('footer .footer-socials')
    ].filter(Boolean);

    animationTargets.forEach((element) => {
        element.classList.remove('projects-load-enter');
        void element.offsetWidth;
        element.classList.add('projects-load-enter');
    });

    setTimeout(() => {
        animationTargets.forEach((element) => {
            element.classList.remove('projects-load-enter');
        });
    }, 500);
}

function normalizeInternalPath(url) {
    const cleanedUrl = (url || '').split('#')[0].split('?')[0];
    if (!cleanedUrl || cleanedUrl === '/' || cleanedUrl === './') return 'index.html';
    return (cleanedUrl.split('/').pop() || 'index.html').toLowerCase();
}

function isTransitionPage(path) {
    return ['index.html', 'projects.html', 'blog.html', 'resume.html', 'feedback.html'].includes(path);
}

function isAtsResumeLink(link) {
    if (!link) return false;
    const href = (link.getAttribute('href') || '').toLowerCase();
    return href.endsWith('assets/resume_ats.txt') || href.endsWith('/assets/resume_ats.txt');
}

function getManagedStylesheet(doc) {
    return Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).find((link) => {
        const href = (link.getAttribute('href') || '').toLowerCase();
        return href.includes('assets/index.css') || href.includes('assets/style.css');
    }) || null;
}

async function syncManagedStylesheet(incomingDoc) {
    const incomingStylesheet = getManagedStylesheet(incomingDoc);
    if (!incomingStylesheet) return;

    const incomingHref = incomingStylesheet.getAttribute('href');
    const currentStylesheet = getManagedStylesheet(document);

    if (!incomingHref) return;

    if (currentStylesheet) {
        const currentHref = currentStylesheet.getAttribute('href');
        if (currentHref === incomingHref) return;

        await new Promise((resolve) => {
            currentStylesheet.addEventListener('load', resolve, { once: true });
            currentStylesheet.addEventListener('error', resolve, { once: true });
            currentStylesheet.setAttribute('href', incomingHref);
        });
        return;
    }

    const newStylesheet = incomingStylesheet.cloneNode(true);
    await new Promise((resolve) => {
        newStylesheet.addEventListener('load', resolve, { once: true });
        newStylesheet.addEventListener('error', resolve, { once: true });
        document.head.appendChild(newStylesheet);
    });
}

async function navigateTo(url, options = {}) {
    const { updateHistory = true } = options;
    const main = document.querySelector('main');
    const normalizedTarget = normalizeInternalPath(url);
    const isProjectsDestination = normalizedTarget === 'projects.html';
    const exitTargets = [main, document.querySelector('.bg-layer')].filter(Boolean);
    
    exitTargets.forEach((element) => {
        element.classList.add('page-exit');
    });
    
    try {
        // 2. Fetch new content
        const response = await fetch(url);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');

        await syncManagedStylesheet(doc);
        
        // Wait for exit animation
        await new Promise(resolve => setTimeout(resolve, 500)); // Match CSS transition duration
        
        // 3. Swap Content
        const newMain = doc.querySelector('main');
        const newTitle = doc.querySelector('title').innerText;
        const newHeader = doc.querySelector('header');
        
        if (main && newMain) {
            main.innerHTML = newMain.innerHTML;
            main.className = newMain.className; // Update class (e.g. blog-view)
        }
        
        syncBodyElement('.bg-layer', doc);

        if (newHeader) {
            const header = document.querySelector('header');
            if (header) header.innerHTML = newHeader.innerHTML;
            closeMobileNav();
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
        if (updateHistory) {
            history.pushState({}, newTitle, url);
        }
        
        // 4. Re-initialize scripts
        if (url === 'blog.html' || url.includes('blog.html')) {
            if (window.loadBlogs) {
                window.loadBlogs();
            }
        }
        
        // 5. Enter animation
        const enterTargets = [main, document.querySelector('.bg-layer')].filter(Boolean);
        enterTargets.forEach((element) => {
            element.classList.remove('page-exit');
            element.classList.add('page-enter');
        });

        if (isProjectsDestination) {
            animateProjectsLoadIn();
        }
        
        setTimeout(() => {
            enterTargets.forEach((element) => {
                element.classList.remove('page-enter');
            });
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
let popupFrameRequested = false;
let popupX = 0;
let popupY = 0;

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
    popupX = e.clientX + 12;
    popupY = e.clientY + 12;

    if (popupFrameRequested) return;
    popupFrameRequested = true;

    requestAnimationFrame(() => {
        if (!blogHoverPopup) {
            popupFrameRequested = false;
            return;
        }
        blogHoverPopup.style.left = `${popupX}px`;
        blogHoverPopup.style.top = `${popupY}px`;
        popupFrameRequested = false;
    });
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

function setMobileNavExpanded(isExpanded) {
    const navToggle = document.querySelector('[data-nav-toggle]');
    if (!navToggle) return;
    navToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
}

function closeMobileNav() {
    document.body.classList.remove('mobile-nav-open');
    setMobileNavExpanded(false);
}

function toggleMobileNav() {
    const shouldOpen = !document.body.classList.contains('mobile-nav-open');
    document.body.classList.toggle('mobile-nav-open', shouldOpen);
    setMobileNavExpanded(shouldOpen);
}

document.addEventListener('DOMContentLoaded', () => {
    // Check for file protocol
    if (window.location.protocol === 'file:') {
        console.warn('Page transitions require a local server (e.g. Live Server) due to CORS restrictions on file:// protocol.');
    }

    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    if (currentPath === 'projects.html') {
        animateProjectsLoadIn();
    }

    const initialTargets = [document.querySelector('main'), document.querySelector('.bg-layer')].filter(Boolean);
    initialTargets.forEach((element) => {
        element.classList.add('page-initial-state');
    });
    requestAnimationFrame(() => {
        initialTargets.forEach((element) => {
            element.classList.add('page-initial-enter');
            element.classList.remove('page-initial-state');
        });

        setTimeout(() => {
            initialTargets.forEach((element) => {
                element.classList.remove('page-initial-enter');
            });
        }, 500);
    });

    closeMobileNav();

    window.addEventListener('resize', () => {
        if (window.innerWidth > 900) {
            closeMobileNav();
        }
    });

    document.body.addEventListener('click', (e) => {
        const navToggle = e.target.closest('[data-nav-toggle]');
        if (navToggle) {
            e.preventDefault();
            toggleMobileNav();
            return;
        }

        if (document.body.classList.contains('mobile-nav-open') && !e.target.closest('header')) {
            closeMobileNav();
        }

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

        if (isAtsResumeLink(link)) {
            const shouldLeave = window.confirm('You are leaving the portfolio site to open the ATS Resume. Select OK to continue or Cancel to stay on the portfolio.');
            if (!shouldLeave) {
                e.preventDefault();
            }
            closeMobileNav();
            return;
        }
        
        const href = link.getAttribute('href');
        // Check if internal link
        if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || link.target === '_blank' || href.endsWith('.pdf')) return;

        closeMobileNav();

        const normalizedHref = normalizeInternalPath(href);
        const currentPath = normalizeInternalPath(window.location.pathname);

        if (normalizedHref === currentPath) {
            e.preventDefault(); // Do nothing if same page
            return;
        }

        if (isTransitionPage(normalizedHref)) {
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
    }, { passive: true });

    document.body.addEventListener('mouseleave', (e) => {
        const disabledBlogLink = e.target.closest('a[data-disabled-blog="true"]');
        if (!disabledBlogLink) return;
        hideBlogHoverPopup();
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('mobile-nav-open')) {
            closeMobileNav();
        }

        if (e.key === 'Escape' && activeProjectModal) {
            closeProjectModal(activeProjectModal);
        }
    });
    
    window.addEventListener('popstate', async () => {
        const path = normalizeInternalPath(window.location.pathname);
        if (isTransitionPage(path)) {
            await navigateTo(path, { updateHistory: false });
            return;
        }
        window.location.reload();
    });
});
