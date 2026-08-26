package com.voxeland.game.gl

import android.opengl.GLES30

class Shader(vertexSrc: String, fragmentSrc: String) {
    val program: Int

    init {
        val vs = compile(GLES30.GL_VERTEX_SHADER, vertexSrc)
        val fs = compile(GLES30.GL_FRAGMENT_SHADER, fragmentSrc)
        program = GLES30.glCreateProgram()
        GLES30.glAttachShader(program, vs)
        GLES30.glAttachShader(program, fs)
        GLES30.glLinkProgram(program)
        val ok = IntArray(1)
        GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, ok, 0)
        check(ok[0] != 0) { "link failed: " + GLES30.glGetProgramInfoLog(program) }
        GLES30.glDeleteShader(vs); GLES30.glDeleteShader(fs)
    }

    private fun compile(type: Int, src: String): Int {
        val id = GLES30.glCreateShader(type)
        GLES30.glShaderSource(id, src)
        GLES30.glCompileShader(id)
        val ok = IntArray(1)
        GLES30.glGetShaderiv(id, GLES30.GL_COMPILE_STATUS, ok, 0)
        check(ok[0] != 0) { "shader failed: " + GLES30.glGetShaderInfoLog(id) }
        return id
    }

    fun use() = GLES30.glUseProgram(program)
    fun loc(name: String) = GLES30.glGetUniformLocation(program, name)

    companion object {
        /** world geometry: pos(3) uv(2) ao(1) sky(1) = 7 floats, stride 28 */
        const val WORLD_VS = """#version 300 es
            layout(location=0) in vec3 aPos;
            layout(location=1) in vec2 aUV;
            layout(location=2) in float aAO;
            layout(location=3) in float aSky;
            uniform mat4 uMVP;
            out vec2 vUV; out float vAO; out float vSky; out vec3 vWorld;
            void main() {
                gl_Position = uMVP * vec4(aPos, 1.0);
                vUV = aUV; vAO = aAO; vSky = aSky; vWorld = aPos;
            }"""

        /**
         * Lighting is deliberately high-contrast: propagated sky exposure times
         * the time of day, plus a tight flashlight cone and a very small
         * personal ambient so a windowless room is nearly black. Exposure comes
         * from the eye-adaptation model on the CPU; colour drains toward blue
         * grey at low light the way scotopic vision actually does.
         */
        const val WORLD_FS = """#version 300 es
            precision mediump float;
            in vec2 vUV; in float vAO; in float vSky; in vec3 vWorld;
            uniform sampler2D uTex;
            uniform vec3 uFogColor;
            uniform float uFogScale;
            uniform float uDaylight;
            uniform float uAmbient;
            uniform float uExposure;
            uniform vec3 uCam;
            uniform vec3 uFlashDir;
            uniform float uFlashOn;
            uniform vec3 uWarm;          // sun tint at this hour
            uniform float uUseSolid;
            uniform vec4 uSolid;
            uniform float uAlpha;
            out vec4 fragColor;

            void main() {
                vec4 tex = texture(uTex, vUV);
                vec4 col = mix(tex, uSolid, uUseSolid);
                if (col.a < 0.4 && uAlpha >= 0.99) discard;

                vec3 toFrag = vWorld - uCam;
                float dist = length(toFrag);
                vec3 dir = toFrag / max(dist, 0.001);

                float sky = vSky * uDaylight;

                // flashlight: narrow cone, inverse-square-ish falloff
                float cd = dot(dir, uFlashDir);
                float cone = smoothstep(0.80, 0.94, cd);
                float atten = 1.0 / (1.0 + dist * dist * 0.018);
                float flash = uFlashOn * cone * atten;

                // a sliver of personal ambient keeps total blindness at bay
                float near = uAmbient * clamp(1.0 - dist / 7.0, 0.0, 1.0);

                float light = vAO * (sky + near + flash);
                vec3 tint = mix(vec3(1.0), uWarm, clamp(sky, 0.0, 1.0));
                vec3 rgb = col.rgb * light * tint * uExposure;

                // scotopic vision: colour drains out of a dark scene
                float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
                float night = 1.0 - smoothstep(0.015, 0.20, lum);
                rgb = mix(rgb, vec3(lum) * vec3(0.68, 0.80, 1.10), night * 0.80);

                // key gain then a soft shoulder: daylight keeps its punch while
                // the lifted darks stay compressed and grainy rather than milky
                rgb *= 1.9;
                rgb = rgb / (rgb + vec3(0.9));

                float fog = clamp(exp(-pow(dist * uFogScale, 1.5)), 0.0, 1.0);
                rgb = mix(uFogColor, rgb, fog);
                fragColor = vec4(rgb, col.a * uAlpha);
            }"""

        /** light shafts: pos(3) alpha(1) dirXZ(2) = 6 floats, stride 24 */
        const val SHAFT_VS = """#version 300 es
            layout(location=0) in vec3 aPos;
            layout(location=1) in float aAlpha;
            layout(location=2) in vec2 aDir;
            uniform mat4 uMVP;
            uniform vec3 uCam;
            out float vAlpha; out vec2 vDir; out float vDist; out vec3 vWorld;
            void main() {
                gl_Position = uMVP * vec4(aPos, 1.0);
                vAlpha = aAlpha; vDir = aDir;
                vWorld = aPos;
                vDist = distance(aPos, uCam);
            }"""

        /**
         * A shaft is baked pointing inward from its window, so its strength is
         * the alignment between that direction and where the sun actually is —
         * beams swing, fade and die as the day turns without any remeshing.
         */
        const val SHAFT_FS = """#version 300 es
            precision mediump float;
            in float vAlpha; in vec2 vDir; in float vDist; in vec3 vWorld;
            uniform vec2 uSunXZ;         // horizontal sun travel direction
            uniform float uSunUp;        // 0 below horizon .. 1 overhead
            uniform float uDaylight;
            uniform float uGain;
            uniform float uTime;
            uniform vec3 uShaftColor;
            out vec4 fragColor;

            void main() {
                // a zero direction marks a vertical shaft (a hole in a roof),
                // which is lit whenever the sun is up regardless of bearing
                float dl = length(vDir);
                float align = dl < 0.01 ? 1.0 : max(dot(vDir / dl, uSunXZ), 0.0);
                // dust in the beam boils slowly rather than sitting still
                float shimmer = 0.82 + 0.18 * sin(uTime * 1.7 + vWorld.x * 2.3 + vWorld.y * 1.9 + vWorld.z * 2.7);
                float a = vAlpha * uDaylight * uSunUp * pow(align, 1.6) * uGain * shimmer;
                a *= clamp(1.0 - vDist / 46.0, 0.0, 1.0);
                if (a <= 0.003) discard;
                fragColor = vec4(uShaftColor * a, a);
            }"""

        /** dust motes: pos(3) brightness(1) = 4 floats, stride 16 */
        const val DUST_VS = """#version 300 es
            layout(location=0) in vec3 aPos;
            layout(location=1) in float aBright;
            uniform mat4 uMVP;
            uniform float uPointScale;
            out float vBright;
            void main() {
                vec4 clip = uMVP * vec4(aPos, 1.0);
                gl_Position = clip;
                gl_PointSize = clamp(uPointScale / max(clip.w, 0.4), 1.0, 7.0);
                vBright = aBright;
            }"""

        const val DUST_FS = """#version 300 es
            precision mediump float;
            in float vBright;
            uniform vec3 uDustColor;
            out vec4 fragColor;
            void main() {
                float d = length(gl_PointCoord - vec2(0.5));
                float a = smoothstep(0.5, 0.04, d) * vBright;
                if (a <= 0.004) discard;
                fragColor = vec4(uDustColor * a, a);
            }"""
    }
}
