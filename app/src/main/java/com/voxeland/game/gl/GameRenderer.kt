package com.voxeland.game.gl

import android.opengl.GLES30
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import com.voxeland.game.GameEngine
import com.voxeland.game.core.CHUNK_SIZE
import com.voxeland.game.core.LightEngine
import com.voxeland.game.core.World
import com.voxeland.game.entity.Zombie
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.LinkedBlockingQueue
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin

class GameRenderer(private val engine: GameEngine) : GLSurfaceView.Renderer {

    companion object {
        const val RENDER_DIST = 5

        // a tighter lens: less sees you, and what you do see presses closer
        const val FOV_BASE = 62f
        const val FOV_CROUCH = 56f
        const val FOV_SPRINT = 68f

        const val DUST_COUNT = 560
        const val DUST_BOX = 26f
    }

    private class ChunkMeshGL {
        var vboOpaque = 0; var opaqueVerts = 0
        var vboTrans = 0; var transVerts = 0
        var vboShaft = 0; var shaftVerts = 0
        fun delete() {
            val ids = intArrayOf(vboOpaque, vboTrans, vboShaft)
            GLES30.glDeleteBuffers(3, ids, 0)
            vboOpaque = 0; vboTrans = 0; vboShaft = 0
            opaqueVerts = 0; transVerts = 0; shaftVerts = 0
        }
    }

    private lateinit var world: Shader
    private lateinit var shaft: Shader
    private lateinit var dust: Shader

    private val meshes = HashMap<Long, ChunkMeshGL>()
    private val uploadQueue = ConcurrentLinkedQueue<ChunkMesher.Result>()
    private val meshRequests = LinkedBlockingQueue<Pair<Int, Int>>()
    private val pendingMesh = HashSet<Long>()
    private var workers: List<Thread> = emptyList()
    @Volatile private var running = true

    private val proj = FloatArray(16)
    private val view = FloatArray(16)
    private val mvp = FloatArray(16)
    private val model = FloatArray(16)
    private val tmp = FloatArray(16)
    private val sky = FloatArray(3)
    private val sunXZ = FloatArray(2)
    private val warm = FloatArray(3)
    private val skyOut = FloatArray(3)
    private var lastFrameNs = 0L
    private var aspect = 16f / 9f
    private var fov = FOV_BASE
    private var elapsed = 0f

    private var cubeVbo = 0
    private var cubeVerts = 0

    // dust
    private var dustVbo = 0
    private val dustBase = FloatArray(DUST_COUNT * 3)
    private val dustVel = FloatArray(DUST_COUNT * 3)
    private val dustData = FloatArray(DUST_COUNT * 4)
    private var dustBuffer: FloatBuffer =
        ByteBuffer.allocateDirect(DUST_COUNT * 4 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()

    // world uniforms
    private var wMVP = 0; private var wCam = 0; private var wFogColor = 0; private var wFogScale = 0
    private var wDaylight = 0; private var wAmbient = 0; private var wExposure = 0
    private var wFlashDir = 0; private var wFlashOn = 0; private var wWarm = 0
    private var wUseSolid = 0; private var wSolid = 0; private var wAlpha = 0
    // shaft uniforms
    private var sMVP = 0; private var sCam = 0; private var sSunXZ = 0; private var sSunUp = 0
    private var sDaylight = 0; private var sGain = 0; private var sTime = 0; private var sColor = 0
    // dust uniforms
    private var dMVP = 0; private var dPointScale = 0; private var dColor = 0

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES30.glEnable(GLES30.GL_DEPTH_TEST)
        GLES30.glEnable(GLES30.GL_CULL_FACE)
        GLES30.glCullFace(GLES30.GL_BACK)
        TextureAtlas.build()

        world = Shader(Shader.WORLD_VS, Shader.WORLD_FS)
        wMVP = world.loc("uMVP"); wCam = world.loc("uCam")
        wFogColor = world.loc("uFogColor"); wFogScale = world.loc("uFogScale")
        wDaylight = world.loc("uDaylight"); wAmbient = world.loc("uAmbient")
        wExposure = world.loc("uExposure"); wFlashDir = world.loc("uFlashDir")
        wFlashOn = world.loc("uFlashOn"); wWarm = world.loc("uWarm")
        wUseSolid = world.loc("uUseSolid"); wSolid = world.loc("uSolid"); wAlpha = world.loc("uAlpha")

        shaft = Shader(Shader.SHAFT_VS, Shader.SHAFT_FS)
        sMVP = shaft.loc("uMVP"); sCam = shaft.loc("uCam")
        sSunXZ = shaft.loc("uSunXZ"); sSunUp = shaft.loc("uSunUp")
        sDaylight = shaft.loc("uDaylight"); sGain = shaft.loc("uGain")
        sTime = shaft.loc("uTime"); sColor = shaft.loc("uShaftColor")

        dust = Shader(Shader.DUST_VS, Shader.DUST_FS)
        dMVP = dust.loc("uMVP"); dPointScale = dust.loc("uPointScale"); dColor = dust.loc("uDustColor")

        buildCube()
        buildDust()

        meshes.clear(); pendingMesh.clear(); uploadQueue.clear()
        for (c in engine.world.loadedChunks()) c.dirty = true
        if (workers.none { it.isAlive }) startWorkers()
        engine.eye.reset(engine.env.daylight)
        lastFrameNs = System.nanoTime()
    }

