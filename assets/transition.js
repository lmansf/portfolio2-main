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
    return ['index.html', 'projects.html', 'shop.html', 'blog.html', 'resume.html', 'feedback.html'].includes(path);
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

function getPageScriptDescriptors(doc) {
    return Array.from(doc.querySelectorAll('script[src]'))
        .map((script) => ({
            src: script.getAttribute('src'),
            type: script.getAttribute('type') || 'text/javascript'
        }))
        .filter((script) => {
            if (!script.src) return false;
            const normalizedSrc = script.src.toLowerCase();
            if (normalizedSrc.includes('/_vercel/insights/script.js')) return false;
            if (normalizedSrc.endsWith('assets/transition.js')) return false;
            return true;
        });
}

async function syncPageScripts(incomingDoc) {
    const scripts = getPageScriptDescriptors(incomingDoc);
    for (const { src, type } of scripts) {
        if (document.querySelector(`script[src="${src}"]`)) continue;

        const scriptElement = document.createElement('script');
        scriptElement.src = src;
        if (type && type !== 'text/javascript') {
            scriptElement.type = type;
        }
        scriptElement.defer = true;

        await new Promise((resolve) => {
            scriptElement.addEventListener('load', resolve, { once: true });
            scriptElement.addEventListener('error', resolve, { once: true });
            document.body.appendChild(scriptElement);
        });
    }
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
    if (navigateTo.isNavigating) return;
    navigateTo.isNavigating = true;

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
        await syncPageScripts(doc);
        
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
        if (normalizedTarget === 'blog.html' && window.loadBlogs) {
            window.loadBlogs();
        }

        if (normalizedTarget === 'shop.html' && window.initializeShopPage) {
            window.initializeShopPage();
        }
        
        // 5. Enter animation
        const enterTargets = [main, document.querySelector('.bg-layer')].filter(Boolean);
        enterTargets.forEach((element) => {
            element.classList.remove('page-exit');
            element.classList.add('page-enter');
        });

        applyBlogUnlockState();
        setupInteractiveSnake();

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
    } finally {
        navigateTo.isNavigating = false;
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

const BLOG_UNLOCK_KEY = 'portfolio_blog_unlocked';
const BLOG_UNLOCK_LEGACY_KEY = 'portfolio_blog_unlocked';
let interactiveSnakeHandle = null;
let isSnakeDragging = false;
let snakePointerOffsetX = 0;
let snakePointerOffsetY = 0;

function getStorageValue(key) {
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function setStorageValue(key, value) {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        // no-op when storage is unavailable
    }
}

function removeLegacyUnlockState() {
    try {
        localStorage.removeItem(BLOG_UNLOCK_LEGACY_KEY);
    } catch {
        // no-op when storage is unavailable
    }
}

function getLockedBlogLinkFromEventTarget(target) {
    if (!target || !(target instanceof Element)) return null;
    const link = target.closest('a[href]');
    if (!link) return null;
    const isBlogTarget = normalizeInternalPath(link.getAttribute('href') || '') === 'blog.html' || link.textContent.trim().toLowerCase() === 'blog';
    if (!isBlogTarget) return null;
    return isBlogUnlocked() ? null : link;
}

function isBlogUnlocked() {
    return getStorageValue(BLOG_UNLOCK_KEY) === 'true';
}

function setBlogUnlocked(unlocked) {
    setStorageValue(BLOG_UNLOCK_KEY, unlocked ? 'true' : 'false');
}

function applyBlogUnlockState(root = document) {
    const links = root.querySelectorAll('a[data-disabled-blog="true"], a.blog-disabled');
    const unlocked = isBlogUnlocked();

    links.forEach((link) => {
        if (unlocked) {
            link.classList.remove('blog-disabled', 'blog-shuddering');
            link.removeAttribute('data-disabled-blog');
            link.removeAttribute('aria-disabled');
            link.setAttribute('href', 'blog.html');
            return;
        }

        link.classList.add('blog-disabled');
        link.setAttribute('data-disabled-blog', 'true');
        link.setAttribute('aria-disabled', 'true');
        if (normalizeInternalPath(window.location.pathname) !== 'blog.html') {
            link.setAttribute('href', 'blog.html');
        }
    });

    if (unlocked) {
        hideBlogHoverPopup();
    }
}

function isPointInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isDroppedOnBlogTarget(x, y) {
    const blogTargets = Array.from(document.querySelectorAll('header .nav-links a')).filter((link) => {
        const href = normalizeInternalPath(link.getAttribute('href') || '');
        return href === 'blog.html' || link.textContent.trim().toLowerCase() === 'blog';
    });

    return blogTargets.some((target) => isPointInsideRect(x, y, target.getBoundingClientRect()));
}

function positionSnakeAtPoint(clientX, clientY) {
    if (!interactiveSnakeHandle) return;
    interactiveSnakeHandle.style.left = `${clientX - snakePointerOffsetX}px`;
    interactiveSnakeHandle.style.top = `${clientY - snakePointerOffsetY}px`;
}

function moveSnakeDrag(e) {
    if (!interactiveSnakeHandle || !isSnakeDragging) return;
    positionSnakeAtPoint(e.clientX, e.clientY);
}

function stopSnakeDrag(e) {
    if (!interactiveSnakeHandle || !isSnakeDragging) return;

    isSnakeDragging = false;
    interactiveSnakeHandle.classList.remove('is-dragging');
    positionSnakeAtPoint(e.clientX, e.clientY);

    document.removeEventListener('pointermove', moveSnakeDrag);
    document.removeEventListener('pointerup', stopSnakeDrag);

    if (isDroppedOnBlogTarget(e.clientX, e.clientY)) {
        setBlogUnlocked(true);
        applyBlogUnlockState();
    }
}

function startSnakeDrag(e) {
    if (!interactiveSnakeHandle || e.button !== 0) return;
    e.preventDefault();

    const rect = interactiveSnakeHandle.getBoundingClientRect();
    snakePointerOffsetX = e.clientX - rect.left;
    snakePointerOffsetY = e.clientY - rect.top;

    interactiveSnakeHandle.style.position = 'fixed';
    interactiveSnakeHandle.style.margin = '0';
    interactiveSnakeHandle.style.zIndex = '10060';
    positionSnakeAtPoint(e.clientX, e.clientY);
    document.body.appendChild(interactiveSnakeHandle);

    isSnakeDragging = true;
    interactiveSnakeHandle.classList.add('is-dragging');

    document.addEventListener('pointermove', moveSnakeDrag);
    document.addEventListener('pointerup', stopSnakeDrag);
}

function setupInteractiveSnake() {
    if (interactiveSnakeHandle) {
        interactiveSnakeHandle.removeEventListener('pointerdown', startSnakeDrag);
        if (!interactiveSnakeHandle.closest('.marquee-content')) {
            interactiveSnakeHandle.remove();
        }
    }

    const snakeSpans = Array.from(document.querySelectorAll('.marquee-content span')).filter((span) => {
        return span.textContent.includes('🐍');
    });

    const secondSnakeSpan = snakeSpans[1];
    if (!secondSnakeSpan) {
        interactiveSnakeHandle = null;
        return;
    }

    const snakeText = secondSnakeSpan.textContent || '';
    const pythonText = snakeText.replace('🐍', '').trim();

    secondSnakeSpan.textContent = '';

    const snakeHandle = document.createElement('span');
    snakeHandle.className = 'marquee-snake-handle';
    snakeHandle.textContent = '🐍';
    secondSnakeSpan.appendChild(snakeHandle);

    if (pythonText) {
        secondSnakeSpan.append(` ${pythonText}`);
    }

    interactiveSnakeHandle = snakeHandle;
    interactiveSnakeHandle.addEventListener('pointerdown', startSnakeDrag);
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
    setBlogUnlocked(false);
    removeLegacyUnlockState();
    applyBlogUnlockState();
    setupInteractiveSnake();

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

        const disabledBlogLink = getLockedBlogLinkFromEventTarget(e.target);
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
        if (!href) return;

        if (href === '#') {
            e.preventDefault();
            closeMobileNav();
            return;
        }

        if (href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || link.target === '_blank' || href.endsWith('.pdf')) return;

        closeMobileNav();

        const normalizedHref = normalizeInternalPath(href);
        const currentPath = normalizeInternalPath(window.location.pathname);

        if (normalizedHref === 'index.html' && currentPath !== 'index.html') {
            e.preventDefault();
            window.location.href = 'index.html';
            return;
        }

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
        const disabledBlogLink = getLockedBlogLinkFromEventTarget(e.target);
        if (!disabledBlogLink) return;
        showBlogHoverPopup(e);
    }, true);

    document.body.addEventListener('mousemove', (e) => {
        const disabledBlogLink = getLockedBlogLinkFromEventTarget(e.target);
        if (!disabledBlogLink) return;
        showBlogHoverPopup(e);
    }, { passive: true });

    document.body.addEventListener('mouseleave', (e) => {
        const disabledBlogLink = getLockedBlogLinkFromEventTarget(e.target);
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
