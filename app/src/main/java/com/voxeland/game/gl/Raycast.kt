package com.voxeland.game.gl

import com.voxeland.game.core.Blocks
import com.voxeland.game.core.World
import kotlin.math.floor

data class RayHit(val x: Int, val y: Int, val z: Int, val block: Byte, val faceX: Int, val faceY: Int, val faceZ: Int)

/** Amanatides & Woo voxel traversal. */
object Raycast {
    fun cast(world: World, ox: Double, oy: Double, oz: Double, dx: Double, dy: Double, dz: Double, maxDist: Double): RayHit? {
        var x = floor(ox).toInt(); var y = floor(oy).toInt(); var z = floor(oz).toInt()
        val stepX = if (dx > 0) 1 else -1
        val stepY = if (dy > 0) 1 else -1
        val stepZ = if (dz > 0) 1 else -1
        val tDeltaX = if (dx != 0.0) kotlin.math.abs(1.0 / dx) else Double.MAX_VALUE
        val tDeltaY = if (dy != 0.0) kotlin.math.abs(1.0 / dy) else Double.MAX_VALUE
        val tDeltaZ = if (dz != 0.0) kotlin.math.abs(1.0 / dz) else Double.MAX_VALUE
        var tMaxX = if (dx > 0) (x + 1 - ox) * tDeltaX * dx * stepX else if (dx < 0) (ox - x) * tDeltaX * -dx * stepX else Double.MAX_VALUE
        var tMaxY = if (dy > 0) (y + 1 - oy) * tDeltaY * dy * stepY else if (dy < 0) (oy - y) * tDeltaY * -dy * stepY else Double.MAX_VALUE
        var tMaxZ = if (dz > 0) (z + 1 - oz) * tDeltaZ * dz * stepZ else if (dz < 0) (oz - z) * tDeltaZ * -dz * stepZ else Double.MAX_VALUE
        // normalize tMax properly
        tMaxX = if (dx != 0.0) (if (dx > 0) (x + 1 - ox) / dx else (x - ox) / dx) else Double.MAX_VALUE
        tMaxY = if (dy != 0.0) (if (dy > 0) (y + 1 - oy) / dy else (y - oy) / dy) else Double.MAX_VALUE
        tMaxZ = if (dz != 0.0) (if (dz > 0) (z + 1 - oz) / dz else (z - oz) / dz) else Double.MAX_VALUE

        var t = 0.0
        var fx = 0; var fy = 0; var fz = 0
        while (t <= maxDist) {
            val b = world.block(x, y, z)
            if (b != Blocks.AIR && (t > 0.0 || true)) {
                if (b != Blocks.AIR) return RayHit(x, y, z, b, fx, fy, fz)
            }
            if (tMaxX < tMaxY && tMaxX < tMaxZ) {
                x += stepX; t = tMaxX; tMaxX += tDeltaX; fx = -stepX; fy = 0; fz = 0
            } else if (tMaxY < tMaxZ) {
                y += stepY; t = tMaxY; tMaxY += tDeltaY; fx = 0; fy = -stepY; fz = 0
            } else {
                z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; fx = 0; fy = 0; fz = -stepZ
            }
        }
        return null
    }
}
