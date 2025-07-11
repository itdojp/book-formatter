/**
 * Sidebar toggle functionality
 */

(function() {
    'use strict';
    
    let sidebar;
    let sidebarToggle;
    let sidebarOverlay;
    let mainContent;
    
    // Initialize elements
    function initElements() {
        sidebar = document.getElementById('sidebar');
        sidebarToggle = document.querySelector('.sidebar-toggle');
        sidebarOverlay = document.getElementById('sidebar-overlay');
        mainContent = document.querySelector('.book-main');
    }
    
    // Toggle sidebar
    function toggleSidebar() {
        if (!sidebar) return;
        
        const isActive = sidebar.classList.contains('active');
        
        if (isActive) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }
    
    // Open sidebar
    function openSidebar() {
        if (!sidebar) return;
        
        sidebar.classList.add('active');
        sidebarOverlay?.classList.add('active');
        sidebarToggle?.setAttribute('aria-expanded', 'true');
        
        // Prevent body scroll on mobile
        if (window.innerWidth <= 1024) {
            document.body.style.overflow = 'hidden';
        }
    }
    
    // Close sidebar
    function closeSidebar() {
        if (!sidebar) return;
        
        sidebar.classList.remove('active');
        sidebarOverlay?.classList.remove('active');
        sidebarToggle?.setAttribute('aria-expanded', 'false');
        
        // Restore body scroll
        document.body.style.overflow = '';
    }
    
    // Handle window resize
    function handleResize() {
        if (window.innerWidth > 1024) {
            // Desktop: ensure sidebar is visible
            closeSidebar(); // This will clean up any mobile-specific states
        }
    }
    
    // Highlight active link
    function highlightActiveLink() {
        const currentPath = window.location.pathname;
        const links = document.querySelectorAll('.toc-link');
        
        links.forEach(link => {
            const linkPath = new URL(link.href).pathname;
            
            if (linkPath === currentPath) {
                link.classList.add('active');
                
                // Scroll the active link into view
                const sidebar = link.closest('.book-sidebar');
                if (sidebar) {
                    const linkRect = link.getBoundingClientRect();
                    const sidebarRect = sidebar.getBoundingClientRect();
                    
                    if (linkRect.top < sidebarRect.top || linkRect.bottom > sidebarRect.bottom) {
                        link.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }
                }
            } else {
                link.classList.remove('active');
            }
        });
    }
    
    // Initialize sidebar
    function initSidebar() {
        initElements();
        
        // Add event listeners
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', toggleSidebar);
        }
        
        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', closeSidebar);
        }
        
        // Handle resize
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(handleResize, 250);
        });
        
        // Handle escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar?.classList.contains('active')) {
                closeSidebar();
            }
        });
        
        // Highlight active link
        highlightActiveLink();
        
        // Re-highlight on navigation (for SPAs)
        window.addEventListener('popstate', highlightActiveLink);
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSidebar);
    } else {
        initSidebar();
    }
})();