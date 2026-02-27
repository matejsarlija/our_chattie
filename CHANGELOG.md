# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **Document Edit (DE-101)**: Fixed duplicate text insertion issue by enforcing single-writer pattern in BubbleMenu.
- **Document Edit (DE-102)**: Added explicit submit button and Enter key support for custom commands.
- **Document Edit (DE-103)**: Normalized preset behavior; all main presets now trigger preview mode for consistency.
- **Document Edit (DE-104)**: Replaced "Odbaci" with smart "Otkaži" action that correctly reverts changes during preview.
- **Document Edit (DE-105)**: Improved BubbleMenu positioning to keep it within the viewport (clamping and vertical flipping).
- **Document Edit (DE-106)**: Cleaned up preset list to 3 core actions and added "Format" quick action.
