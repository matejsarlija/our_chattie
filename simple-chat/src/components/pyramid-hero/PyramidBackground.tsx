import * as React from "react"
import { useSectionGlow } from "./useSectionGlow"
import type { PyramidMode } from "./PyramidHero"

/**
 * Fixed background layer. Keeps the 3D bundle out of the main chunk, checks
 * for WebGL before mounting, and falls back to a procedurally generated
 * dithered still when WebGL is missing or the scene throws.
 *
 * The parent page must sit above this layer (z-index > 0). The layer itself
 * is pointer-events-none and aria-hidden, so it never intercepts input or is
 * announced to screen readers.
 */

export type PyramidBackgroundProps = {
    mode?: PyramidMode
    paused?: boolean
}

const LazyScene = React.lazy(function () {
    return import("./PyramidHero")
})

const FALLBACK_WIDTH = 1200
const FALLBACK_HEIGHT = 800
const FALLBACK_SEED = 0x0f1d

function mulberry32(seed: number) {
    let state = seed >>> 0
    return function random() {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * A still, hand-drawn stand-in for the WebGL scene: same composition, same
 * dot-matrix language. Drawn as an inline SVG so there is no asset to load.
 */
function buildFallbackSrc() {
    const random = mulberry32(FALLBACK_SEED)
    const dots: string[] = []

    const apex = { x: FALLBACK_WIDTH / 2, y: 352 }
    const baseY = 726
    const halfBase = 246
    const courseStep = 17
    const courseHeight = 12
    const dotStep = 8

    for (let y = apex.y + 6; y < baseY - 4; y += courseStep) {
        const half = halfBase * ((y - apex.y) / (baseY - apex.y))
        const courseY = y + courseHeight / 2
        if (courseY > baseY - 6) continue
        for (let x = apex.x - half + 4; x < apex.x + half - 3; x += dotStep) {
            // Vertical brick joints: a narrow black gap every ~46px.
            if ((x - apex.x + 2000) % 46 < 3) continue
            if (random() < 0.1) continue
            const jitter = (random() - 0.5) * 1.6
            dots.push(
                `<circle cx="${(x + jitter).toFixed(1)}" cy="${(
                    courseY + jitter
                ).toFixed(1)}" r="1.35" />`
            )
        }
    }

    const eyeY = 236
    const eyeHalf = 62
    const eyeHalfHeight = 31

    const rays = Array.from({ length: 36 })
        .map(function (_, i) {
            const angle = ((i + 0.5) / 36) * Math.PI * 2
            const length = [38, 22, 30, 22][i % 4]
            const inner = 74
            const parts: string[] = []
            for (let r = inner; r <= inner + length; r += 7) {
                parts.push(
                    `<circle cx="${(FALLBACK_WIDTH / 2 + Math.cos(angle) * r).toFixed(
                        1
                    )}" cy="${(eyeY + Math.sin(angle) * r).toFixed(
                        1
                    )}" r="1.1" />`
                )
            }
            return parts.join("")
        })
        .join("")

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FALLBACK_WIDTH} ${FALLBACK_HEIGHT}" preserveAspectRatio="xMidYMid meet">
        <rect width="100%" height="100%" fill="#0b0c0a"/>
        <path d="M${apex.x} ${apex.y} L${apex.x - 40} 398 L${apex.x + 40} 398 Z" fill="#0b0c0a" stroke="#e6e1d3" stroke-width="1.2" opacity="0.9"/>
        <path d="M${apex.x} 434 L${apex.x - halfBase} ${baseY} L${apex.x + halfBase} ${baseY} Z" fill="none" stroke="#e6e1d3" stroke-width="1.1" opacity="0.7"/>
        <g fill="#e6e1d3" opacity="0.85">${dots.join("")}</g>
        <g fill="#e6e1d3" opacity="0.42">${rays}</g>
        <path d="M${FALLBACK_WIDTH / 2 - eyeHalf} ${eyeY} Q${FALLBACK_WIDTH / 2} ${
            eyeY - eyeHalfHeight * 1.55
        } ${FALLBACK_WIDTH / 2 + eyeHalf} ${eyeY} Q${FALLBACK_WIDTH / 2} ${
            eyeY + eyeHalfHeight * 1.55
        } ${FALLBACK_WIDTH / 2 - eyeHalf} ${eyeY} Z" fill="#e6e1d3"/>
        <circle cx="${FALLBACK_WIDTH / 2}" cy="${eyeY}" r="23" fill="#55648a"/>
        <circle cx="${FALLBACK_WIDTH / 2}" cy="${eyeY}" r="9" fill="#0b0c0a"/>
        <circle cx="${FALLBACK_WIDTH / 2 + 5}" cy="${eyeY - 5}" r="3" fill="#fbf8ef"/>
    </svg>`

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function supportsWebGL() {
    if (typeof window === "undefined") return false
    try {
        const canvas = document.createElement("canvas")
        const context =
            canvas.getContext("webgl2") || canvas.getContext("webgl")
        return Boolean(context)
    } catch {
        return false
    }
}

const Fallback = React.memo(function Fallback() {
    const src = React.useMemo(buildFallbackSrc, [])
    return (
        <img
            src={src}
            alt=""
            aria-hidden
            style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                objectPosition: "50% 50%",
                display: "block",
            }}
        />
    )
})

type BoundaryProps = { children: React.ReactNode; onError: () => void }

class SceneBoundary extends React.Component<
    BoundaryProps,
    { failed: boolean }
> {
    state = { failed: false }

    static getDerivedStateFromError() {
        return { failed: true }
    }

    componentDidCatch() {
        this.props.onError()
    }

    render() {
        if (this.state.failed) return null
        return this.props.children
    }
}

export default function PyramidBackground({
    mode = "dither",
    paused = false,
}: PyramidBackgroundProps) {
    useSectionGlow()

    const host = React.useRef<HTMLDivElement>(null)
    const [supported, setSupported] = React.useState<boolean | null>(null)
    const [inView, setInView] = React.useState(true)

    React.useEffect(
        function () {
            setSupported(supportsWebGL())
        },
        []
    )

    React.useEffect(
        function () {
            const node = host.current
            if (!node || typeof IntersectionObserver === "undefined") return
            const observer = new IntersectionObserver(
                function (entries) {
                    setInView(entries[0].isIntersecting)
                },
                { threshold: 0 }
            )
            observer.observe(node)
            return function () {
                observer.disconnect()
            }
        },
        []
    )

    return (
        <div
            ref={host}
            aria-hidden
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 0,
                overflow: "hidden",
                pointerEvents: "none",
                background: "#0b0c0a",
            }}
        >
            {supported ? (
                <SceneBoundary onError={function () { setSupported(false) }}>
                    <React.Suspense fallback={null}>
                        <LazyScene
                            mode={mode}
                            paused={paused || !inView}
                        />
                    </React.Suspense>
                </SceneBoundary>
            ) : null}
            {supported === false ? <Fallback /> : null}
        </div>
    )
}
