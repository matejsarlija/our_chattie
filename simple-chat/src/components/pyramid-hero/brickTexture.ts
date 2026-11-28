import * as THREE from "three"

/**
 * Procedural brick tile for the pyramid tiers.
 *
 * One tile is 256x128 px and covers TILE_WORLD_WIDTH x TILE_WORLD_HEIGHT world
 * units: two courses of two staggered bricks, each with its own grey tone,
 * a bevel under the top edge, grit speckle, and thick mortar.
 *
 * The tile is drawn from a fixed seed so every load looks identical.
 */

export const TILE_WORLD_WIDTH = 0.8
export const TILE_WORLD_HEIGHT = 0.4

const TILE_PX_WIDTH = 256
const TILE_PX_HEIGHT = 128
const COURSES_PER_TILE = 2
const BRICKS_PER_COURSE = 2
const MORTAR_PX = 10
const SEED = 0x5eed1e
const SPECKLES_PER_BRICK = 5

function mulberry32(seed: number): () => number {
    let state = seed >>> 0
    return function random() {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function createBrickTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas")
    canvas.width = TILE_PX_WIDTH
    canvas.height = TILE_PX_HEIGHT
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("2D canvas context unavailable")

    const random = mulberry32(SEED)

    ctx.fillStyle = "#14140f"
    ctx.fillRect(0, 0, TILE_PX_WIDTH, TILE_PX_HEIGHT)

    const brickW = TILE_PX_WIDTH / BRICKS_PER_COURSE
    const brickH = TILE_PX_HEIGHT / COURSES_PER_TILE
    const inset = MORTAR_PX / 2

    for (let course = 0; course < COURSES_PER_TILE; course++) {
        const y = course * brickH + inset
        const h = brickH - MORTAR_PX
        const stagger = course % 2 === 0 ? 0 : brickW / 2

        for (let brick = -1; brick < BRICKS_PER_COURSE; brick++) {
            // Draw once at the tile seam as well so the wrap is continuous.
            for (const shift of [0, -TILE_PX_WIDTH]) {
                const x = brick * brickW + stagger + shift + inset
                const w = brickW - MORTAR_PX
                if (x + w < 0 || x > TILE_PX_WIDTH) continue

                const tone = 0.8 + random() * 0.12
                const grey = Math.round(tone * 255)
                ctx.fillStyle = `rgb(${grey}, ${grey}, ${Math.round(grey * 0.94)})`
                ctx.fillRect(x, y, w, h)

                ctx.fillStyle = "rgba(255, 255, 238, 0.1)"
                ctx.fillRect(x, y, w, 2)
                ctx.fillStyle = "rgba(0, 0, 0, 0.3)"
                ctx.fillRect(x, y + h - 2, w, 2)

                for (let s = 0; s < SPECKLES_PER_BRICK; s++) {
                    const sx = x + 2 + random() * Math.max(1, w - 4)
                    const sy = y + 2 + random() * Math.max(1, h - 4)
                    ctx.fillStyle =
                        random() > 0.55
                            ? "rgba(255, 255, 240, 0.05)"
                            : "rgba(0, 0, 0, 0.1)"
                    ctx.fillRect(sx, sy, 1 + random() * 1.6, 1)
                }
            }
        }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    texture.needsUpdate = true
    return texture
}

/**
 * UV repeat for a square frustum tier. The horizontal repeat follows the
 * perimeter at the tier's mean radius; the vertical repeat is the tier height
 * divided by one tile (four courses).
 */
export function brickUvRepeat(meanRadius: number, height: number) {
    const perimeter = 4 * Math.SQRT2 * meanRadius
    return {
        u: Math.max(1, Math.round(perimeter / TILE_WORLD_WIDTH)),
        v: Math.max(1, height / TILE_WORLD_HEIGHT),
    }
}
