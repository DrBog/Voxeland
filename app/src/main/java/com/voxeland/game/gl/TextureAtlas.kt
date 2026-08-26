package com.voxeland.game.gl

import android.opengl.GLES30
import android.opengl.GLUtils
import android.graphics.Bitmap
import com.voxeland.game.core.Blocks
import com.voxeland.game.core.Rng

/**
 * Procedurally painted 256x256 texture atlas: 8x8 grid of 32px tiles.
 * Every material is synthesized — muted, desaturated, weathered. No
 * source art exists; the palette IS the mood.
 */
object TextureAtlas {
    const val TILES = 8
    const val TILE_PX = 32
    const val SIZE = TILES * TILE_PX
    private const val EPS = 0.06f / TILES     // uv inset against bleeding

    var textureId = 0; private set

    // tile index per block id (side), plus special top tiles
    private val tileOf = IntArray(Blocks.COUNT)
    private val tileTop = IntArray(Blocks.COUNT)

    fun uv(block: Byte, face: Int): FloatArray {
        val t = if (face == 4) tileTop[block.toInt()] else tileOf[block.toInt()]
        val tx = t % TILES; val ty = t / TILES
        val u0 = tx.toFloat() / TILES + EPS; val v0 = ty.toFloat() / TILES + EPS
        val u1 = (tx + 1).toFloat() / TILES - EPS; val v1 = (ty + 1).toFloat() / TILES - EPS
        return floatArrayOf(u0, v0, u1, v1)
    }

    private fun rgb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b

