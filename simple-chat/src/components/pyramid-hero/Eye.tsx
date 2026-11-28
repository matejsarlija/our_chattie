import * as React from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Billboard } from "@react-three/drei"
import { EYE_Y, type PointerState } from "./Pyramid"

/**
 * The watching eye above the capstone, plus the halo plane that sits behind
 * the pyramid. Everything is procedural: a quadratic lens, an iris that
 * follows the pointer, a blink on a slow cycle, and 36 compass rays.
 */

const EYE_SCALE = 0.78
const LENS_HALF_WIDTH = 0.58
const LENS_CONTROL_Y = 0.62
const EYE_BOB = 0.02
const BOB_SPEED = 1.2
const BLINK_INTERVAL = 7
const BLINK_DURATION = 0.18
const BLINK_CLOSED = 0.08

const IRIS_RADIUS = 0.2
const PUPIL_RADIUS = 0.078
const HIGHLIGHT_RADIUS = 0.026
const POINTER_IRIS_X = 0.13
const POINTER_IRIS_Y = 0.08
const IRIS_SMOOTHING = 5

const RAY_COUNT = 36
const RAY_START = 0.62
const RAY_LENGTHS = [0.62, 0.36, 0.5, 0.36]
const RAY_STEP = 0.055
const RAY_DOT_SIZE = 0.024
const RAY_IDLE_OPACITY = 0.5
const RAY_GLOW_OPACITY = 0.62

const INK = "#e6e1d3"
const INK_BRIGHT = "#fbf8ef"
const PUPIL = "#0b0c0a"
const IRIS_FILL = "#55648a"
const IRIS_DIM = new THREE.Color("#55648a")
const IRIS_BRIGHT = new THREE.Color("#b9c6e2")

const HALO_COLOR = new THREE.Color("#8f9dc4")

function buildLensShape() {
    const shape = new THREE.Shape()
    shape.moveTo(-LENS_HALF_WIDTH, 0)
    shape.quadraticCurveTo(0, LENS_CONTROL_Y, LENS_HALF_WIDTH, 0)
    shape.quadraticCurveTo(0, -LENS_CONTROL_Y, -LENS_HALF_WIDTH, 0)
    return shape
}

function buildLensGeometry() {
    return new THREE.ShapeGeometry(buildLensShape(), 48)
}

function buildLensOutline() {
    const points = buildLensShape().getPoints(72)
    return new THREE.BufferGeometry().setFromPoints(
        points.map(function (p) {
            return new THREE.Vector3(p.x, p.y, 0)
        })
    )
}

function buildCircleLine(radius: number) {
    const points: number[] = []
    const segments = 64
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2
        points.push(Math.cos(t) * radius, Math.sin(t) * radius, 0)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(points, 3)
    )
    return geometry
}

function buildCreaseGeometry() {
    const curve = new THREE.QuadraticBezierCurve(
        new THREE.Vector2(-0.34, 0.34),
        new THREE.Vector2(0, 0.78),
        new THREE.Vector2(0.34, 0.34)
    )
    return new THREE.BufferGeometry().setFromPoints(
        curve.getPoints(40).map(function (p) {
            return new THREE.Vector3(p.x, p.y, 0)
        })
    )
}

function buildRayGeometry() {
    const points: number[] = []
    for (let i = 0; i < RAY_COUNT; i++) {
        const angle = ((i + 0.5) / RAY_COUNT) * Math.PI * 2
        const length = RAY_LENGTHS[i % RAY_LENGTHS.length]
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        // Each ray is a string of dots, not a line: one-pixel lines dissolve
        // into the 3px dither grid, while dots quantise onto whole cells.
        for (let r = RAY_START; r <= RAY_START + length; r += RAY_STEP) {
            points.push(cos * r, sin * r, 0)
        }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(points, 3)
    )
    return geometry
}