    private fun startWorkers() {
        running = true
        workers = (0 until 2).map { i ->
            Thread({
                while (running) {
                    val req = try { meshRequests.take() } catch (e: InterruptedException) { break }
                    val (cx, cz) = req
                    try {
                        val c = engine.world.obtainChunk(cx, cz)
                        engine.world.generate(c)
                        val field = LightEngine.compute(engine.world, cx, cz)
                        field.copyInto(c.light)
                        c.lit = true
                        c.dirty = false
                        uploadQueue.add(ChunkMesher.mesh(engine.world, c, field))
                    } catch (e: Exception) { /* keep the worker alive */ }
                }
            }, "mesh-worker-$i").also { it.isDaemon = true; it.start() }
        }
    }

    fun shutdown() { running = false; workers.forEach { it.interrupt() } }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES30.glViewport(0, 0, width, height)
        aspect = width.toFloat() / height.toFloat()
    }

    override fun onDrawFrame(gl: GL10?) {
        val now = System.nanoTime()
        val dt = ((now - lastFrameNs) / 1e9).toFloat().coerceIn(0.0001f, 0.25f)
        lastFrameNs = now
        elapsed += dt

        engine.update(dt)

        val p = engine.player
        val env = engine.env

        streamChunks()
        uploadMeshes()

        env.skyColor(sky)
        env.sunTravelXZ(sunXZ)
        env.sunTint(warm)
        val exposure = engine.eye.exposure

        // The sky is a lit surface too, so it goes through exactly the same
        // exposure and shoulder as the world — otherwise fog would not blend
        // into the horizon and the eye would seem to adapt to the ground only.
        tonemap(sky, exposure, skyOut)
        GLES30.glClearColor(skyOut[0], skyOut[1], skyOut[2], 1f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)

        // lens tightens when you crouch, opens a little when you run
        val fovTarget = when {
            p.crouching -> FOV_CROUCH
            p.sprinting -> FOV_SPRINT
            else -> FOV_BASE
        }
        fov += (fovTarget - fov) * min(1f, dt * 6f)

        Matrix.perspectiveM(proj, 0, fov, aspect, 0.08f, 220f)
        val eyeX = p.x.toFloat(); val eyeY = (p.y + p.eyeHeight).toFloat(); val eyeZ = p.z.toFloat()
        val cp = cos(p.pitch); val sp = sin(p.pitch)
        val cy = cos(p.yaw); val sy = sin(p.yaw)
        val fwdX = sy * cp; val fwdY = -sp; val fwdZ = -cy * cp
        Matrix.setLookAtM(view, 0, eyeX, eyeY, eyeZ,
            eyeX + fwdX, eyeY + fwdY, eyeZ + fwdZ, 0f, 1f, 0f)
        Matrix.multiplyMM(mvp, 0, proj, 0, view, 0)

        val pcx = Math.floorDiv(floor(p.x).toInt(), CHUNK_SIZE)
        val pcz = Math.floorDiv(floor(p.z).toInt(), CHUNK_SIZE)

        drawWorld(eyeX, eyeY, eyeZ, fwdX, fwdY, fwdZ, exposure, pcx, pcz)
        drawShafts(eyeX, eyeY, eyeZ, pcx, pcz)
        drawDust(dt, eyeX, eyeY, eyeZ, fwdX, fwdY, fwdZ, exposure)
    }

    // ------------------------------------------------------------ passes

    private fun drawWorld(
        eyeX: Float, eyeY: Float, eyeZ: Float,
        fwdX: Float, fwdY: Float, fwdZ: Float,
        exposure: Float, pcx: Int, pcz: Int,
    ) {
        val env = engine.env
        world.use()
        GLES30.glUniformMatrix4fv(wMVP, 1, false, mvp, 0)
        GLES30.glUniform3f(wCam, eyeX, eyeY, eyeZ)
        GLES30.glUniform3f(wFogColor, skyOut[0], skyOut[1], skyOut[2])
        val visibility = 150f / env.fogDensity
        GLES30.glUniform1f(wFogScale, 1f / visibility)
        GLES30.glUniform1f(wDaylight, env.blockLight)
        // the Scout's night eyes are a slightly larger sliver of ambient
        val scout = if (engine.player.character.background == 2) 1.5f else 1f
        GLES30.glUniform1f(wAmbient, 0.055f * scout)
        GLES30.glUniform1f(wExposure, exposure)
        GLES30.glUniform3f(wFlashDir, fwdX, fwdY, fwdZ)
        GLES30.glUniform1f(wFlashOn, if (engine.player.flashlightOn) 2.1f else 0f)
        GLES30.glUniform3f(wWarm, warm[0], warm[1], warm[2])
        GLES30.glUniform1f(wUseSolid, 0f)
        GLES30.glUniform4f(wSolid, 1f, 1f, 1f, 1f)
        GLES30.glUniform1f(wAlpha, 1f)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, TextureAtlas.textureId)

        for ((key, m) in meshes) {
            if (m.opaqueVerts == 0 || !near(key, pcx, pcz)) continue
            drawWorldVbo(m.vboOpaque, m.opaqueVerts)
        }

        drawZombies()

        GLES30.glEnable(GLES30.GL_BLEND)
        GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE_MINUS_SRC_ALPHA)
        GLES30.glDepthMask(false)
        GLES30.glUniformMatrix4fv(wMVP, 1, false, mvp, 0)
        GLES30.glUniform1f(wUseSolid, 0f)
        GLES30.glUniform1f(wAlpha, 0.55f)
        for ((key, m) in meshes) {
            if (m.transVerts == 0 || !near(key, pcx, pcz)) continue
            drawWorldVbo(m.vboTrans, m.transVerts)
        }
        GLES30.glDepthMask(true)
        GLES30.glDisable(GLES30.GL_BLEND)
        disableAttribs(4)
    }

    private fun drawShafts(eyeX: Float, eyeY: Float, eyeZ: Float, pcx: Int, pcz: Int) {
        val env = engine.env
        if (env.sunUp <= 0.001f) return
        shaft.use()
        GLES30.glUniformMatrix4fv(sMVP, 1, false, mvp, 0)
        GLES30.glUniform3f(sCam, eyeX, eyeY, eyeZ)
        GLES30.glUniform2f(sSunXZ, sunXZ[0], sunXZ[1])
        GLES30.glUniform1f(sSunUp, env.sunUp)
        GLES30.glUniform1f(sDaylight, env.daylight)
        // beams read strongest from inside a dark room, which is where they matter
        val gain = (if (engine.indoors) 1.55f else 0.65f) * (0.55f + 0.45f * env.dustLevel)
        GLES30.glUniform1f(sGain, gain)
        GLES30.glUniform1f(sTime, elapsed)
        GLES30.glUniform3f(sColor, warm[0] * 0.95f, warm[1] * 0.88f, warm[2] * 0.70f)

        GLES30.glEnable(GLES30.GL_BLEND)
        GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE)
        GLES30.glDepthMask(false)
        GLES30.glDisable(GLES30.GL_CULL_FACE)          // beams are visible from both sides
        for ((key, m) in meshes) {
            if (m.shaftVerts == 0 || !near(key, pcx, pcz)) continue
            GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, m.vboShaft)
            GLES30.glEnableVertexAttribArray(0)
            GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, 24, 0)
            GLES30.glEnableVertexAttribArray(1)
            GLES30.glVertexAttribPointer(1, 1, GLES30.GL_FLOAT, false, 24, 12)
            GLES30.glEnableVertexAttribArray(2)
            GLES30.glVertexAttribPointer(2, 2, GLES30.GL_FLOAT, false, 24, 16)
            GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, m.shaftVerts)
        }
        GLES30.glEnable(GLES30.GL_CULL_FACE)
        GLES30.glDepthMask(true)
        GLES30.glDisable(GLES30.GL_BLEND)
        disableAttribs(3)
    }

    /**
     * Motes hang in a box that travels with the player, each lit by the
     * propagated light where it happens to be. Inside a beam they catch fire;
     * a metre outside it they vanish — which is what sells the beam as air
     * rather than a decal.
     */
    private fun drawDust(
        dt: Float, eyeX: Float, eyeY: Float, eyeZ: Float,
        fwdX: Float, fwdY: Float, fwdZ: Float, exposure: Float,
    ) {
        val env = engine.env
        val w = engine.world
        val indoor = engine.indoors
        val density = env.dustLevel * (if (indoor) 1.0f else 0.42f)
        val flashOn = engine.player.flashlightOn

        val originX = floor(eyeX) - DUST_BOX / 2f
        val originY = floor(eyeY) - DUST_BOX / 2f
        val originZ = floor(eyeZ) - DUST_BOX / 2f

        var visible = 0
        for (i in 0 until DUST_COUNT) {
            val i3 = i * 3
            // slow convective drift, wrapped inside the travelling box
            dustBase[i3] = wrap(dustBase[i3] + dustVel[i3] * dt)
            dustBase[i3 + 1] = wrap(dustBase[i3 + 1] + dustVel[i3 + 1] * dt)
            dustBase[i3 + 2] = wrap(dustBase[i3 + 2] + dustVel[i3 + 2] * dt)

            val px = originX + dustBase[i3]
            val py = originY + dustBase[i3 + 1]
            val pz = originZ + dustBase[i3 + 2]

            val bx = floor(px).toInt(); val by = floor(py).toInt(); val bz = floor(pz).toInt()
            if (w.isSolidForCollision(bx, by, bz)) continue

            var b = w.skyLight(bx, by, bz) * env.daylight * 0.85f

            if (flashOn) {
                val dx = px - eyeX; val dy = py - eyeY; val dz = pz - eyeZ
                val d = kotlin.math.sqrt(dx * dx + dy * dy + dz * dz)
                if (d > 0.6f && d < 14f) {
                    val dot = (dx * fwdX + dy * fwdY + dz * fwdZ) / d
                    if (dot > 0.86f) b += (dot - 0.86f) / 0.14f * 0.9f * (1f - d / 14f)
                }
            }
            b *= density
            if (b <= 0.012f) continue

            val o = visible * 4
            dustData[o] = px; dustData[o + 1] = py; dustData[o + 2] = pz
            dustData[o + 3] = min(0.85f, b * exposure * 0.5f)
            visible++
        }
        if (visible == 0) return

        dustBuffer.position(0)
        dustBuffer.put(dustData, 0, visible * 4)
        dustBuffer.position(0)

        dust.use()
        GLES30.glUniformMatrix4fv(dMVP, 1, false, mvp, 0)
        GLES30.glUniform1f(dPointScale, 26f)
        GLES30.glUniform3f(dColor, warm[0] * 0.95f, warm[1] * 0.90f, warm[2] * 0.78f)

        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, dustVbo)
        GLES30.glBufferSubData(GLES30.GL_ARRAY_BUFFER, 0, visible * 4 * 4, dustBuffer)
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, 16, 0)
        GLES30.glEnableVertexAttribArray(1)
        GLES30.glVertexAttribPointer(1, 1, GLES30.GL_FLOAT, false, 16, 12)

        GLES30.glEnable(GLES30.GL_BLEND)
        GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE)
        GLES30.glDepthMask(false)
        GLES30.glDrawArrays(GLES30.GL_POINTS, 0, visible)
        GLES30.glDepthMask(true)
        GLES30.glDisable(GLES30.GL_BLEND)
        disableAttribs(2)
    }

    /** same key + shoulder the world fragment shader applies */
    private fun tonemap(src: FloatArray, exposure: Float, out: FloatArray) {
        for (i in 0 until 3) {
            val v = src[i] * exposure * 1.9f
            out[i] = v / (v + 0.9f)
        }
    }

    private fun wrap(v: Float): Float {
        var r = v
        while (r < 0f) r += DUST_BOX
        while (r >= DUST_BOX) r -= DUST_BOX
        return r
    }

    private fun near(key: Long, pcx: Int, pcz: Int): Boolean {
        val ccx = (key shr 32).toInt(); val ccz = key.toInt()
        return Math.abs(ccx - pcx) <= RENDER_DIST + 1 && Math.abs(ccz - pcz) <= RENDER_DIST + 1
    }

    private fun disableAttribs(n: Int) {
        for (i in 0 until n) GLES30.glDisableVertexAttribArray(i)
    }

    private fun drawWorldVbo(vbo: Int, verts: Int) {
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vbo)
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, 28, 0)
        GLES30.glEnableVertexAttribArray(1)
        GLES30.glVertexAttribPointer(1, 2, GLES30.GL_FLOAT, false, 28, 12)
        GLES30.glEnableVertexAttribArray(2)
        GLES30.glVertexAttribPointer(2, 1, GLES30.GL_FLOAT, false, 28, 20)
        GLES30.glEnableVertexAttribArray(3)
        GLES30.glVertexAttribPointer(3, 1, GLES30.GL_FLOAT, false, 28, 24)
        GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, verts)
    }

    // ------------------------------------------------------------ streaming

    private fun streamChunks() {
        val p = engine.player
        val pcx = Math.floorDiv(floor(p.x).toInt(), CHUNK_SIZE)
        val pcz = Math.floorDiv(floor(p.z).toInt(), CHUNK_SIZE)

        for (r in 0..RENDER_DIST) {
            for (dx in -r..r) for (dz in -r..r) {
                if (maxOf(Math.abs(dx), Math.abs(dz)) != r) continue
                val cx = pcx + dx; val cz = pcz + dz
                val key = World.key(cx, cz)
                val chunk = engine.world.chunkAt(cx, cz)
                val needs = chunk == null || !chunk.generated || chunk.dirty
                if (needs && key !in pendingMesh) {
                    pendingMesh.add(key)
                    meshRequests.offer(cx to cz)
                }
            }
        }
        val it = meshes.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            val ccx = (e.key shr 32).toInt(); val ccz = e.key.toInt()
            if (Math.abs(ccx - pcx) > RENDER_DIST + 2 || Math.abs(ccz - pcz) > RENDER_DIST + 2) {
                e.value.delete(); it.remove()
            }
        }
        engine.world.unloadFar(pcx, pcz, RENDER_DIST + 3)
    }

    private fun uploadMeshes() {
        var budget = 4
        while (budget-- > 0) {
            val r = uploadQueue.poll() ?: break
            val key = World.key(r.cx, r.cz)
            pendingMesh.remove(key)
            var m = meshes[key]
            if (m == null) { m = ChunkMeshGL(); meshes[key] = m } else m.delete()
            if (r.opaque.isNotEmpty()) { m.vboOpaque = makeVbo(r.opaque); m.opaqueVerts = r.opaque.size / 7 }
            if (r.translucent.isNotEmpty()) { m.vboTrans = makeVbo(r.translucent); m.transVerts = r.translucent.size / 7 }
            if (r.shafts.isNotEmpty()) { m.vboShaft = makeVbo(r.shafts); m.shaftVerts = r.shafts.size / 6 }
        }
    }

    private fun makeVbo(data: FloatArray): Int {
        val ids = IntArray(1)
        GLES30.glGenBuffers(1, ids, 0)
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, ids[0])
        GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, data.size * 4, toBuffer(data), GLES30.GL_STATIC_DRAW)
        return ids[0]
    }

    private fun toBuffer(data: FloatArray): FloatBuffer =
        ByteBuffer.allocateDirect(data.size * 4).order(ByteOrder.nativeOrder())
            .asFloatBuffer().put(data).apply { position(0) }

    // ------------------------------------------------------------ entities & dust setup

    private fun buildDust() {
        val rnd = java.util.Random(90210L)
        for (i in 0 until DUST_COUNT) {
            val i3 = i * 3
            dustBase[i3] = rnd.nextFloat() * DUST_BOX
            dustBase[i3 + 1] = rnd.nextFloat() * DUST_BOX
            dustBase[i3 + 2] = rnd.nextFloat() * DUST_BOX
            dustVel[i3] = (rnd.nextFloat() - 0.5f) * 0.10f
            dustVel[i3 + 1] = -0.02f - rnd.nextFloat() * 0.06f       // settling
            dustVel[i3 + 2] = (rnd.nextFloat() - 0.5f) * 0.10f
        }
        val ids = IntArray(1)
        GLES30.glGenBuffers(1, ids, 0)
        dustVbo = ids[0]
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, dustVbo)
        GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, DUST_COUNT * 4 * 4, null, GLES30.GL_DYNAMIC_DRAW)
    }

    private fun buildCube() {
        val faces = arrayOf(
            floatArrayOf(-0.5f,0f,-0.5f, -0.5f,0f,0.5f, -0.5f,1f,0.5f, -0.5f,1f,-0.5f) to 0.62f,
            floatArrayOf(0.5f,0f,0.5f, 0.5f,0f,-0.5f, 0.5f,1f,-0.5f, 0.5f,1f,0.5f) to 0.62f,
            floatArrayOf(0.5f,0f,-0.5f, -0.5f,0f,-0.5f, -0.5f,1f,-0.5f, 0.5f,1f,-0.5f) to 0.78f,
            floatArrayOf(-0.5f,0f,0.5f, 0.5f,0f,0.5f, 0.5f,1f,0.5f, -0.5f,1f,0.5f) to 0.78f,
            floatArrayOf(-0.5f,1f,0.5f, 0.5f,1f,0.5f, 0.5f,1f,-0.5f, -0.5f,1f,-0.5f) to 1f,
            floatArrayOf(-0.5f,0f,-0.5f, 0.5f,0f,-0.5f, 0.5f,0f,0.5f, -0.5f,0f,0.5f) to 0.34f,
        )
        val list = ArrayList<Float>()
        val order = intArrayOf(0, 1, 2, 0, 2, 3)
        for ((q, ao) in faces) for (i in order) {
            list.add(q[i*3]); list.add(q[i*3+1]); list.add(q[i*3+2])
            list.add(0f); list.add(0f); list.add(ao); list.add(0f)   // sky filled per-draw
        }
        cubeVbo = makeVbo(list.toFloatArray())
        cubeVerts = list.size / 7
    }

    private fun drawZombies() {
        GLES30.glUniform1f(wUseSolid, 1f)
        for (zb in engine.zombies) {
            if (zb.distTo(engine.player.x, engine.player.z) > 90.0) continue
            drawZombie(zb)
        }
        GLES30.glUniform1f(wUseSolid, 0f)
        GLES30.glUniformMatrix4fv(wMVP, 1, false, mvp, 0)
    }

    private fun part(zb: Zombie, ox: Float, oy: Float, oz: Float, sx: Float, sy: Float, sz: Float, pitchRad: Float) {
        Matrix.setIdentityM(model, 0)
        Matrix.translateM(model, 0, zb.x.toFloat(), zb.y.toFloat(), zb.z.toFloat())
        Matrix.rotateM(model, 0, -Math.toDegrees(zb.yaw.toDouble()).toFloat(), 0f, 1f, 0f)
        Matrix.translateM(model, 0, ox, oy, oz)
        if (pitchRad != 0f) Matrix.rotateM(model, 0, Math.toDegrees(pitchRad.toDouble()).toFloat(), 1f, 0f, 0f)
        Matrix.scaleM(model, 0, sx, sy, sz)
        Matrix.multiplyMM(tmp, 0, mvp, 0, model, 0)
        GLES30.glUniformMatrix4fv(wMVP, 1, false, tmp, 0)
        GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, cubeVerts)
    }

    private fun drawZombie(zb: Zombie) {
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, cubeVbo)
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, 28, 0)
        GLES30.glEnableVertexAttribArray(1)
        GLES30.glVertexAttribPointer(1, 2, GLES30.GL_FLOAT, false, 28, 12)
        GLES30.glEnableVertexAttribArray(2)
        GLES30.glVertexAttribPointer(2, 1, GLES30.GL_FLOAT, false, 28, 20)
        GLES30.glEnableVertexAttribArray(3)
        GLES30.glVertexAttribPointer(3, 1, GLES30.GL_FLOAT, false, 28, 24)

        // a body is lit by the room it stands in, so they loom out of the dark
        val bx = floor(zb.x).toInt(); val by = floor(zb.y + 1.0).toInt(); val bz = floor(zb.z).toInt()
        val sky = engine.world.skyLight(bx, by, bz)
        GLES30.glVertexAttrib1f(3, sky)

        val dead = zb.state == Zombie.State.DEAD
        val fall = if (dead) (zb.deadTimer * 2f).coerceAtMost(1f) else 0f
        val g = 0.30f + zb.tint * 0.12f
        val alive = 1f - fall * 0.5f
        GLES30.glUniform4f(wSolid, (g - 0.06f) * alive, (g + 0.04f) * alive, (g - 0.08f) * alive, 1f)

        val swing = sin(zb.animPhase) * (if (zb.state == Zombie.State.CHASE) 0.7f else 0.35f)
        val b = zb.bulk
        val yBase = if (dead) 0.15f else 0f
        val squash = 1f - fall * 0.85f
        part(zb, -0.11f * b, yBase, 0f, 0.16f * b, 0.75f * squash, 0.16f * b, swing)
        part(zb, 0.11f * b, yBase, 0f, 0.16f * b, 0.75f * squash, 0.16f * b, -swing)
        part(zb, 0f, yBase + 0.72f * squash, 0f, 0.44f * b, 0.62f * squash, 0.24f * b, 0f)
        val armPitch = if (zb.state == Zombie.State.CHASE || zb.state == Zombie.State.ATTACK) -1.35f else -0.15f + swing * 0.4f
        GLES30.glUniform4f(wSolid, (g - 0.04f) * alive, (g + 0.05f) * alive, (g - 0.07f) * alive, 1f)
        part(zb, -0.30f * b, yBase + 1.22f * squash, 0f, 0.13f * b, 0.55f, 0.13f * b, armPitch)
        part(zb, 0.30f * b, yBase + 1.22f * squash, 0f, 0.13f * b, 0.55f, 0.13f * b, armPitch + swing * 0.2f)
        GLES30.glUniform4f(wSolid, 0.45f * alive, 0.48f * alive, 0.40f * alive, 1f)
        part(zb, 0f, yBase + 1.36f * squash, 0f, 0.26f, 0.28f, 0.26f, 0f)
    }
}
