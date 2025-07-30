/**
 * Safe Main JavaScript - Error-resistant implementation
 * Designed to prevent page hangs and provide graceful error handling
 */

(function() {
    'use strict';
    
    // エラーハンドリングラッパー
    function safeExecute(fn, context = '', fallback = null) {
        try {
            return fn();
        } catch (error) {
            console.warn(`[Safe JS] Error in ${context}:`, error.message);
            if (fallback && typeof fallback === 'function') {
                try {
                    return fallback(error);
                } catch (fallbackError) {
                    console.error(`[Safe JS] Fallback also failed in ${context}:`, fallbackError.message);
                }
            }
            return null;
        }
    }

    // パフォーマンス制限付きの処理実行
    function safeExecuteWithTimeout(fn, timeout = 1000, context = '') {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                console.warn(`[Safe JS] Timeout in ${context} after ${timeout}ms`);
                resolve(null);
            }, timeout);

            try {
                const result = fn();
                clearTimeout(timer);
                resolve(result);
            } catch (error) {
                clearTimeout(timer);
                console.warn(`[Safe JS] Error in ${context}:`, error.message);
                resolve(null);
            }
        });
    }

    // 基本機能の初期化
    function initBasicFeatures() {
        safeExecute(initStyles, 'initStyles');
        safeExecute(initSmoothScrolling, 'initSmoothScrolling');
        safeExecute(initSidebar, 'initSidebar');
        safeExecute(initTheme, 'initTheme');
    }

    // 重い処理の遅延初期化
    function initHeavyFeatures() {
        // 重い処理は100ms後に実行し、各処理に制限時間を設ける
        setTimeout(() => {
            safeExecuteWithTimeout(() => addHeadingIds(), 500, 'addHeadingIds');
            safeExecuteWithTimeout(() => generateTOC(), 500, 'generateTOC');
            safeExecuteWithTimeout(() => handleExternalLinks(), 300, 'handleExternalLinks');
            safeExecuteWithTimeout(() => enhanceImages(), 300, 'enhanceImages');
        }, 100);
    }

    // スタイルの安全な追加
    function initStyles() {
        const styles = `
            .js-loading { opacity: 0.5; }
            .js-error { border-left: 3px solid #ff6b6b; padding-left: 10px; }
            .js-timeout { opacity: 0.7; }
        `;
        
        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    // スムーススクロールの安全な初期化
    function initSmoothScrolling() {
        const links = document.querySelectorAll('a[href^="#"]');
        
        links.forEach(link => {
            link.addEventListener('click', function(e) {
                safeExecute(() => {
                    const targetId = this.getAttribute('href').substring(1);
                    const target = document.getElementById(targetId);
                    
                    if (target) {
                        e.preventDefault();
                        target.scrollIntoView({ behavior: 'smooth' });
                    }
                }, 'smoothScroll');
            });
        });
    }

    // サイドバーの安全な初期化
    function initSidebar() {
        const toggleButton = document.querySelector('.sidebar-toggle');
        const sidebar = document.querySelector('.book-sidebar');
        
        if (toggleButton && sidebar) {
            toggleButton.addEventListener('click', function() {
                safeExecute(() => {
                    sidebar.classList.toggle('open');
                }, 'sidebarToggle');
            });
        }
    }

    // テーマ切り替えの安全な初期化
    function initTheme() {
        const themeToggle = document.querySelector('.theme-toggle');
        
        if (themeToggle) {
            themeToggle.addEventListener('click', function() {
                safeExecute(() => {
                    const currentTheme = document.documentElement.getAttribute('data-theme');
                    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                    
                    document.documentElement.setAttribute('data-theme', newTheme);
                    localStorage.setItem('theme', newTheme);
                }, 'themeToggle');
            });
        }

        // 保存されたテーマの復元
        safeExecute(() => {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme) {
                document.documentElement.setAttribute('data-theme', savedTheme);
            }
        }, 'themeRestore');
    }

    // 見出しIDの安全な生成（簡素化バージョン）
    function addHeadingIds() {
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let idCounter = 0;
        
        // 処理件数制限（パフォーマンス保護）
        const maxHeadings = Math.min(headings.length, 100);
        
        for (let i = 0; i < maxHeadings; i++) {
            const heading = headings[i];
            if (!heading.id) {
                // 複雑な正規表現を避けて、シンプルなID生成
                heading.id = `heading-${++idCounter}`;
            }
        }
        
        if (headings.length > maxHeadings) {
            console.warn(`[Safe JS] Processed only ${maxHeadings} headings out of ${headings.length} for performance reasons`);
        }
    }

    // TOC生成の安全な実装
    function generateTOC() {
        const tocContainer = document.querySelector('.page-toc');
        if (!tocContainer) return;

        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length === 0) return;

        const tocList = document.createElement('ul');
        tocList.className = 'toc-list';

        // 処理件数制限
        const maxTocItems = Math.min(headings.length, 50);
        
        for (let i = 0; i < maxTocItems; i++) {
            const heading = headings[i];
            if (!heading.id) continue;

            const listItem = document.createElement('li');
            listItem.className = 'toc-item';
            
            const link = document.createElement('a');
            link.href = `#${heading.id}`;
            link.textContent = heading.textContent.substring(0, 100); // 長さ制限
            link.className = 'toc-link';
            
            listItem.appendChild(link);
            tocList.appendChild(listItem);
        }

        tocContainer.innerHTML = '';
        tocContainer.appendChild(tocList);
    }

    // 外部リンクの安全な処理
    function handleExternalLinks() {
        const links = document.querySelectorAll('a[href^="http"]');
        
        // 処理件数制限
        const maxLinks = Math.min(links.length, 200);
        
        for (let i = 0; i < maxLinks; i++) {
            const link = links[i];
            if (!link.hasAttribute('target')) {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            }
        }
    }

    // 画像の安全な強化
    function enhanceImages() {
        const images = document.querySelectorAll('img');
        
        // 処理件数制限
        const maxImages = Math.min(images.length, 100);
        
        for (let i = 0; i < maxImages; i++) {
            const img = images[i];
            
            // 遅延読み込み
            if (!img.hasAttribute('loading')) {
                img.setAttribute('loading', 'lazy');
            }
            
            // エラーハンドリング
            img.addEventListener('error', function() {
                this.style.display = 'none';
                console.warn('[Safe JS] Image failed to load:', this.src);
            });
        }
    }

    // DOMContentLoaded時の初期化
    document.addEventListener('DOMContentLoaded', function() {
        console.log('[Safe JS] Initializing safe JavaScript features...');
        
        // 基本機能をすぐに実行
        initBasicFeatures();
        
        // 重い処理は遅延実行
        initHeavyFeatures();
        
        console.log('[Safe JS] Safe JavaScript initialization completed');
    });

    // 未処理エラーのキャッチ
    window.addEventListener('error', function(event) {
        console.warn('[Safe JS] Uncaught error:', event.error);
        // エラーがあってもページの動作は継続
        return true;
    });

    // Promise rejection のキャッチ
    window.addEventListener('unhandledrejection', function(event) {
        console.warn('[Safe JS] Unhandled promise rejection:', event.reason);
        // エラーがあってもページの動作は継続
        event.preventDefault();
    });

})();