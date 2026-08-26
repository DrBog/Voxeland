package com.voxeland.game.gl

import com.voxeland.game.core.Blocks
import com.voxeland.game.core.CHUNK_H
import com.voxeland.game.core.CHUNK_SIZE
import com.voxeland.game.core.Chunk
import com.voxeland.game.core.World

/**
 * Face-culled chunk meshing on a background thread. Vertex layout:
 * pos(3) uv(2) light(1) — 6 floats, 6 vertices per face.
 */
object ChunkMesher {

    class Result(val cx: Int, val cz: Int, val opaque: FloatArray, val translucent: FloatArray)

    // face -> 4 corners (ccw from outside), each corner is xyz offsets
    private val FACES = arrayOf(
        // -X
        floatArrayOf(0f,0f,0f, 0f,0f,1f, 0f,1f,1f, 0f,1f,0f),
        // +X
        floatArrayOf(1f,0f,1f, 1f,0f,0f, 1f,1f,0f, 1f,1f,1f),
        // -Z
        floatArrayOf(1f,0f,0f, 0f,0f,0f, 0f,1f,0f, 1f,1f,0f),
        // +Z
        floatArrayOf(0f,0f,1f, 1f,0f,1f, 1f,1f,1f, 0f,1f,1f),
        // +Y (top)
        floatArrayOf(0f,1f,1f, 1f,1f,1f, 1f,1f,0f, 0f,1f,0f),
        // -Y
        floatArrayOf(0f,0f,0f, 1f,0f,0f, 1f,0f,1f, 0f,0f,1f),
    )
    private val NORMAL_DX = intArrayOf(-1, 1, 0, 0, 0, 0)
    private val NORMAL_DY = intArrayOf(0, 0, 0, 0, 1, -1)
    private val NORMAL_DZ = intArrayOf(0, 0, -1, 1, 0, 0)
    private val FACE_LIGHT = floatArrayOf(0.70f, 0.70f, 0.84f, 0.84f, 1.0f, 0.45f)

    fun mesh(world: World, c: Chunk): Result {
        val opaque = ArrayList<Float>(16384)
        val trans = ArrayList<Float>(1024)
        val bx = c.cx * CHUNK_SIZE; val bz = c.cz * CHUNK_SIZE

        // per-column "highest solid" for cheap interior dimming
        val topSolid = IntArray(CHUNK_SIZE * CHUNK_SIZE)
        for (x in 0 until CHUNK_SIZE) for (z in 0 until CHUNK_SIZE) {
            var t = -1
            for (y in CHUNK_H - 1 downTo 0) {
                val b = c.get(x, y, z)
                if (b != Blocks.AIR && !Blocks.isTransparent(b)) { t = y; break }
            }
            topSolid[x * CHUNK_SIZE + z] = t
        }

        fun blockAt(x: Int, y: Int, z: Int): Byte {
            if (y < 0) return Blocks.STONE
            if (y >= CHUNK_H) return Blocks.AIR
            return if (x in 0 until CHUNK_SIZE && z in 0 until CHUNK_SIZE) c.get(x, y, z)
            else world.block(bx + x, y, bz + z)
        }

        for (x in 0 until CHUNK_SIZE) for (z in 0 until CHUNK_SIZE) {
            val colTop = topSolid[x * CHUNK_SIZE + z]
            for (y in 0 until CHUNK_H) {
                val b = c.get(x, y, z)
                if (b == Blocks.AIR) continue
                val translucentSelf = Blocks.isTranslucentMesh(b)
                for (f in 0 until 6) {
                    val n = blockAt(x + NORMAL_DX[f], y + NORMAL_DY[f], z + NORMAL_DZ[f])
                    val show = if (translucentSelf) n == Blocks.AIR || (!Blocks.isTranslucentMesh(n) && Blocks.isTransparent(n))
                    else Blocks.isTransparent(n)
                    if (!show) continue

                    val uv = TextureAtlas.uv(b, f)
                    var light = FACE_LIGHT[f]
                    // dim faces buried under a roof — interiors read as dark rooms
                    if (y < colTop) light *= 0.52f
                    val fx = (bx + x).toFloat(); val fy = y.toFloat(); val fz = (bz + z).toFloat()
                    val q = FACES[f]
                    val list = if (translucentSelf) trans else opaque
                    // two triangles: 0,1,2  0,2,3
                    val order = intArrayOf(0, 1, 2, 0, 2, 3)
                    for (i in order) {
                        val cx3 = q[i * 3]; val cy3 = q[i * 3 + 1]; val cz3 = q[i * 3 + 2]
                        list.add(fx + cx3); list.add(fy + cy3); list.add(fz + cz3)
                        // simple per-corner uv mapping
                        val u = when (f) {
                            0, 1 -> if (cz3 > 0.5f) uv[2] else uv[0]
                            2, 3 -> if (cx3 > 0.5f) uv[2] else uv[0]
                            else -> if (cx3 > 0.5f) uv[2] else uv[0]
                        }
                        val v = when (f) {
                            4, 5 -> if (cz3 > 0.5f) uv[3] else uv[1]
                            else -> if (cy3 > 0.5f) uv[1] else uv[3]
                        }
                        list.add(u); list.add(v); list.add(light)
                    }
                }
            }
        }
        return Result(c.cx, c.cz, opaque.toFloatArray(), trans.toFloatArray())
    }
}
