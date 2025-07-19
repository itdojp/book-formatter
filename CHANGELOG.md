# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2025-07-19

### Fixed
- **Performance Issues**: Fixed JavaScript browser freeze caused by heavy DOM processing
  - Optimized `addHeadingIds()` function with heading count limit (max 50)
  - Added deferred initialization using setTimeout for heavy operations
  - Simplified regex patterns for better performance
  - Added error handling for all DOM operations

### Improved
- **Layout System**: Enhanced page layout and navigation
  - Fixed page navigation display on all pages
  - Improved page content minimum height and spacing
  - Added flexbox layout for proper content distribution
  - Fixed excessive whitespace at page bottom

### Added
- **Documentation**: Added comprehensive performance guide
  - New `PERFORMANCE_GUIDE.md` with troubleshooting steps
  - Updated `book-creation-guide.md` with performance warnings
  - Added performance monitoring recommendations

### Changed
- **Templates**: Updated layout templates for better reliability
  - Removed conditional navigation display that caused missing navigation
  - Added performance notes for script loading
  - Improved CSS for consistent page layout

## [1.0.0] - 2025-07-10

### Added

#### Core Features (Issue #2)
- BookGenerator class for configuration-driven book generation
- ConfigValidator for comprehensive configuration validation
- TemplateEngine with Handlebars-like syntax
- FileSystemUtils for safe file operations
- CLI interface with multiple commands:
  - `init` - Generate sample configuration
  - `create-book` - Create new book from config
  - `update-book` - Update existing book structure
  - `validate-config` - Validate configuration file
  - `sync-all-books` - Sync multiple books

#### Continuous Improvement System (Issue #3)
- GitHub Actions workflows:
  - `book-sync.yml` - Automatic book synchronization
  - `quality-check.yml` - Quality assurance pipeline
- Quality tools:
  - Link checker (`scripts/check-links.js`)
  - Monitoring dashboard (`scripts/dashboard.js`)
  - Component sync tool (`scripts/sync-components.js`)
- Shared components system:
  - Version management
  - Configuration schema
  - Component distribution

#### Testing
- Comprehensive test suite with 33 tests
- 100% test success rate
- Unit tests for BookGenerator and ConfigValidator

### Features
- 🚀 Create new books in under 5 minutes
- 🔧 Configuration-driven customization
- 📝 Built-in templates for Markdown, Jekyll, GitHub Pages
- 🛡️ Automatic configuration validation
- 🔄 Automated book updates
- 🧪 Quality assurance through testing
- 🌐 Japanese technical book optimization
- 📊 Real-time monitoring dashboard
- 🔗 Automatic link validation
- 🤖 CI/CD integration

### Technical Details
- Node.js 18+ required
- ESM modules
- Async/await throughout
- Atomic file operations
- Comprehensive error handling

## [Unreleased]

### Planned
- PDF/EPUB generation support
- Plugin system
- Web UI dashboard
- Multi-language enhancement
- Template marketplace

---

## Release Notes

### v1.0.0 - Initial Release

This is the first stable release of book-formatter, implementing all features defined in Issues #2 and #3:

1. **Issue #2**: Efficient book creation system ✅
2. **Issue #3**: Continuous improvement system ✅

The system is now ready for production use in managing technical documentation and book projects.