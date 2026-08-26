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
        const val WORLD_VS = """#version 300 es
            layout(location=0) in vec3 aPos;
            layout(location=1) in vec2 aUV;
            layout(location=2) in float aLight;
            uniform mat4 uMVP;
            uniform vec3 uCam;
            out vec2 vUV; out float vLight; out float vDist;
            void main() {
                gl_Position = uMVP * vec4(aPos, 1.0);
                vUV = aUV; vLight = aLight;
                vDist = distance(aPos, uCam);
            }"""

        const val WORLD_FS = """#version 300 es
            precision mediump float;
            in vec2 vUV; in float vLight; in float vDist;
            uniform sampler2D uTex;
            uniform vec3 uFogColor;
            uniform float uFogScale;      // ~1/visibility
            uniform float uGlobalLight;   // day/night level
            uniform float uLamp;          // player's near-field visibility at night
            uniform float uUseSolid;
            uniform vec4 uSolid;
            uniform float uAlpha;
            out vec4 fragColor;
            void main() {
                vec4 tex = texture(uTex, vUV);
                vec4 col = mix(tex, uSolid, uUseSolid);
                if (col.a < 0.4 && uAlpha >= 0.99) discard;
                float lamp = uLamp * clamp(1.0 - vDist / 10.0, 0.0, 1.0);
                float light = clamp(vLight * uGlobalLight + lamp * vLight, 0.02, 1.2);
                vec3 rgb = col.rgb * light;
                float fog = clamp(exp(-pow(vDist * uFogScale, 1.5)), 0.0, 1.0);
                rgb = mix(uFogColor, rgb, fog);
                fragColor = vec4(rgb, col.a * uAlpha);
            }"""
    }
}
