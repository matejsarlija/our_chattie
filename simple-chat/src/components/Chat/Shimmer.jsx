import React, { memo } from 'react';
import './Shimmer.css';

/**
 * Shimmer – an animated text shimmer for loading states.
 * Matches the visual style of Vercel's ai-elements <Shimmer /> component
 * using pure CSS (no Framer Motion dependency required).
 *
 * Props:
 *   children   – text content to shimmer
 *   as         – HTML element to render (default: 'span')
 *   className  – extra class names
 *   duration   – animation duration in seconds (default: 2)
 *   spread     – gradient spread multiplier (default: 2)
 */
const Shimmer = memo(({
    children,
    as: Tag = 'span',
    className = '',
    duration = 2,
    spread = 2,
}) => {
    const shimmerWidth = Math.max(spread * 100, 200);

    return (
        <Tag
            className={`shimmer-text ${className}`}
            style={{
                '--shimmer-duration': `${duration}s`,
                '--shimmer-width': `${shimmerWidth}%`,
            }}
        >
            {children}
        </Tag>
    );
});

Shimmer.displayName = 'Shimmer';
export default Shimmer;
