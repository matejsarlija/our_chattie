import * as React from "react"
import * as THREE from "three"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { EffectComposer } from "@react-three/postprocessing"
import { Pyramid, EYE_Y, type PointerState } from "./Pyramid"
import { Eye, Halo } from "./Eye"
import { Dither } from "./ditherEffect"
import { glowState } from "./useSectionGlow"

/**
 * PyramidHero - a slowly turning brick pyramid with a floating capstone and a
 * watching eye, rendered 1-bit with an ordered-dither post pass.
 *
 * Mount it through PyramidBackground (lazy + WebGL fallback); the canvas is a
 * fixed, pointer-events-none layer behind the page.
 */

const BACKGROUND = "#0b0c0a"
const CAMERA_FOV = 33
const CAMERA_Y = 1.05
const CAMERA_Z = 8.4
const LOOK_AT = new THREE.Vector3(0, 0.35, 0)
const PORTRAIT_SCENE_SHIFT = -1.75
const PORTRAIT_ASPECT = 0.75

const AMBIENT_INTENSITY = 0.32
const KEY_LIGHT_INTENSITY = 3.1
const KEY_LIGHT_POSITION: [number, number, number] = [-2.8, 4.2, 4.4]

const GLOW_LAMBDA = 4
const POINTER_LAMBDA = 6

export type PyramidMode = "dither" | "wireframe"

export type PyramidHeroProps = {
    mode?: PyramidMode
    paused?: boolean
}

function usePrefersReducedMotion() {
    const [reduced, setReduced] = React.useState(false)
    React.useEffect(function () {
        const query = window.matchMedia("(prefers-reduced-motion: reduce)")
        const sync = function () {
            setReduced(query.matches)
        }
        sync()
        query.addEventListener("change", sync)
        return function () {
            query.removeEventListener("change", sync)
        }
    }, [])
    return reduced
}

function CameraRig() {
    const camera = useThree(function (state) {
        return state.camera
    }) as THREE.PerspectiveCamera
    const width = useThree(function (state) {
        return state.size.width
    })
    const height = useThree(function (state) {
        return state.size.height
    })

    React.useEffect(
        function () {
            const aspect = width / Math.max(1, height)
            camera.fov = CAMERA_FOV
            camera.position.set(
                0,
                CAMERA_Y,
                CAMERA_Z * Math.max(1, PORTRAIT_ASPECT / aspect)
            )
            camera.lookAt(LOOK_AT)
            camera.updateProjectionMatrix()
        },
        [camera, width, height]
    )

    return null
}

type SceneProps = {
    mode: PyramidMode
    reducedMotion: boolean
}

function Scene({ mode, reducedMotion }: SceneProps) {
    const camera = useThree(function (state) {
        return state.camera
    }) as THREE.PerspectiveCamera
    const width = useThree(function (state) {
        return state.size.width
    })
    const height = useThree(function (state) {
        return state.size.height
    })
    // Tall screens drop the artwork below the copy block, bleeding its base
    // off the bottom edge instead of printing it behind the paragraph.
    const shift =
        width / Math.max(1, height) < PORTRAIT_ASPECT
            ? PORTRAIT_SCENE_SHIFT
            : 0

    const pointer = React.useRef<PointerState>({ x: 0, y: 0 })
    const pointerEased = React.useRef<PointerState>({ x: 0, y: 0 })
    const glow = React.useRef(0)
    const eye = React.useRef(new THREE.Vector3(0.5, 0.5, 0.2))
    const pointerHasMoved = React.useRef(false)

    React.useEffect(
        function () {
            const onMove = function (event: PointerEvent) {
                pointerHasMoved.current = true
                pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1
                pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1
            }
            window.addEventListener("pointermove", onMove, { passive: true })
            return function () {
                window.removeEventListener("pointermove", onMove)
            }
        },
        []
    )

    useFrame(function (state, delta) {
        glowState.live = THREE.MathUtils.damp(
            glowState.live,
            glowState.target,
            GLOW_LAMBDA,
            delta
        )
        glow.current = glowState.live

        const targetX = pointerHasMoved.current ? pointer.current.x : 0
        const targetY = pointerHasMoved.current ? pointer.current.y : 0
        pointerEased.current.x = THREE.MathUtils.damp(
            pointerEased.current.x,
            targetX,
            POINTER_LAMBDA,
            delta
        )
        pointerEased.current.y = THREE.MathUtils.damp(
            pointerEased.current.y,
            targetY,
            POINTER_LAMBDA,
            delta
        )

        // Screen-space eye position for the dither threshold lift.
        const projected = new THREE.Vector3(0, EYE_Y + shift, 0).project(
            camera
        )
        const distance = camera.position.distanceTo(
            new THREE.Vector3(0, EYE_Y + shift, 0)
        )
        const worldHeight =
            2 *
            distance *
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        eye.current.set(
            projected.x * 0.5 + 0.5,
            projected.y * 0.5 + 0.5,
            0.6 / Math.max(0.1, worldHeight)
        )

        state.invalidate()
    }, -1)

    return (
        <>
            <CameraRig />
            <ambientLight intensity={AMBIENT_INTENSITY} />
            <directionalLight
                position={KEY_LIGHT_POSITION}
                intensity={KEY_LIGHT_INTENSITY}
            />
            <group position={[0, shift, 0]}>
                <Halo glow={glow} />
                <Pyramid
                    pointer={pointerEased}
                    reducedMotion={reducedMotion}
                    wireframe={mode === "wireframe"}
                />
                <Eye
                    pointer={pointerEased}
                    reducedMotion={reducedMotion}
                    wireframe={mode === "wireframe"}
                    glow={glow}
                />
            </group>
            {mode === "dither" ? (
                <EffectComposer multisampling={0}>
                    <Dither glow={glow} eye={eye} />
                </EffectComposer>
            ) : null}
        </>
    )
}

export default function PyramidHero({
    mode = "dither",
    paused = false,
}: PyramidHeroProps) {
    const reducedMotion = usePrefersReducedMotion()
    const [documentVisible, setDocumentVisible] = React.useState(true)

    React.useEffect(function () {
        const sync = function () {
            setDocumentVisible(!document.hidden)
        }
        sync()
        document.addEventListener("visibilitychange", sync)
        return function () {
            document.removeEventListener("visibilitychange", sync)
        }
    }, [])

    const running = documentVisible && !paused

    return (
        <Canvas
            flat
            dpr={[1, 2]}
            frameloop={running ? "always" : "never"}
            gl={{
                antialias: false,
                alpha: false,
                powerPreference: "high-performance",
            }}
            camera={{
                fov: CAMERA_FOV,
                near: 0.1,
                far: 60,
                position: [0, CAMERA_Y, CAMERA_Z],
            }}
            style={{ width: "100%", height: "100%", display: "block" }}
        >
            <color attach="background" args={[BACKGROUND]} />
            <Scene mode={mode} reducedMotion={reducedMotion} />
        </Canvas>
    )
}
