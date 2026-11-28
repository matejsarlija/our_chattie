import * as React from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { BlendFunction, Effect } from "postprocessing"

/**
 * Ordered-dither post pass: sample the composited frame on a ~3 CSS px cell
 * grid, convert to luminance, and threshold against a 4x4 Bayer matrix. The
 * result is duotone ink on near-black - no CPU readback.
 *
 * The glow lifts the threshold around the eye so the dots densify there while
 * a section is in view.
 */

const CELL_CSS_PX = 3
const MAX_PIXEL_RATIO = 2
const LUMINANCE_GAIN = 1.12
const DISPLAY_GAMMA = 1.7
const GLOW_LIFT = 0.08

const INK = "#e6e1d3"
const BACKGROUND = "#0b0c0a"

const fragmentShader = /* glsl */ `
    uniform float uCellPx;
    uniform vec2 uResolution;
    uniform vec3 uInk;
    uniform vec3 uBackground;
    uniform float uGlow;
    uniform vec3 uEye;
    uniform float uAspect;

    float bayer2(vec2 a) {
        a = floor(a);
        return fract(a.x * 0.5 + a.y * a.y * 0.75);
    }

    float bayer4(vec2 a) {
        return bayer2(0.5 * a) * 0.25 + bayer2(a);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 cell = vec2(uCellPx) / uResolution;
        vec2 cellUv = (floor(uv / cell) + 0.5) * cell;

        vec3 source = texture2D(inputBuffer, cellUv).rgb;
        float luminance = dot(source, vec3(0.299, 0.587, 0.114)) * ${LUMINANCE_GAIN.toFixed(2)};
        // The composer buffer is linear-light; threshold in display space so
        // mid-greys dither the way they look, not the way they meter. The
        // background's own display luminance becomes the black point, so an
        // empty cell never lights up just because its value is non-zero.
        float display = pow(clamp(luminance, 0.0, 1.0), 1.0 / ${DISPLAY_GAMMA.toFixed(1)});
        float blackPoint = pow(
            dot(uBackground, vec3(0.299, 0.587, 0.114)),
            1.0 / ${DISPLAY_GAMMA.toFixed(1)}
        );
        float value = clamp(
            (display - blackPoint) / max(0.0001, 1.0 - blackPoint),
            0.0,
            1.0
        );

        vec2 delta = (uv - uEye.xy) * vec2(uAspect, 1.0);
        float lift = smoothstep(uEye.z, uEye.z * 0.12, length(delta));
        value += uGlow * ${GLOW_LIFT.toFixed(2)} * lift;

        float threshold = (bayer4(floor(gl_FragCoord.xy / uCellPx)) * 16.0 + 0.5) / 16.0;
        vec3 color = value > threshold ? uInk : uBackground;
        outputColor = vec4(color, 1.0);
    }
`

class DitherEffectImpl extends Effect {
    private readonly resolution = new THREE.Vector2(1, 1)

    constructor() {
        super("DitherEffect", fragmentShader, {
            blendFunction: BlendFunction.NORMAL,
            uniforms: new Map<string, THREE.Uniform>([
                ["uCellPx", new THREE.Uniform(CELL_CSS_PX)],
                ["uResolution", new THREE.Uniform(new THREE.Vector2(1, 1))],
                ["uInk", new THREE.Uniform(new THREE.Color(INK))],
                [
                    "uBackground",
                    new THREE.Uniform(new THREE.Color(BACKGROUND)),
                ],
                ["uGlow", new THREE.Uniform(0)],
                ["uEye", new THREE.Uniform(new THREE.Vector3(0.5, 0.5, 0.2))],
                ["uAspect", new THREE.Uniform(1)],
            ]),
        })
    }

    update(renderer: THREE.WebGLRenderer) {
        renderer.getDrawingBufferSize(this.resolution)
        const pixelRatio = Math.min(
            MAX_PIXEL_RATIO,
            renderer.getPixelRatio()
        )
        this.uniforms.get("uResolution")!.value.copy(this.resolution)
        this.uniforms.get("uCellPx")!.value = CELL_CSS_PX * pixelRatio
        this.uniforms.get("uAspect")!.value =
            this.resolution.x / Math.max(1, this.resolution.y)
    }
}

type DitherProps = {
    glow: React.MutableRefObject<number>
    eye: React.MutableRefObject<THREE.Vector3>
}

export function Dither({ glow, eye }: DitherProps) {
    const effect = React.useMemo(function () {
        return new DitherEffectImpl()
    }, [])

    React.useEffect(
        function () {
            return function dispose() {
                effect.dispose()
            }
        },
        [effect]
    )

    useFrame(function () {
        effect.uniforms.get("uGlow")!.value = glow.current
        ;(effect.uniforms.get("uEye")!.value as THREE.Vector3).copy(eye.current)
    })

    return <primitive object={effect} dispose={null} />
}
