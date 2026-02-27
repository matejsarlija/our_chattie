import React, { memo, useMemo } from 'react';
import './WordFadeIn.css';

/**
 * WordFadeIn – two modes:
 *
 * 1. Word mode (text prop): splits a plain text string into words and
 *    reveals each one with a staggered fade+slide. Best for short AI
 *    messages or labels.
 *
 * 2. Block mode (children prop): wraps arbitrary children (e.g. a
 *    ReactMarkdown block) in a single fade+slide-in animation.
 *    Use this for long/rich content where per-word animation is impractical.
 *
 * Props:
 *   text      – plain text to split (word mode)
 *   children  – arbitrary React children (block mode)
 *   duration  – animation duration in ms (default: 350 word / 400 block)
 *   stagger   – delay between each word in ms (default: 40, word mode only)
 *   className – extra class names on the wrapper element
 *   animate   – if false, renders without any animation
 *   as        – HTML tag to use as wrapper in block mode (default: 'div')
 */
const WordFadeIn = memo(({
    text,
    children,
    duration,
    stagger = 40,
    className = '',
    animate = true,
    as: Tag = 'div',
}) => {
    // ── Block mode ──────────────────────────────────────────────────────────
    if (children !== undefined) {
        const blockDuration = duration ?? 400;
        return (
            <Tag
                className={[
                    className,
                    animate ? 'word-fade-in-block' : '',
                ].join(' ').trim()}
                style={animate ? { animationDuration: `${blockDuration}ms` } : undefined}
            >
                {children}
            </Tag>
        );
    }

    // ── Word mode ────────────────────────────────────────────────────────────
    const safeText = text ?? '';
    const wordDuration = duration ?? 350;

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const segments = useMemo(() => safeText.split(/(\s+)/), [safeText]);

    if (!animate) {
        return <span className={className}>{safeText}</span>;
    }

    return (
        <span className={className} aria-label={safeText}>
            {segments.map((segment, i) => {
                if (/^\s+$/.test(segment)) {
                    return <span key={i}>{segment}</span>;
                }
                return (
                    <span
                        key={i}
                        className="word-fade-in-word"
                        style={{
                            animationDuration: `${wordDuration}ms`,
                            animationDelay: `${Math.floor(i / 2) * stagger}ms`,
                        }}
                        aria-hidden="true"
                    >
                        {segment}
                    </span>
                );
            })}
        </span>
    );
});

WordFadeIn.displayName = 'WordFadeIn';
export default WordFadeIn;
