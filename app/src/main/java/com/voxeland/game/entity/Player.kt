package com.voxeland.game.entity

import com.voxeland.game.core.World
import com.voxeland.game.items.Inventory
import com.voxeland.game.items.ItemDef
import com.voxeland.game.items.Items
import com.voxeland.game.progression.Character
import com.voxeland.game.progression.Skills
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

class Player(var character: Character) {
    // position is feet-center
    var x = 0.0; var y = 30.0; var z = 0.0
    var vx = 0.0; var vy = 0.0; var vz = 0.0
    var yaw = 0f          // radians, 0 = -Z (north)
    var pitch = 0f
    var onGround = false
    var crouching = false
    var sprinting = false

    // vitals
    var health = 100f
    var hunger = 100f
    var thirst = 100f
    var stamina = 100f
    var infection = 0f

    // progression
    var xp = 0
    var level = 1
    var skillPoints = 0
    val skills = HashSet<String>()
    val inventory = Inventory(rows = 2)

    var timeSurvived = 0f
    var kills = 0
    var damageFlash = 0f       // HUD red vignette timer
    var swingAnim = 0f

    val maxHealth: Float get() = 100f + character.maxHealthBonus + (if ("toughness" in skills) 20f else 0f)
    val eyeHeight: Double get() = if (crouching) 1.30 else 1.62

    companion object {
        const val HALF_W = 0.32
        const val HEIGHT = 1.8
        const val GRAVITY = 22.0
        const val JUMP_V = 7.6
    }

    fun has(skill: String) = skill in skills

    fun heldItem(): ItemDef = inventory.held()?.item ?: Items.FISTS

    fun walkSpeed(): Double {
        var s = 4.1
        if (sprinting && stamina > 1f) s = 6.6
        if (crouching) s = 1.9
        s *= character.speedMul
        if (has("adrenaline") && health < 30f) s *= 1.15
        return s
    }

    fun addXp(amount: Int): Boolean {
        xp += amount
        val newLevel = Skills.levelForXp(xp)
        if (newLevel > level) {
            skillPoints += newLevel - level
            level = newLevel
            return true
        }
        return false
    }

    fun unlock(skillId: String): Boolean {
        val s = Skills.byId(skillId) ?: return false
        if (skillId in skills || skillPoints < s.cost) return false
        if (s.prereq != null && s.prereq !in skills) return false
        skillPoints -= s.cost
        skills.add(skillId)
        if (skillId.startsWith("pockets")) inventory.rows = min(6, inventory.rows + 1)
        return true
    }

    /** survival drains; returns cause of death string when vitals kill the player */
    fun updateVitals(dt: Float): String? {
        timeSurvived += dt
        // full hunger bar lasts ~1.6 in-game days, thirst ~1.0 day (48-min days)
        val exertion = if (sprinting) 2.2f else if (crouching) 0.8f else 1f
        hunger = max(0f, hunger - dt * (100f / 4600f) * exertion)
        thirst = max(0f, thirst - dt * (100f / 2900f) * exertion)

        if (sprinting) {
            val drain = if (has("sprinter")) 5.2f else 8f
            stamina = max(0f, stamina - dt * drain)
            if (stamina <= 0f) sprinting = false
        } else {
            val regen = if (stamina < 30f) 6f else 9f
            stamina = min(100f, stamina + dt * regen * (if (hunger > 20f) 1f else 0.4f))
        }

        if (hunger <= 0f) health -= dt * 0.55f
        if (thirst <= 0f) health -= dt * 0.9f

        if (infection > 0f) {
            infection = min(100f, infection + dt * 0.045f)     // untreated bites fester
            if (infection > 50f) health -= dt * (infection - 50f) * 0.010f
        }

        // slow natural mending when fed and watered
        if (health < maxHealth && hunger > 55f && thirst > 45f && infection < 40f)
            health = min(maxHealth, health + dt * 0.35f)

        damageFlash = max(0f, damageFlash - dt * 2f)
        swingAnim = max(0f, swingAnim - dt * 4f)

        if (health <= 0f) {
            return when {
                infection >= 50f -> "The infection won."
                thirst <= 0f -> "Died of dehydration."
                hunger <= 0f -> "Starved in the ruins."
                else -> "Torn apart."
            }
        }
        return null
    }

