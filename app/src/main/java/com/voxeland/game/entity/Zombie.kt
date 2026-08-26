package com.voxeland.game.entity

import com.voxeland.game.core.Blocks
import com.voxeland.game.core.SplitMix
import com.voxeland.game.core.World
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

class Zombie(var x: Double, var y: Double, var z: Double, seed: Long) {
    enum class State { WANDER, CHASE, ATTACK, DEAD }

    val rng = SplitMix(seed)
    var vx = 0.0; var vy = 0.0; var vz = 0.0
    var yaw = rng.nextFloat() * 6.283f
    var health = 34f + rng.nextFloat() * 22f
    var state = State.WANDER
    var onGround = false
    var attackCooldown = 0f
    var thinkTimer = 0f
    var groanTimer = rng.nextFloat() * 14f
    var animPhase = rng.nextFloat() * 6.283f
    var deadTimer = 0f
    /** cosmetic variation: rot tint + build */
    val tint = rng.nextFloat()
    val bulk = 0.9f + rng.nextFloat() * 0.25f

    companion object {
        const val HALF_W = 0.32
        const val HEIGHT = 1.75
        const val ATTACK_RANGE = 1.55
    }

    fun distTo(px: Double, pz: Double): Double {
        val dx = px - x; val dz = pz - z
        return sqrt(dx * dx + dz * dz)
    }

    /**
     * @param darkness 0 day .. 1 night — the dark makes them fast and far-sighted
     * @return damage dealt to player this tick (0 if none), -1 if groan requested
     */
    fun update(world: World, dt: Float, p: Player, darkness: Float, detectMul: Float): Float {
        if (state == State.DEAD) { deadTimer += dt; return 0f }

        attackCooldown -= dt
        thinkTimer -= dt
        groanTimer -= dt
        animPhase += dt * (if (state == State.CHASE) 9f else 3.5f)

        val dist = distTo(p.x, p.z)
        val dy = kotlin.math.abs(p.y - y)

        // detection: darkness emboldens them; crouching and skills hide you
        var detect = (11.0 + 14.0 * darkness) * detectMul
        if (p.crouching) detect *= 0.55
        if (p.sprinting) detect *= 1.5

        when (state) {
            State.WANDER -> {
                if (dist < detect && dy < 6.0) { state = State.CHASE }
                else if (thinkTimer <= 0f) {
                    thinkTimer = 2.5f + rng.nextFloat() * 4f
                    if (rng.nextFloat() < 0.6f) yaw = rng.nextFloat() * 6.283f
                }
            }
            State.CHASE -> {
                yaw = atan2(p.x - x, -(p.z - z)).toFloat()
                if (dist > detect * 1.9 || dy > 8.0) state = State.WANDER
                if (dist < ATTACK_RANGE && dy < 2.0) state = State.ATTACK
            }
            State.ATTACK -> {
                yaw = atan2(p.x - x, -(p.z - z)).toFloat()
                if (dist > ATTACK_RANGE * 1.2) state = State.CHASE
                else if (attackCooldown <= 0f) {
                    attackCooldown = 1.1f + rng.nextFloat() * 0.5f
                    return 7f + rng.nextFloat() * 7f + darkness * 3f
                }
            }
            State.DEAD -> {}
        }

        // locomotion
        val speed = when (state) {
            State.CHASE -> 2.6 + 1.5 * darkness
            State.ATTACK -> 0.6
            else -> 0.75
        }
        val mx = sin(yaw).toDouble() * speed
        val mz = -cos(yaw).toDouble() * speed
        vx += (mx - vx) * kotlin.math.min(1.0, 8.0 * dt)
        vz += (mz - vz) * kotlin.math.min(1.0, 8.0 * dt)
        vy -= 22.0 * dt
        if (vy < -30.0) vy = -30.0

        // jump over knee-high obstacles while chasing
        if (onGround && state != State.ATTACK) {
            val aheadX = Math.floor(x + sin(yaw) * 0.8).toInt()
            val aheadZ = Math.floor(z - cos(yaw) * 0.8).toInt()
            val feet = Math.floor(y).toInt()
            if (world.isSolidForCollision(aheadX, feet, aheadZ) &&
                !world.isSolidForCollision(aheadX, feet + 1, aheadZ)) {
                vy = 6.8; onGround = false
            } else if (state == State.WANDER && world.isSolidForCollision(aheadX, feet, aheadZ)) {
                yaw += 1.5f + rng.nextFloat()
            }
        }

        collideMove(world, vx * dt, vy * dt, vz * dt)
        return if (groanTimer <= 0f) { groanTimer = 9f + rng.nextFloat() * 16f; -1f } else 0f
    }

    fun hurt(amount: Float): Boolean {
        if (state == State.DEAD) return false
        health -= amount
        if (state == State.WANDER) state = State.CHASE
        if (health <= 0f) { state = State.DEAD; return true }
        return false
    }

    private fun collideMove(world: World, mx: Double, my: Double, mz: Double) {
        if (my != 0.0) {
            if (!free(world, x, y + my, z)) {
                if (my < 0) { y = Math.floor(y + my) + 1.0; onGround = true } else y = Math.ceil(y + my + HEIGHT) - HEIGHT - 0.001
                vy = 0.0
            } else { y += my; onGround = false }
        }
        if (mx != 0.0) { if (free(world, x + mx, y, z)) x += mx else vx = 0.0 }
        if (mz != 0.0) { if (free(world, x, y, z + mz)) z += mz else vz = 0.0 }
        if (y < -8.0) { y = world.surfaceY(x.toInt(), z.toInt()).toDouble(); vy = 0.0 }
    }

    private fun free(world: World, px: Double, py: Double, pz: Double): Boolean {
        val x0 = Math.floor(px - HALF_W).toInt(); val x1 = Math.floor(px + HALF_W).toInt()
        val y0 = Math.floor(py).toInt(); val y1 = Math.floor(py + HEIGHT - 0.02).toInt()
        val z0 = Math.floor(pz - HALF_W).toInt(); val z1 = Math.floor(pz + HALF_W).toInt()
        for (bx in x0..x1) for (by in y0..y1) for (bz in z0..z1)
            if (world.isSolidForCollision(bx, by, bz)) return false
        return true
    }
}
