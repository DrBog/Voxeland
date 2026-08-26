package com.voxeland.game.gl

import com.voxeland.game.core.Blocks
import com.voxeland.game.core.CHUNK_H
import com.voxeland.game.core.CHUNK_SIZE
import com.voxeland.game.core.Chunk
import com.voxeland.game.core.LightEngine
import com.voxeland.game.core.Rng
import com.voxeland.game.core.World
import kotlin.math.sqrt

/**
 * Face-culled chunk meshing on a background thread.
 *
 * World vertices are pos(3) uv(2) ao(1) sky(1). The sky term is the
 * propagated light of the *air cell the face is exposed to*, so a wall
 * beside a window is bright and the same wall six metres deeper is black.
 *
 * The mesher also bakes light-shaft geometry wherever bright outside air
 * meets dark inside air — the beams themselves are static, and the shader
 * decides how strongly each one burns from the live sun bearing.
 */
object ChunkMesher {

    class Result(
        val cx: Int, val cz: Int,
        val opaque: FloatArray,
        val translucent: FloatArray,
        val shafts: FloatArray,
    )

    private val FACES = arrayOf(
        floatArrayOf(0f,0f,0f, 0f,0f,1f, 0f,1f,1f, 0f,1f,0f),   // -X
        floatArrayOf(1f,0f,1f, 1f,0f,0f, 1f,1f,0f, 1f,1f,1f),   // +X
        floatArrayOf(1f,0f,0f, 0f,0f,0f, 0f,1f,0f, 1f,1f,0f),   // -Z
        floatArrayOf(0f,0f,1f, 1f,0f,1f, 1f,1f,1f, 0f,1f,1f),   // +Z
        floatArrayOf(0f,1f,1f, 1f,1f,1f, 1f,1f,0f, 0f,1f,0f),   // +Y
        floatArrayOf(0f,0f,0f, 1f,0f,0f, 1f,0f,1f, 0f,0f,1f),   // -Y
    )
    private val NDX = intArrayOf(-1, 1, 0, 0, 0, 0)
    private val NDY = intArrayOf(0, 0, 0, 0, 1, -1)
    private val NDZ = intArrayOf(0, 0, -1, 1, 0, 0)

    /** directional shading — deepened so form reads even in dim light */
    private val FACE_AO = floatArrayOf(0.62f, 0.62f, 0.78f, 0.78f, 1.0f, 0.34f)

    private const val MAX_SHAFTS_PER_CHUNK = 40
    private val ORDER = intArrayOf(0, 1, 2, 0, 2, 3)

    fun mesh(world: World, c: Chunk, field: LightEngine.Field): Result {
        val opaque = ArrayList<Float>(16384)
        val trans = ArrayList<Float>(1024)
        val shafts = ArrayList<Float>(512)
        val bx = c.cx * CHUNK_SIZE; val bz = c.cz * CHUNK_SIZE
        val maxL = LightEngine.MAX.toFloat()

        fun blockAt(x: Int, y: Int, z: Int): Byte {
            if (y < 0) return Blocks.STONE
            if (y >= CHUNK_H) return Blocks.AIR
            return if (x in 0 until CHUNK_SIZE && z in 0 until CHUNK_SIZE) c.get(x, y, z)
            else world.block(bx + x, y, bz + z)
        }

        fun skyAt(x: Int, y: Int, z: Int): Float {
            val v = field.at(bx + x, y, bz + z)
            return if (v < 0) 0f else v / maxL
        }

        var shaftCount = 0

        for (x in 0 until CHUNK_SIZE) for (z in 0 until CHUNK_SIZE) {
            for (y in 0 until CHUNK_H) {
                val b = c.get(x, y, z)

                if (b == Blocks.AIR) {
                    if (shaftCount < MAX_SHAFTS_PER_CHUNK)
                        shaftCount += tryShaft(world, field, shafts, bx, bz, x, y, z, maxL)
                    continue
                }

                val translucentSelf = Blocks.isTranslucentMesh(b)
                for (f in 0 until 6) {
                    val nx = x + NDX[f]; val ny = y + NDY[f]; val nz = z + NDZ[f]
                    val n = blockAt(nx, ny, nz)
                    val show = if (translucentSelf)
                        n == Blocks.AIR || (!Blocks.isTranslucentMesh(n) && Blocks.isTransparent(n))
                    else Blocks.isTransparent(n)
                    if (!show) continue

                    val uv = TextureAtlas.uv(b, f)
                    val ao = FACE_AO[f]
                    // the face is lit by the air it faces, not by its own cell
                    val sky = skyAt(nx, ny, nz)
                    val fx = (bx + x).toFloat(); val fy = y.toFloat(); val fz = (bz + z).toFloat()
                    val q = FACES[f]
                    val list = if (translucentSelf) trans else opaque
                    for (i in ORDER) {
                        val cx3 = q[i * 3]; val cy3 = q[i * 3 + 1]; val cz3 = q[i * 3 + 2]
                        list.add(fx + cx3); list.add(fy + cy3); list.add(fz + cz3)
                        val u = when (f) {
                            0, 1 -> if (cz3 > 0.5f) uv[2] else uv[0]
                            else -> if (cx3 > 0.5f) uv[2] else uv[0]
                        }
                        val v = when (f) {
                            4, 5 -> if (cz3 > 0.5f) uv[3] else uv[1]
                            else -> if (cy3 > 0.5f) uv[1] else uv[3]
                        }
                        list.add(u); list.add(v); list.add(ao); list.add(sky)
                    }
                }
            }
        }
        return Result(c.cx, c.cz, opaque.toFloatArray(), trans.toFloatArray(), shafts.toFloatArray())
    }