    fun build() {
        val px = IntArray(SIZE * SIZE)
        var next = 0
        val seed = 4242L

        fun tile(block: Byte, top: Boolean = false, painter: (Int, Int, Long) -> Int): Int {
            val t = next++
            val ox = (t % TILES) * TILE_PX; val oy = (t / TILES) * TILE_PX
            val ts = seed + t * 977L
            for (y in 0 until TILE_PX) for (x in 0 until TILE_PX)
                px[(oy + y) * SIZE + ox + x] = painter(x, y, ts)
            if (top) tileTop[block.toInt()] = t else { tileOf[block.toInt()] = t; tileTop[block.toInt()] = t }
            return t
        }

        fun n(ts: Long, x: Int, y: Int, amp: Int) = ((Rng.nextFloat(ts, x, y) - 0.5f) * 2f * amp).toInt()
        fun grime(base: Int, v: Int): Int {
            val r = ((base shr 16 and 0xFF) + v).coerceIn(0, 255)
            val g = ((base shr 8 and 0xFF) + v).coerceIn(0, 255)
            val b = ((base and 0xFF) + v).coerceIn(0, 255)
            return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }

        // ---- ground
        tile(Blocks.ASPHALT) { x, y, ts -> grime(rgb(52, 52, 54), n(ts, x, y, 7) + if (Rng.nextFloat(ts, x/5, y/5) < 0.06f) -14 else 0) }
        tile(Blocks.ROAD_LINE) { x, y, ts ->
            if (y in 13..18 && Rng.nextFloat(ts, x, 1) > 0.15f) grime(rgb(148, 140, 108), n(ts, x, y, 10))
            else grime(rgb(52, 52, 54), n(ts, x, y, 7))
        }
        tile(Blocks.SIDEWALK) { x, y, ts ->
            val c = if (x % 16 == 0 || y % 16 == 0) rgb(88, 88, 86) else rgb(112, 111, 106)
            grime(c, n(ts, x, y, 6))
        }
        tile(Blocks.DIRT) { x, y, ts -> grime(rgb(84, 70, 56), n(ts, x, y, 9)) }
        tile(Blocks.GRASS) { x, y, ts -> grime(rgb(86, 92, 60), n(ts, x, y, 11) + if (Rng.nextFloat(ts, x, y+9) < 0.2f) -18 else 0) }
        tile(Blocks.STONE) { x, y, ts -> grime(rgb(96, 96, 98), n(ts, x/2, y/2, 10)) }
        tile(Blocks.GRAVEL) { x, y, ts -> grime(rgb(104, 100, 94), n(ts, x, y, 16)) }

        // ---- structure
        tile(Blocks.CONCRETE) { x, y, ts -> grime(rgb(120, 120, 116), n(ts, x/3, y/3, 8) + n(ts, x, y, 4)) }
        tile(Blocks.CONCRETE_DARK) { x, y, ts -> grime(rgb(78, 80, 82), n(ts, x/3, y/3, 8)) }
        fun brickPainter(mortar: Int, brick: Int): (Int, Int, Long) -> Int = { x, y, ts ->
            val row = y / 8
            val off = if (row % 2 == 0) 0 else 8
            val bx = (x + off) % 16
            val c = if (y % 8 == 7 || bx == 15) mortar else brick
            grime(c, n(ts, x, y, 6))
        }
        tile(Blocks.BRICK_RED, painter = brickPainter(rgb(70, 62, 58), rgb(110, 62, 52)))
        tile(Blocks.BRICK_GRAY, painter = brickPainter(rgb(60, 60, 60), rgb(92, 90, 88)))
        tile(Blocks.PLANK) { x, y, ts ->
            val c = if (y % 8 == 0) rgb(66, 52, 40) else rgb(104, 84, 62)
            grime(c, n(ts, x/6, y, 8) + n(ts, x, y, 3))
        }
        tile(Blocks.WOOD_FRAME) { x, y, ts ->
            val c = if (x % 8 == 0 || y % 8 == 0) rgb(72, 58, 44) else rgb(122, 104, 82)
            grime(c, n(ts, x, y, 5))
        }
        tile(Blocks.GLASS) { x, y, ts ->
            if (x == 0 || y == 0 || x == 31 || y == 31) rgb(70, 74, 76)
            else grime(rgb(128, 140, 146), n(ts, x/4, y/4, 5))
        }
        tile(Blocks.GLASS_DARK) { x, y, ts ->
            if (x == 0 || y == 0 || x == 31 || y == 31) rgb(40, 44, 48)
            else grime(rgb(58, 68, 76), n(ts, x/4, y/4, 4))
        }
        tile(Blocks.WINDOW_BOARDED) { x, y, ts ->
            val diag = (x + y) in 26..36 || (x - y) in -4..4
            val c = if (diag) rgb(96, 78, 58) else rgb(50, 44, 38)
            grime(c, n(ts, x, y, 7))
        }
        tile(Blocks.ROOF_SHINGLE) { x, y, ts ->
            val c = if (y % 6 == 0 || (x + (y / 6) * 5) % 10 == 0) rgb(44, 42, 44) else rgb(74, 70, 72)
            grime(c, n(ts, x, y, 5))
        }
        tile(Blocks.ROOF_TAR) { x, y, ts -> grime(rgb(58, 56, 54), n(ts, x/2, y/2, 5)) }
        tile(Blocks.METAL_PANEL) { x, y, ts ->
            val c = if (x % 10 == 0) rgb(82, 86, 90) else rgb(106, 110, 114)
            grime(c, n(ts, x/8, y/2, 5))
        }
        tile(Blocks.METAL_RUST) { x, y, ts ->
            val rust = Rng.nextFloat(ts, x/3, y/3) < 0.4f
            grime(if (rust) rgb(104, 66, 44) else rgb(96, 96, 98), n(ts, x, y, 10))
        }
        tile(Blocks.DOOR_FRAME) { x, y, ts -> grime(rgb(70, 56, 42), n(ts, x/4, y, 6)) }

        // ---- furniture / loot
        tile(Blocks.CONTAINER) { x, y, ts ->
            val edge = x < 2 || y < 2 || x > 29 || y > 29
            grime(if (edge) rgb(74, 60, 42) else rgb(112, 92, 62), n(ts, x, y, 6))
        }
        tile(Blocks.CONTAINER, top = true) { x, y, ts ->
            val cross = kotlin.math.abs(x - y) < 2 || kotlin.math.abs(x + y - 31) < 2
            grime(if (cross) rgb(80, 66, 46) else rgb(118, 98, 66), n(ts, x, y, 6))
        }
        tile(Blocks.SHELF) { x, y, ts ->
            val c = if (y % 10 < 2) rgb(120, 118, 112) else if (Rng.nextFloat(ts, x/4, y/5) < 0.5f) rgb(90, 74, 60) else rgb(70, 76, 66)
            grime(c, n(ts, x, y, 8))
        }
        tile(Blocks.COUNTER) { x, y, ts ->
            val c = if (y < 4) rgb(118, 114, 108) else if (x % 16 < 1 || y % 14 < 1) rgb(58, 50, 42) else rgb(94, 78, 60)
            grime(c, n(ts, x, y, 5))
        }
        tile(Blocks.RUBBLE) { x, y, ts -> grime(if (Rng.nextFloat(ts, x/2, y/2) < 0.5f) rgb(94, 90, 86) else rgb(70, 64, 58), n(ts, x, y, 14)) }
        tile(Blocks.LOG_DEAD) { x, y, ts -> grime(if (x % 9 == 0) rgb(52, 44, 36) else rgb(78, 66, 54), n(ts, x/3, y, 7)) }
        tile(Blocks.LEAVES_DEAD) { x, y, ts ->
            if (Rng.nextFloat(ts, x, y) < 0.30f) 0x00000000
            else grime(rgb(92, 78, 46), n(ts, x, y, 12))
        }
        tile(Blocks.FENCE) { x, y, ts ->
            val wire = (x + y) % 8 < 1 || (x - y + 64) % 8 < 1 || x < 1 || x > 30 || y < 1
            if (wire) grime(rgb(110, 112, 114), n(ts, x, y, 8)) else 0x00000000
        }
        tile(Blocks.BARRICADE) { x, y, ts ->
            val g = (x + y / 2) % 11 < 4
            grime(if (g) rgb(98, 80, 58) else rgb(66, 54, 42), n(ts, x, y, 8))
        }
        tile(Blocks.TILE_FLOOR) { x, y, ts ->
            val c = if (x % 8 == 0 || y % 8 == 0) rgb(74, 76, 74) else rgb(122, 124, 118)
            grime(c, n(ts, x, y, 4) + if (Rng.nextFloat(ts, x/6, y/6) < 0.1f) -20 else 0)
        }
        tile(Blocks.CARPET) { x, y, ts -> grime(rgb(78, 62, 58), n(ts, x, y, 6)) }
        // grass gets a distinct top
        tile(Blocks.GRASS, top = true) { x, y, ts -> grime(rgb(80, 88, 56), n(ts, x, y, 12)) }

        val bmp = Bitmap.createBitmap(px, SIZE, SIZE, Bitmap.Config.ARGB_8888)
        val ids = IntArray(1)
        GLES30.glGenTextures(1, ids, 0)
        textureId = ids[0]
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textureId)
        GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, bmp, 0)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_NEAREST)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_NEAREST)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
        bmp.recycle()
    }
}
