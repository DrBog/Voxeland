package com.voxeland.game.gl

import android.opengl.GLES30
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import com.voxeland.game.GameEngine
import com.voxeland.game.core.CHUNK_SIZE
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
import kotlin.math.sin

class GameRenderer(private val engine: GameEngine) : GLSurfaceView.Renderer {

    companion object { const val RENDER_DIST = 5 }

    private class ChunkMeshGL {
        var vboOpaque = 0; var opaqueVerts = 0
        var vboTrans = 0; var transVerts = 0
        fun delete() {
            val ids = IntArray(2)
            if (vboOpaque != 0) { ids[0] = vboOpaque }
            if (vboTrans != 0) { ids[1] = vboTrans }
            GLES30.glDeleteBuffers(2, ids, 0)
            vboOpaque = 0; vboTrans = 0
        }
    }

    private lateinit var shader: Shader
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
    private var lastFrameNs = 0L
    private var aspect = 16f / 9f

    // entity cube (unit cube centered on x/z, base at y=0), same vertex layout
    private var cubeVbo = 0
    private var cubeVerts = 0

    // uniforms
    private var uMVP = 0; private var uCam = 0; private var uFogColor = 0; private var uFogScale = 0
    private var uGlobalLight = 0; private var uLamp = 0; private var uUseSolid = 0; private var uSolid = 0; private var uAlpha = 0

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES30.glEnable(GLES30.GL_DEPTH_TEST)
        GLES30.glEnable(GLES30.GL_CULL_FACE)
        GLES30.glCullFace(GLES30.GL_BACK)
        TextureAtlas.build()
        shader = Shader(Shader.WORLD_VS, Shader.WORLD_FS)
        uMVP = shader.loc("uMVP"); uCam = shader.loc("uCam")
        uFogColor = shader.loc("uFogColor"); uFogScale = shader.loc("uFogScale")
        uGlobalLight = shader.loc("uGlobalLight"); uLamp = shader.loc("uLamp")
        uUseSolid = shader.loc("uUseSolid"); uSolid = shader.loc("uSolid"); uAlpha = shader.loc("uAlpha")
        buildCube()
        // context (re)created: every existing VBO handle is dead — remesh everything
        meshes.clear(); pendingMesh.clear(); uploadQueue.clear()
        for (c in engine.world.loadedChunks()) c.dirty = true
        if (workers.none { it.isAlive }) startWorkers()
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
                        c.dirty = false
                        uploadQueue.add(ChunkMesher.mesh(engine.world, c))
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

        engine.update(dt)

        val p = engine.player
        val env = engine.env

        streamChunks()
        uploadMeshes()

        env.skyColor(sky)
        GLES30.glClearColor(sky[0], sky[1], sky[2], 1f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)

        Matrix.perspectiveM(proj, 0, 72f, aspect, 0.08f, 220f)
        val eye = floatArrayOf(p.x.toFloat(), (p.y + p.eyeHeight).toFloat(), p.z.toFloat())
        val cp = cos(p.pitch); val sp = sin(p.pitch)
        val cy = cos(p.yaw); val sy = sin(p.yaw)
        val cx = eye[0] + sy * cp; val cyy = eye[1] - sp; val cz = eye[2] - cy * cp
        Matrix.setLookAtM(view, 0, eye[0], eye[1], eye[2], cx, cyy, cz, 0f, 1f, 0f)
        Matrix.multiplyMM(mvp, 0, proj, 0, view, 0)

