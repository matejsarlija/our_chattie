# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Chat UI (CHAT-201)**: Added `ScrollToBottomButton` component and exported it through the Chat component index.
- **Chat UI (CHAT-202)**: Added `WordFadeIn` (`WordFadeIn.jsx` + `WordFadeIn.css`) to support animated reveal of finalized assistant responses.
- **Testing (CHAT-203)**: Added `AltChat.scroll-button.test.jsx` coverage for scroll-button visibility, overlay anchoring, and near-bottom hide behavior.

### Fixed
- **Document Edit (DE-101)**: Fixed duplicate text insertion issue by enforcing single-writer pattern in BubbleMenu.
- **Document Edit (DE-102)**: Added explicit submit button and Enter key support for custom commands.
- **Document Edit (DE-103)**: Normalized preset behavior; all main presets now trigger preview mode for consistency.
- **Document Edit (DE-104)**: Replaced "Odbaci" with smart "Otkaži" action that correctly reverts changes during preview.
- **Document Edit (DE-105)**: Improved BubbleMenu positioning to keep it within the viewport (clamping and vertical flipping).
- **Document Edit (DE-106)**: Cleaned up preset list to 3 core actions and added "Format" quick action.
- **Chat Scroll (CHAT-204)**: Moved scroll-to-bottom control to a viewport overlay in `AltChat` so it no longer scrolls away with message content.
- **Chat Layout (CHAT-205)**: Added `min-h-0` to the main chat flex chain to restore stable scrolling/overflow behavior after overlay refactor.
- **Chat Auto-scroll Tests (CHAT-206)**: Updated `MessageList.scroll.test.jsx` to clear initial mount scroll calls before asserting non-auto-scroll behavior.