type EyeProps = {
    pointer: React.MutableRefObject<PointerState>
    reducedMotion: boolean
    wireframe: boolean
    glow: React.MutableRefObject<number>
}

export function Eye({ pointer, reducedMotion, wireframe, glow }: EyeProps) {
    const root = React.useRef<THREE.Group>(null)
    const lid = React.useRef<THREE.Group>(null)
    const iris = React.useRef<THREE.Group>(null)
    const rays = React.useRef<THREE.Group>(null)

    const coarsePointer = React.useMemo(function () {
        if (typeof window === "undefined" || !window.matchMedia) return false
        return window.matchMedia("(pointer: coarse)").matches
    }, [])

    const geometry = React.useMemo(
        function () {
            return {
                lens: buildLensGeometry(),
                outline: buildLensOutline(),
                crease: buildCreaseGeometry(),
                iris: new THREE.CircleGeometry(IRIS_RADIUS, 48),
                irisRim: new THREE.RingGeometry(
                    IRIS_RADIUS - 0.002,
                    IRIS_RADIUS + 0.018,
                    48
                ),
                pupil: new THREE.CircleGeometry(PUPIL_RADIUS, 32),
                highlight: new THREE.CircleGeometry(HIGHLIGHT_RADIUS, 16),
                irisLine: buildCircleLine(IRIS_RADIUS),
                pupilLine: buildCircleLine(PUPIL_RADIUS),
                rays: buildRayGeometry(),
            }
        },
        []
    )

    const materials = React.useMemo(
        function () {
            return {
                pale: new THREE.MeshBasicMaterial({
                    color: "#ffffff",
                    toneMapped: false,
                }),
                irisFill: new THREE.MeshBasicMaterial({
                    color: IRIS_FILL,
                    toneMapped: false,
                }),
                pupil: new THREE.MeshBasicMaterial({
                    color: PUPIL,
                    toneMapped: false,
                }),
                outline: new THREE.LineBasicMaterial({
                    color: INK_BRIGHT,
                    toneMapped: false,
                }),
                crease: new THREE.LineBasicMaterial({
                    color: "#8b8678",
                    toneMapped: false,
                }),
                rays: new THREE.PointsMaterial({
                    color: INK,
                    size: RAY_DOT_SIZE,
                    sizeAttenuation: true,
                    transparent: true,
                    opacity: RAY_IDLE_OPACITY,
                    depthWrite: false,
                    toneMapped: false,
                }),
            }
        },
        []
    )

    const creaseLine = React.useMemo(
        function () {
            return new THREE.Line(geometry.crease, materials.crease)
        },
        [geometry, materials]
    )

    React.useEffect(
        function () {
            return function dispose() {
                Object.values(geometry).forEach(function (g) {
                    g.dispose()
                })
                Object.values(materials).forEach(function (m) {
                    m.dispose()
                })
            }
        },
        [geometry, materials]
    )

    useFrame(function (state, delta) {
        const node = root.current
        if (!node) return
        const time = state.clock.elapsedTime
        const live = glow.current

        node.position.y = reducedMotion
            ? EYE_Y
            : EYE_Y + Math.sin(time * BOB_SPEED) * EYE_BOB

        if (lid.current) {
            if (reducedMotion) {
                lid.current.scale.y = 1
            } else {
                const cycle = time % BLINK_INTERVAL
                if (cycle < BLINK_DURATION) {
                    const phase = cycle / BLINK_DURATION
                    lid.current.scale.y =
                        1 - (1 - BLINK_CLOSED) * Math.sin(Math.PI * phase)
                } else {
                    lid.current.scale.y = 1
                }
            }
        }

        if (iris.current) {
            let targetX = 0
            let targetY = 0
            if (coarsePointer) {
                targetX = Math.sin(time * 0.7) * 0.05
                targetY = Math.cos(time * 0.5) * 0.03
            } else if (!reducedMotion) {
                targetX = pointer.current.x * POINTER_IRIS_X
                targetY = -pointer.current.y * POINTER_IRIS_Y
            }
            iris.current.position.x = THREE.MathUtils.damp(
                iris.current.position.x,
                targetX,
                IRIS_SMOOTHING,
                delta
            )
            iris.current.position.y = THREE.MathUtils.damp(
                iris.current.position.y,
                targetY,
                IRIS_SMOOTHING,
                delta
            )
        }

        if (rays.current) {
            rays.current.scale.setScalar(1 + live * 0.12)
        }
        materials.rays.opacity = RAY_IDLE_OPACITY + live * RAY_GLOW_OPACITY
        materials.irisFill.color.copy(IRIS_DIM).lerp(IRIS_BRIGHT, live)
    })

    return (
        <Billboard ref={root} position={[0, EYE_Y, 0]} scale={EYE_SCALE}>
            <group ref={rays}>
                <points geometry={geometry.rays} material={materials.rays} />
            </group>

            <group ref={lid}>
                {wireframe ? null : (
                    <mesh geometry={geometry.lens} material={materials.pale} />
                )}
                <lineLoop
                    geometry={geometry.outline}
                    material={materials.outline}
                    position={[0, 0, 0.004]}
                />
                <primitive object={creaseLine} position={[0, 0, 0.004]} />

                <group ref={iris} position={[0, 0, 0.01]}>
                    {wireframe ? null : (
                        <>
                            <mesh
                                geometry={geometry.iris}
                                material={materials.irisFill}
                            />
                            <mesh
                                geometry={geometry.irisRim}
                                material={materials.pupil}
                                position={[0, 0, 0.0015]}
                            />
                            <mesh
                                geometry={geometry.pupil}
                                material={materials.pupil}
                                position={[0, 0, 0.002]}
                            />
                            <mesh
                                geometry={geometry.highlight}
                                material={materials.pale}
                                position={[0.055, 0.06, 0.003]}
                            />
                        </>
                    )}
                    {wireframe ? (
                        <>
                            <lineLoop
                                geometry={geometry.irisLine}
                                material={materials.outline}
                            />
                            <lineLoop
                                geometry={geometry.pupilLine}
                                material={materials.outline}
                            />
                        </>
                    ) : null}
                </group>
            </group>
        </Billboard>
    )
}

