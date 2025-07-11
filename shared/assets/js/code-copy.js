/**
 * Code copy functionality
 */

(function() {
    'use strict';
    
    // Add copy buttons to all code blocks
    function addCopyButtons() {
        const codeBlocks = document.querySelectorAll('pre > code');
        
        codeBlocks.forEach(block => {
            // Skip if already has a copy button
            if (block.parentElement.querySelector('.copy-button')) {
                return;
            }
            
            // Create wrapper
            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';
            
            // Wrap the pre element
            const pre = block.parentElement;
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);
            
            // Create copy button
            const button = document.createElement('button');
            button.className = 'copy-button';
            button.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Copy</span>
            `;
            
            wrapper.appendChild(button);
            
            // Add click handler
            button.addEventListener('click', () => copyCode(block, button));
        });
    }
    
    // Copy code to clipboard
    async function copyCode(codeBlock, button) {
        const code = codeBlock.textContent;
        
        try {
            await navigator.clipboard.writeText(code);
            
            // Show success state
            button.classList.add('copied');
            button.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Copied!</span>
            `;
            
            // Reset after 2 seconds
            setTimeout(() => {
                button.classList.remove('copied');
                button.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>Copy</span>
                `;
            }, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
            
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = code;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            
            try {
                document.execCommand('copy');
                button.classList.add('copied');
                button.querySelector('span').textContent = 'Copied!';
                
                setTimeout(() => {
                    button.classList.remove('copied');
                    button.querySelector('span').textContent = 'Copy';
                }, 2000);
            } catch (err) {
                console.error('Fallback copy failed:', err);
            }
            
            document.body.removeChild(textArea);
        }
    }
    
    // Add language labels to code blocks
    function addLanguageLabels() {
        const codeBlocks = document.querySelectorAll('pre > code[class*="language-"]');
        
        codeBlocks.forEach(block => {
            const pre = block.parentElement;
            
            // Extract language from class
            const match = block.className.match(/language-(\w+)/);
            if (match) {
                const language = match[1];
                pre.setAttribute('data-lang', language);
            }
        });
    }
    
    // Initialize
    function initCodeFeatures() {
        addCopyButtons();
        addLanguageLabels();
        
        // Watch for dynamically added code blocks
        const observer = new MutationObserver(() => {
            addCopyButtons();
            addLanguageLabels();
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCodeFeatures);
    } else {
        initCodeFeatures();
    }
})();