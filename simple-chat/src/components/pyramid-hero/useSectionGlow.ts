import * as React from "react"

/**
 * Section glow, kept outside React state on purpose: the render loop and the
 * post-processing uniforms read the live value every frame, so changing it
 * must never re-render the tree.
 *
 * Usage:
 *   useSectionGlow()                      // observe every [data-glow] element
 *   useSectionGlow("[data-glow='hero']")  // or a narrower selector
 *
 * Any observed element at least 50% in view sets the target to 1; when none
 * is, the target drops to 0. The scene eases toward the target itself.
 */

export const glowState = {
    target: 0,
    live: 0,
}

export function useSectionGlow(selector = "[data-glow]") {
    React.useEffect(
        function () {
            if (typeof window === "undefined") return
            if (typeof IntersectionObserver === "undefined") {
                glowState.target = 1
                return function reset() {
                    glowState.target = 0
                }
            }

            const ratios = new Map<Element, number>()
            let frame = 0

            const sync = function () {
                let any = false
                ratios.forEach(function (ratio) {
                    if (ratio >= 0.5) any = true
                })
                glowState.target = any ? 1 : 0
            }

            const observer = new IntersectionObserver(
                function (entries) {
                    entries.forEach(function (entry) {
                        ratios.set(
                            entry.target,
                            entry.isIntersecting ? entry.intersectionRatio : 0
                        )
                    })
                    sync()
                },
                { threshold: [0, 0.25, 0.5, 0.75, 1] }
            )

            const attach = function () {
                frame = 0
                const nodes = document.querySelectorAll(selector)
                nodes.forEach(function (node) {
                    if (ratios.has(node)) return
                    ratios.set(node, 0)
                    observer.observe(node)
                })
            }

            const scheduleAttach = function () {
                if (frame) return
                frame = window.requestAnimationFrame(attach)
            }

            attach()
            sync()

            const mutations = new MutationObserver(scheduleAttach)
            mutations.observe(document.body, {
                childList: true,
                subtree: true,
            })

            return function cleanup() {
                mutations.disconnect()
                observer.disconnect()
                if (frame) window.cancelAnimationFrame(frame)
                ratios.clear()
                glowState.target = 0
            }
        },
        [selector]
    )
}