        shader.use()
        GLES30.glUniformMatrix4fv(uMVP, 1, false, mvp, 0)
        GLES30.glUniform3f(uCam, eye[0], eye[1], eye[2])
        GLES30.glUniform3f(uFogColor, sky[0], sky[1], sky[2])
        val visibility = 150f / env.fogDensity
        GLES30.glUniform1f(uFogScale, 1f / visibility)
        GLES30.glUniform1f(uGlobalLight, env.blockLight)
        val scoutBonus = if (p.character.background == 2) 1.3f else 1f
        GLES30.glUniform1f(uLamp, env.darkness * 0.45f * scoutBonus)
        GLES30.glUniform1f(uUseSolid, 0f)
        GLES30.glUniform4f(uSolid, 1f, 1f, 1f, 1f)
        GLES30.glUniform1f(uAlpha, 1f)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, TextureAtlas.textureId)

        // opaque chunk pass
        val pcx = Math.floorDiv(Math.floor(p.x).toInt(), CHUNK_SIZE)
        val pcz = Math.floorDiv(Math.floor(p.z).toInt(), CHUNK_SIZE)
        for ((key, m) in meshes) {
            if (m.opaqueVerts == 0) continue
            val ccx = (key shr 32).toInt(); val ccz = key.toInt()
            if (Math.abs(ccx - pcx) > RENDER_DIST + 1 || Math.abs(ccz - pcz) > RENDER_DIST + 1) continue
            drawVbo(m.vboOpaque, m.opaqueVerts)
        }

        drawZombies()

        // translucent pass
        GLES30.glEnable(GLES30.GL_BLEND)
        GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE_MINUS_SRC_ALPHA)
        GLES30.glDepthMask(false)
        GLES30.glUniformMatrix4fv(uMVP, 1, false, mvp, 0)
        GLES30.glUniform1f(uUseSolid, 0f)
        GLES30.glUniform1f(uAlpha, 0.62f)
        for ((key, m) in meshes) {
            if (m.transVerts == 0) continue
            val ccx = (key shr 32).toInt(); val ccz = key.toInt()
            if (Math.abs(ccx - pcx) > RENDER_DIST + 1 || Math.abs(ccz - pcz) > RENDER_DIST + 1) continue
            drawVbo(m.vboTrans, m.transVerts)
        }
        GLES30.glDepthMask(true)
        GLES30.glDisable(GLES30.GL_BLEND)
    }

    private fun drawVbo(vbo: Int, verts: Int) {
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vbo)
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, 24, 0)
        GLES30.glEnableVertexAttribArray(1)
        GLES30.glVertexAttribPointer(1, 2, GLES30.GL_FLOAT, false, 24, 12)
        GLES30.glEnableVertexAttribArray(2)
        GLES30.glVertexAttribPointer(2, 1, GLES30.GL_FLOAT, false, 24, 20)
        GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, verts)
    }

    // ------------------------------------------------------------ chunk streaming

    private fun streamChunks() {
        val p = engine.player
        val pcx = Math.floorDiv(Math.floor(p.x).toInt(), CHUNK_SIZE)
        val pcz = Math.floorDiv(Math.floor(p.z).toInt(), CHUNK_SIZE)

        // request missing/dirty chunks, nearest first
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
        // drop far meshes
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
        var budget = 4     // uploads per frame to avoid hitches
        while (budget-- > 0) {
            val r = uploadQueue.poll() ?: break
            val key = World.key(r.cx, r.cz)
            pendingMesh.remove(key)
            var m = meshes[key]
            if (m == null) { m = ChunkMeshGL(); meshes[key] = m } else m.delete()
            if (r.opaque.isNotEmpty()) {
                m.vboOpaque = makeVbo(r.opaque); m.opaqueVerts = r.opaque.size / 6
            } else { m.vboOpaque = 0; m.opaqueVerts = 0 }
            if (r.translucent.isNotEmpty()) {
                m.vboTrans = makeVbo(r.translucent); m.transVerts = r.translucent.size / 6
            } else { m.vboTrans = 0; m.transVerts = 0 }
        }
    }

    private fun makeVbo(data: FloatArray): Int {
        val ids = IntArray(1)
        GLES30.glGenBuffers(1, ids, 0)
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, ids[0])
        val buf = toBuffer(data)
        GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, data.size * 4, buf, GLES30.GL_STATIC_DRAW)
        return ids[0]
    }

    private fun toBuffer(data: FloatArray): FloatBuffer =
        ByteBuffer.allocateDirect(data.size * 4).order(ByteOrder.nativeOrder())
            .asFloatBuffer().put(data).apply { position(0) }

    // ------------------------------------------------------------ zombies

    private fun buildCube() {
        // unit cube [-0.5..0.5]x[0..1]x[-0.5..0.5], light per face baked into attribute
        val faces = arrayOf(
            floatArrayOf(-0.5f,0f,-0.5f, -0.5f,0f,0.5f, -0.5f,1f,0.5f, -0.5f,1f,-0.5f) to 0.7f,
            floatArrayOf(0.5f,0f,0.5f, 0.5f,0f,-0.5f, 0.5f,1f,-0.5f, 0.5f,1f,0.5f) to 0.7f,
            floatArrayOf(0.5f,0f,-0.5f, -0.5f,0f,-0.5f, -0.5f,1f,-0.5f, 0.5f,1f,-0.5f) to 0.84f,
            floatArrayOf(-0.5f,0f,0.5f, 0.5f,0f,0.5f, 0.5f,1f,0.5f, -0.5f,1f,0.5f) to 0.84f,
            floatArrayOf(-0.5f,1f,0.5f, 0.5f,1f,0.5f, 0.5f,1f,-0.5f, -0.5f,1f,-0.5f) to 1f,
            floatArrayOf(-0.5f,0f,-0.5f, 0.5f,0f,-0.5f, 0.5f,0f,0.5f, -0.5f,0f,0.5f) to 0.45f,
        )
        val list = ArrayList<Float>()
        val order = intArrayOf(0, 1, 2, 0, 2, 3)
        for ((q, light) in faces) for (i in order) {
            list.add(q[i*3]); list.add(q[i*3+1]); list.add(q[i*3+2])
            list.add(0f); list.add(0f); list.add(light)
        }
        cubeVbo = makeVbo(list.toFloatArray())
        cubeVerts = list.size / 6
    }

    private fun drawZombies() {
        GLES30.glUniform1f(uUseSolid, 1f)
        for (zb in engine.zombies) {
            val d = zb.distTo(engine.player.x, engine.player.z)
            if (d > 90.0) continue
            drawZombie(zb)
        }
        GLES30.glUniform1f(uUseSolid, 0f)
        GLES30.glUniformMatrix4fv(uMVP, 1, false, mvp, 0)
    }

    private fun part(zb: Zombie, ox: Float, oy: Float, oz: Float, sx: Float, sy: Float, sz: Float, pitchRad: Float) {
        Matrix.setIdentityM(model, 0)
        Matrix.translateM(model, 0, zb.x.toFloat(), zb.y.toFloat(), zb.z.toFloat())
        Matrix.rotateM(model, 0, -Math.toDegrees(zb.yaw.toDouble()).toFloat(), 0f, 1f, 0f)
        Matrix.translateM(model, 0, ox, oy, oz)
        if (pitchRad != 0f) Matrix.rotateM(model, 0, Math.toDegrees(pitchRad.toDouble()).toFloat(), 1f, 0f, 0f)
        Matrix.scaleM(model, 0, sx, sy, sz)
        Matrix.multiplyMM(tmp, 0, mvp, 0, model, 0)
        GLES30.glUniformMatrix4fv(uMVP, 1, false, tmp, 0)
        GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, cubeVerts)
    }

    private fun drawZombie(zb: Zombie) {
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, cubeVbo)
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, 24, 0)
        GLES30.glEnableVertexAttribArray(1)
        GLES30.glVertexAttribPointer(1, 2, GLES30.GL_FLOAT, false, 24, 12)
        GLES30.glEnableVertexAttribArray(2)
        GLES30.glVertexAttribPointer(2, 1, GLES30.GL_FLOAT, false, 24, 20)

        val dead = zb.state == Zombie.State.DEAD
        val fall = if (dead) (zb.deadTimer * 2f).coerceAtMost(1f) else 0f
        // rotted skin: gray-green with per-zombie variation, darkening as it dies
        val g = 0.30f + zb.tint * 0.12f
        val alive = 1f - fall * 0.5f
        GLES30.glUniform4f(uSolid, (g - 0.06f) * alive, (g + 0.04f) * alive, (g - 0.08f) * alive, 1f)

        val swing = sin(zb.animPhase) * (if (zb.state == Zombie.State.CHASE) 0.7f else 0.35f)
        val b = zb.bulk
        val yBase = if (dead) 0.15f else 0f
        val squash = 1f - fall * 0.85f
        // legs
        part(zb, -0.11f * b, yBase, 0f, 0.16f * b, 0.75f * squash, 0.16f * b, swing)
        part(zb, 0.11f * b, yBase, 0f, 0.16f * b, 0.75f * squash, 0.16f * b, -swing)
        // torso
        part(zb, 0f, yBase + 0.72f * squash, 0f, 0.44f * b, 0.62f * squash, 0.24f * b, 0f)
        // arms reach forward when hunting
        val armPitch = if (zb.state == Zombie.State.CHASE || zb.state == Zombie.State.ATTACK) -1.35f else -0.15f + swing * 0.4f
        GLES30.glUniform4f(uSolid, (g - 0.04f) * alive, (g + 0.05f) * alive, (g - 0.07f) * alive, 1f)
        part(zb, -0.30f * b, yBase + 1.22f * squash, 0f, 0.13f * b, 0.55f, 0.13f * b, armPitch)
        part(zb, 0.30f * b, yBase + 1.22f * squash, 0f, 0.13f * b, 0.55f, 0.13f * b, armPitch + swing * 0.2f)
        // head — pallid
        GLES30.glUniform4f(uSolid, 0.45f * alive, 0.48f * alive, 0.40f * alive, 1f)
        part(zb, 0f, yBase + 1.36f * squash, 0f, 0.26f, 0.28f, 0.26f, 0f)
    }
}
