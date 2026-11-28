import * as React from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { brickUvRepeat, createBrickTexture } from "./brickTexture"

/**
 * The brick pyramid: three frustum tiers, a floating capstone, and - in
 * wireframe mode - edge and course lines on black occluders.
 *
 * All world-space numbers live here as named constants.
 */

export const PYRAMID_Y = -1.05
export const BASE_RADIUS = 1.55
export const APEX_HEIGHT = 2.1
export const EYE_Y = 1.34

const RADIAL_SEGMENTS = 4
const SEGMENT_ROTATION = 0
const SWAY_SPEED = 0.16
const SWAY_AMPLITUDE = 0.06
const BASE_YAW = 0.3
const BASE_TILT = 0.16
const POINTER_YAW = 0.5
const POINTER_TILT = 0.22
const SMOOTHING = 4.5

const TIERS = [
    { bottom: 0, top: 0.42 },
    { bottom: 0.46, top: 0.88 },
    { bottom: 0.92, top: 1.34 },
]
const CAPSTONE = { bottom: 1.48, top: APEX_HEIGHT }
const BRICK_COURSE = 0.1

const INK = "#e6e1d3"
const CAP_COLOR = "#1b1b16"

export type PointerState = { x: number; y: number }

function radiusAt(y: number) {
    return BASE_RADIUS * (1 - y / APEX_HEIGHT)
}

function buildFrustum(bottom: number, top: number) {
    const height = top - bottom
    const geometry = new THREE.CylinderGeometry(
        radiusAt(top),
        radiusAt(bottom),
        height,
        RADIAL_SEGMENTS,
        1,
        false
    )
    geometry.rotateY(SEGMENT_ROTATION)
    geometry.translate(0, (top + bottom) / 2, 0)

    // Scale only the side UVs; caps keep their own mapping.
    const uv = geometry.attributes.uv as THREE.BufferAttribute
    const sideVertexCount = (RADIAL_SEGMENTS + 1) * 2
    const meanRadius = (radiusAt(bottom) + radiusAt(top)) / 2
    const repeat = brickUvRepeat(meanRadius, height)
    for (let i = 0; i < sideVertexCount; i++) {
        uv.setXY(i, uv.getX(i) * repeat.u, uv.getY(i) * repeat.v)
    }
    uv.needsUpdate = true
    return geometry
}

function buildCourseRings(): THREE.BufferGeometry {
    const points: number[] = []
    for (let y = BRICK_COURSE; y < APEX_HEIGHT; y += BRICK_COURSE) {
        const r = radiusAt(y)
        // Corners sit on the axis, not on the diagonal: the frustum's
        // vertices are at (0, ±r) and (±r, 0) after the 4-segment split.
        const corners: Array<[number, number]> = [
            [0, r],
            [r, 0],
            [0, -r],
            [-r, 0],
        ]
        for (let i = 0; i < 4; i++) {
            const a = corners[i]
            const b = corners[(i + 1) % 4]
            points.push(a[0], y, a[1], b[0], y, b[1])
        }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(points, 3)
    )
    return geometry
}

type PyramidProps = {
    pointer: React.MutableRefObject<PointerState>
    reducedMotion: boolean
    wireframe: boolean
}

export function Pyramid({ pointer, reducedMotion, wireframe }: PyramidProps) {
    const group = React.useRef<THREE.Group>(null)
    const yaw = React.useRef(0)
    const tilt = React.useRef(BASE_TILT)

    const assets = React.useMemo(() => {
        const brick = wireframe ? null : createBrickTexture()
        const brickMaterial = wireframe
            ? null
            : new THREE.MeshLambertMaterial({
                  map: brick,
                  flatShading: true,
              })
        const capMaterial = wireframe
            ? null
            : new THREE.MeshLambertMaterial({
                  color: CAP_COLOR,
                  flatShading: true,
              })
        const occluder = wireframe
            ? new THREE.MeshBasicMaterial({
                  color: "#000000",
                  polygonOffset: true,
                  polygonOffsetFactor: 1,
                  polygonOffsetUnits: 1,
              })
            : null
        const edgeMaterial = wireframe
            ? new THREE.LineBasicMaterial({ color: INK })
            : null

        const tiers = TIERS.map(function (tier) {
            const geometry = buildFrustum(tier.bottom, tier.top)
            const edges = wireframe
                ? new THREE.EdgesGeometry(geometry, 15)
                : null
            return { geometry, edges }
        })
        const capstone = buildFrustum(CAPSTONE.bottom, CAPSTONE.top)
        const capstoneEdges = wireframe
            ? new THREE.EdgesGeometry(capstone, 15)
            : null
        const rings = wireframe ? buildCourseRings() : null

        return {
            brick,
            brickMaterial,
            capMaterial,
            occluder,
            edgeMaterial,
            tiers,
            capstone,
            capstoneEdges,
            rings,
        }
    }, [wireframe])

    React.useEffect(
        function () {
            return function dispose() {
                assets.brick?.dispose()
                assets.brickMaterial?.dispose()
                assets.capMaterial?.dispose()
                assets.occluder?.dispose()
                assets.edgeMaterial?.dispose()
                assets.tiers.forEach(function (tier) {
                    tier.geometry.dispose()
                    tier.edges?.dispose()
                })
                assets.capstone.dispose()
                assets.capstoneEdges?.dispose()
                assets.rings?.dispose()
            }
        },
        [assets]
    )

    useFrame(function (state, delta) {
        const node = group.current
        if (!node) return

        if (reducedMotion) {
            node.rotation.set(BASE_TILT, BASE_YAW, 0)
            return
        }

        const sway = Math.sin(state.clock.elapsedTime * SWAY_SPEED) * SWAY_AMPLITUDE
        yaw.current = THREE.MathUtils.damp(
            yaw.current,
            pointer.current.x * POINTER_YAW,
            SMOOTHING,
            delta
        )
        tilt.current = THREE.MathUtils.damp(
            tilt.current,
            BASE_TILT + pointer.current.y * POINTER_TILT,
            SMOOTHING,
            delta
        )
        node.rotation.y = BASE_YAW + sway + yaw.current
        node.rotation.x = tilt.current
    })

    return (
        <group ref={group} position={[0, PYRAMID_Y, 0]}>
            {assets.tiers.map(function (tier, i) {
                return (
                    <React.Fragment key={i}>
                        <mesh
                            geometry={tier.geometry}
                            material={
                                wireframe
                                    ? assets.occluder!
                                    : [
                                          assets.brickMaterial!,
                                          assets.capMaterial!,
                                          assets.capMaterial!,
                                      ]
                            }
                        />
                        {tier.edges && assets.edgeMaterial ? (
                            <lineSegments
                                geometry={tier.edges}
                                material={assets.edgeMaterial}
                            />
                        ) : null}
                    </React.Fragment>
                )
            })}

            <mesh
                geometry={assets.capstone}
                material={
                    wireframe
                        ? assets.occluder!
                        : [
                              assets.brickMaterial!,
                              assets.capMaterial!,
                              assets.capMaterial!,
                          ]
                }
            />
            {assets.capstoneEdges && assets.edgeMaterial ? (
                <lineSegments
                    geometry={assets.capstoneEdges}
                    material={assets.edgeMaterial}
                />
            ) : null}

            {assets.rings && assets.edgeMaterial ? (
                <lineSegments
                    geometry={assets.rings}
                    material={assets.edgeMaterial}
                />
            ) : null}
        </group>
    )
}