    fun hurt(amount: Float, infectChance: Float, rng: Float) {
        health -= amount
        damageFlash = 1f
        if (rng < infectChance && infection < 1f) infection = 1f
    }

    fun consume(item: ItemDef): Boolean {
        if (item.food <= 0f && item.water <= 0f && item.heal <= 0f && item.infectionCure <= 0f) return false
        var healAmt = item.heal * character.healMul
        if (item.id == "bandage" && has("medic")) healAmt *= 1.5f
        if (healAmt < 0f && has("ironstomach")) healAmt = 0f
        hunger = min(100f, hunger + item.food * character.foodMul)
        thirst = min(100f, thirst + item.water)
        health = (health + healAmt).coerceIn(1f, maxHealth)
        infection = max(0f, infection - item.infectionCure)
        return true
    }

    // ------------------------------------------------------------ physics

    fun move(world: World, dt: Float, inX: Float, inZ: Float, wantJump: Boolean) {
        val speed = walkSpeed()
        val sinY = sin(yaw).toDouble(); val cosY = cos(yaw).toDouble()
        // input is (strafe, forward); look = (sin yaw, -cos yaw), right = (cos yaw, sin yaw)
        val dx = (inX * cosY + inZ * sinY) * speed
        val dz = (inX * sinY - inZ * cosY) * speed

        val accel = if (onGround) 14.0 else 4.0
        vx += (dx - vx) * min(1.0, accel * dt)
        vz += (dz - vz) * min(1.0, accel * dt)

        vy -= GRAVITY * dt
        if (wantJump && onGround && stamina > 3f) {
            vy = JUMP_V
            stamina = max(0f, stamina - 2.5f)
            onGround = false
        }
        if (vy < -40.0) vy = -40.0

        val oldVy = vy
        collideMove(world, vx * dt, vy * dt, vz * dt)
        // fall damage — realism has teeth
        if (onGround && oldVy < -11.0) {
            val f = (-oldVy - 11.0).toFloat()
            hurt(f * f * 0.55f, 0f, 1f)
        }
    }

    private fun collideMove(world: World, mx: Double, my: Double, mz: Double) {
        // axis-separated AABB sweep
        var dx = mx; var dy = my; var dz = mz
        val h = if (crouching) 1.5 else HEIGHT

        // Y axis
        if (dy != 0.0) {
            if (!aabbFree(world, x, y + dy, z, h)) {
                if (dy < 0) { y = Math.floor(y + dy) + 1.0; onGround = true } else {
                    y = Math.ceil(y + dy + h) - h - 0.001
                }
                vy = 0.0
            } else { y += dy; onGround = false }
        }
        // X axis
        if (dx != 0.0) {
            if (!aabbFree(world, x + dx, y, z, h)) { vx = 0.0 } else x += dx
        }
        // Z axis
        if (dz != 0.0) {
            if (!aabbFree(world, x, y, z + dz, h)) { vz = 0.0 } else z += dz
        }
        // safety: never fall through the world
        if (y < -8.0) { y = world.surfaceY(x.toInt(), z.toInt()).toDouble(); vy = 0.0 }
    }

    private fun aabbFree(world: World, px: Double, py: Double, pz: Double, h: Double): Boolean {
        val x0 = Math.floor(px - HALF_W).toInt(); val x1 = Math.floor(px + HALF_W).toInt()
        val y0 = Math.floor(py).toInt(); val y1 = Math.floor(py + h - 0.02).toInt()
        val z0 = Math.floor(pz - HALF_W).toInt(); val z1 = Math.floor(pz + HALF_W).toInt()
        for (bx in x0..x1) for (by in y0..y1) for (bz in z0..z1)
            if (world.isSolidForCollision(bx, by, bz)) return false
        return true
    }
}