/* ------------------------------------------------------------------ */

type HaloProps = {
    glow: React.MutableRefObject<number>
}

export function Halo({ glow }: HaloProps) {
    const mesh = React.useRef<THREE.Mesh>(null)
    const material = React.useRef<THREE.ShaderMaterial>(null)

    const uniforms = React.useMemo(
        function () {
            return {
                uColor: { value: HALO_COLOR.clone() },
                uGlow: { value: 0 },
            }
        },
        []
    )

    React.useEffect(
        function () {
            return function dispose() {
                material.current?.dispose()
            }
        },
        []
    )

    useFrame(function () {
        const live = glow.current
        if (material.current) {
            material.current.uniforms.uGlow.value = live
        }
        if (mesh.current) {
            mesh.current.scale.setScalar(3.6 + live * 0.6)
        }
    })

    return (
        <Billboard position={[0, EYE_Y, -3]}>
            <mesh ref={mesh} scale={3.6}>
                <planeGeometry args={[1, 1]} />
                <shaderMaterial
                    ref={material}
                    uniforms={uniforms}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    vertexShader={`
                        varying vec2 vUv;
                        void main() {
                            vUv = uv;
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        }
                    `}
                    fragmentShader={`
                        uniform vec3 uColor;
                        uniform float uGlow;
                        varying vec2 vUv;
                        void main() {
                            float d = distance(vUv, vec2(0.5)) * 2.0;
                            float falloff = smoothstep(1.0, 0.0, d);
                            float a = pow(falloff, 3.0) * uGlow * 0.14;
                            gl_FragColor = vec4(uColor * a, a);
                        }
                    `}
                />
            </mesh>
        </Billboard>
    )
}