    /**
     * Bright air next to dark air is a window, a doorway or a hole in a roof.
     * Bake a beam running from the opening into the dark side; returns 1 when
     * one was emitted.
     */
    private fun tryShaft(
        world: World, field: LightEngine.Field, out: ArrayList<Float>,
        bx: Int, bz: Int, x: Int, y: Int, z: Int, maxL: Float,
    ): Int {
        val wx = bx + x; val wz = bz + z
        val here = field.at(wx, y, wz)
        if (here < 6) return 0

        // thin the beams out deterministically so a glass facade does not
        // turn into a wall of light
        if (Rng.nextFloat(world.seed, wx, y * 31, wz) > 0.16f) return 0

        var dx = 0; var dz = 0; var best = here
        for (d in 0 until 4) {
            val ox = if (d == 0) -1 else if (d == 1) 1 else 0
            val oz = if (d == 2) -1 else if (d == 3) 1 else 0
            val n = field.at(wx + ox, y, wz + oz)
            if (n in 0 until best - 3 && Blocks.lightCost(world.block(wx + ox, y, wz + oz)) > 0) {
                best = n; dx = ox; dz = oz
            }
        }
        // a hole overhead with darkness beneath makes a vertical shaft
        var vertical = false
        if (dx == 0 && dz == 0) {
            val below = field.at(wx, y - 1, wz)
            val above = field.at(wx, y + 1, wz)
            if (above >= here && below in 0 until here - 3 &&
                Blocks.lightCost(world.block(wx, y - 1, wz)) > 0) vertical = true
            if (!vertical) return 0
        }

        val ox = wx + 0.5f; val oy = y + 0.5f; val oz2 = wz + 0.5f
        val strength = 0.34f * (here / maxL)
        if (vertical) {
            emitBeam(out, ox, oy, oz2, 0f, -1f, 0f, 7f, 0f, 0f, strength, 0.40f)
        } else {
            val len = 7.5f
            emitBeam(out, ox, oy, oz2, dx.toFloat(), -0.42f, dz.toFloat(), len,
                dx.toFloat(), dz.toFloat(), strength, 0.44f)
        }
        return 1
    }

    /**
     * Two crossed quad strips along the beam axis: cheap on a phone, and from
     * any normal viewing angle it reads as a solid column of lit dust.
     */
    private fun emitBeam(
        out: ArrayList<Float>,
        ox: Float, oy: Float, oz: Float,
        dirX: Float, dirY: Float, dirZ: Float,
        length: Float, encX: Float, encZ: Float,
        alpha0: Float, halfWidth: Float,
    ) {
        val dl = sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ)
        if (dl < 1e-4f) return
        val ux = dirX / dl; val uy = dirY / dl; val uz = dirZ / dl

        // two axes perpendicular to the beam
        var ax = -uz; var ay = 0f; var az = ux
        var al = sqrt(ax * ax + az * az)
        if (al < 1e-4f) { ax = 1f; ay = 0f; az = 0f; al = 1f }
        ax /= al; az /= al
        val bx2 = uy * az - uz * ay
        val by2 = uz * ax - ux * az
        val bz2 = ux * ay - uy * ax

        val segs = 5
        for (i in 0 until segs) {
            val t0 = length * i / segs
            val t1 = length * (i + 1) / segs
            val a0 = alpha0 * fade(t0 / length)
            val a1 = alpha0 * fade(t1 / length)
            // widen slightly with distance, like a real spreading beam
            val w0 = halfWidth * (1f + 0.30f * (t0 / length))
            val w1 = halfWidth * (1f + 0.30f * (t1 / length))
            quad(out, ox, oy, oz, ux, uy, uz, ax, ay, az, t0, t1, w0, w1, a0, a1, encX, encZ)
            quad(out, ox, oy, oz, ux, uy, uz, bx2, by2, bz2, t0, t1, w0, w1, a0, a1, encX, encZ)
        }
    }

    private fun fade(t: Float): Float {
        val k = (1f - t).coerceIn(0f, 1f)
        return k * k
    }

    private fun quad(
        out: ArrayList<Float>,
        ox: Float, oy: Float, oz: Float,
        ux: Float, uy: Float, uz: Float,
        px: Float, py: Float, pz: Float,
        t0: Float, t1: Float, w0: Float, w1: Float,
        a0: Float, a1: Float, encX: Float, encZ: Float,
    ) {
        val x0 = ox + ux * t0; val y0 = oy + uy * t0; val z0 = oz + uz * t0
        val x1 = ox + ux * t1; val y1 = oy + uy * t1; val z1 = oz + uz * t1
        val c = floatArrayOf(
            x0 - px * w0, y0 - py * w0, z0 - pz * w0, a0,
            x0 + px * w0, y0 + py * w0, z0 + pz * w0, a0,
            x1 + px * w1, y1 + py * w1, z1 + pz * w1, a1,
            x1 - px * w1, y1 - py * w1, z1 - pz * w1, a1,
        )
        for (i in ORDER) {
            out.add(c[i * 4]); out.add(c[i * 4 + 1]); out.add(c[i * 4 + 2])
            out.add(c[i * 4 + 3]); out.add(encX); out.add(encZ)
        }
    }
}
