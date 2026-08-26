package com.voxeland.game

import com.voxeland.game.audio.SoundManager
import com.voxeland.game.core.Blocks
import com.voxeland.game.core.Environment
import com.voxeland.game.core.EyeAdaptation
import com.voxeland.game.core.SplitMix
import com.voxeland.game.core.World
import com.voxeland.game.entity.Player
import com.voxeland.game.entity.Zombie
import com.voxeland.game.gen.BuildingFunction
import com.voxeland.game.gen.CityPlan
import com.voxeland.game.gl.Raycast
import com.voxeland.game.items.ItemKind
import com.voxeland.game.items.Items
import com.voxeland.game.items.Loot
import com.voxeland.game.items.Recipe
import com.voxeland.game.items.Stack
import com.voxeland.game.progression.Character
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Simulation core. update() runs on the GL thread; UI thread talks to it
 * through [post] and reads state for the HUD (tolerating slight tearing).
 */
class GameEngine(
    val world: World,
    val player: Player,
    val env: Environment,
    val sound: SoundManager,
) {
    interface Listener {
        fun onDeath(cause: String)
        fun onLevelUp(level: Int)
        fun onLootFound(items: List<Stack>, overflow: Boolean)
        fun onToast(msg: String)
    }
    @Volatile var listener: Listener? = null
    @Volatile var paused = false
    @Volatile var dead = false
    @Volatile var targetHint = false

    // --- input state written by touch controls
    @Volatile var moveX = 0f
    @Volatile var moveZ = 0f
    @Volatile var wantJump = false
    @Volatile var attackHeld = false

    /** pupil/rod adaptation driving scene exposure */
    val eye = EyeAdaptation()
    /** true while the player is under a roof — drives ambience and dust */
    @Volatile var indoors = false

    val zombies = CopyOnWriteArrayList<Zombie>()
    private val tasks = ConcurrentLinkedQueue<Runnable>()
    private val rng = SplitMix(System.nanoTime())

    // mining state
    var mineX = Int.MIN_VALUE; var mineY = 0; var mineZ = 0
    var mineProgress = 0f      // 0..1 fraction, HUD renders the crack ring
    private var swingCooldown = 0f
    private var stepTimer = 0f
    private var heartbeatTimer = 0f
    private var autosaveTimer = 0f
    private var lastDay = env.dayCount
    @Volatile var saveRequested = false

    fun post(r: Runnable) { tasks.add(r) }

    fun update(dt0: Float) {
        val dt = dt0.coerceAtMost(0.1f)
        while (true) { val t = tasks.poll() ?: break; t.run() }
        if (paused || dead) return

        env.advance(dt)
        if (env.dayCount != lastDay) {
            lastDay = env.dayCount
            player.addXp(100).also { if (it) listener?.onLevelUp(player.level) }
            listener?.onToast("Day ${env.dayCount + 1}. +100 XP for surviving the night.")
        }

        // movement
        player.move(world, dt, moveX, moveZ, wantJump)
        wantJump = false

        // vitals
        player.updateVitals(dt)?.let { cause ->
            if (!dead) {
                dead = true
                sound.play("player_die")
                listener?.onDeath(cause)
            }
            return
        }

        // combat / mining
        swingCooldown -= dt
        if (attackHeld) doAttack(dt) else { mineProgress = 0f; mineX = Int.MIN_VALUE }

        updateLightState(dt)
        updateZombies(dt)
        updateSpawns(dt)
        updateAudio(dt)

        autosaveTimer += dt
        if (autosaveTimer > 60f) { autosaveTimer = 0f; saveRequested = true }
    }

    /**
     * How bright the world is where the player is standing, and how far the
     * eye has caught up to it. Sampling the propagated light means stepping
     * through a doorway genuinely changes what the eye is tuned to.
     */
    private fun updateLightState(dt: Float) {
        val bx = Math.floor(player.x).toInt()
        val by = Math.floor(player.y + player.eyeHeight).toInt()
        val bz = Math.floor(player.z).toInt()
        val sky = world.skyLight(bx, by, bz)
        indoors = sky < 0.55f && isIndoors()

        if (player.flashlightOn) {
            player.battery = max(0f, player.battery - dt * (100f / 420f))   // ~7 min per set
            if (player.battery <= 0f) {
                player.flashlightOn = false
                listener?.onToast("The flashlight dies.")
            }
        }

        var target = sky * env.daylight
        if (player.flashlightOn) target += 0.34f
        eye.update(target, dt)
    }

    fun toggleFlashlight() {
        if (!player.hasFlashlight()) { listener?.onToast("You have no light."); return }
        if (!player.flashlightOn && player.battery <= 0.5f) {
            if (player.inventory.remove(Items.BATTERY, 1)) {
                player.battery = 100f
                listener?.onToast("Fresh batteries.")
            } else {
                listener?.onToast("The batteries are dead.")
                return
            }
        }
        player.flashlightOn = !player.flashlightOn
        sound.play("ui_click", 0.7f)
    }

    // ------------------------------------------------------------ combat

    private fun lookVec(): DoubleArray {
        val cp = cos(player.pitch).toDouble()
        return doubleArrayOf(
            sin(player.yaw).toDouble() * cp,
            -sin(player.pitch).toDouble(),
            -cos(player.yaw).toDouble() * cp
        )
    }

    private fun doAttack(dt: Float) {
        val item = player.heldItem()
        val eyeY = player.y + player.eyeHeight
        val look = lookVec()

        // melee entities first
        if (swingCooldown <= 0f) {
            var best: Zombie? = null; var bestD = 2.9
            for (zb in zombies) {
                if (zb.state == Zombie.State.DEAD) continue
                val dx = zb.x - player.x; val dy = (zb.y + 0.9) - eyeY; val dz = zb.z - player.z
                val d = sqrt(dx * dx + dy * dy + dz * dz)
                if (d < bestD) {
                    val dot = (dx * look[0] + dy * look[1] + dz * look[2]) / (d + 0.001)
                    if (dot > 0.55) { best = zb; bestD = d }
                }
            }
            if (best != null) {
                swingCooldown = 1f / item.swingSpeed
                player.swingAnim = 1f
                sound.play("hit_flesh", 0.9f, 0.9f + rng.nextFloat() * 0.2f)
                if (best.hurt(item.damage)) {
                    player.kills++
                    sound.play("zombie_die", 0.9f)
                    if (player.addXp(25)) listener?.onLevelUp(player.level)
                    // the dead sometimes carry scraps
                    if (rng.nextFloat() < 0.25f) {
                        player.inventory.add(Items.CLOTH, 1)
                        listener?.onToast("Found cloth on the corpse.")
                    }
                }
                return
            }
        }

        // then blocks
        val hit = Raycast.cast(world, player.x, eyeY, player.z, look[0], look[1], look[2], 4.0) ?: run {
            mineProgress = 0f; mineX = Int.MIN_VALUE; return
        }
        if (hit.x != mineX || hit.y != mineY || hit.z != mineZ) {
            mineX = hit.x; mineY = hit.y; mineZ = hit.z; mineProgress = 0f
        }
        val hard = Blocks.hardness(hit.block)
        if (hard <= 0f) return
        val speed = item.mineSpeed * player.character.mineMul
        mineProgress += dt * speed / hard
        if (swingCooldown <= 0f) {
            swingCooldown = 0.33f
            player.swingAnim = 1f
            sound.play("hit_block", 0.5f, 0.9f + rng.nextFloat() * 0.25f)
        }
        if (mineProgress >= 1f) {
            mineProgress = 0f
            breakBlock(hit.x, hit.y, hit.z, hit.block)
        }
    }

    private fun breakBlock(x: Int, y: Int, z: Int, b: Byte) {
        world.setBlock(x, y, z, Blocks.AIR)
        sound.play("block_break", 0.9f)
        val drops: List<Pair<com.voxeland.game.items.ItemDef, Int>> = when (b) {
            Blocks.PLANK, Blocks.WOOD_FRAME, Blocks.BARRICADE, Blocks.DOOR_FRAME -> listOf(Items.WOOD to 1 + rng.nextInt(2))
            Blocks.LOG_DEAD -> listOf(Items.WOOD to 2)
            Blocks.BRICK_RED, Blocks.BRICK_GRAY -> listOf(Items.BRICK to 1)
            Blocks.GLASS, Blocks.GLASS_DARK -> listOf(Items.GLASS_SHARD to 1)
            Blocks.WINDOW_BOARDED -> listOf(Items.WOOD to 1, Items.NAILS to 2)
            Blocks.METAL_PANEL, Blocks.METAL_RUST, Blocks.FENCE -> listOf(Items.SCRAP to 1)
            Blocks.SHELF, Blocks.COUNTER, Blocks.CONTAINER -> listOf(Items.WOOD to 2, Items.NAILS to 1)
            Blocks.RUBBLE -> if (rng.nextFloat() < 0.4f) listOf(Items.SCRAP to 1) else listOf(Items.BRICK to 1)
            else -> emptyList()
        }
        var gained = false
        for ((it, n) in drops) if (player.inventory.add(it, n) < n) gained = true else gained = true
        if (gained && drops.isNotEmpty()) sound.play("pickup", 0.5f)
        if (player.addXp(2)) listener?.onLevelUp(player.level)
    }

    /** Place the held block against the face under the crosshair. */
    fun tryPlace() {
        val item = player.heldItem()
        if (item.placesBlock == Blocks.AIR) { listener?.onToast("Nothing placeable in hand."); return }
        val eyeY = player.y + player.eyeHeight
        val look = lookVec()
        val hit = Raycast.cast(world, player.x, eyeY, player.z, look[0], look[1], look[2], 4.0) ?: return
        val px = hit.x + hit.faceX; val py = hit.y + hit.faceY; val pz = hit.z + hit.faceZ
        if (world.block(px, py, pz) != Blocks.AIR) return
        // don't entomb yourself
        val inPlayer = px == Math.floor(player.x).toInt() && pz == Math.floor(player.z).toInt() &&
                py >= Math.floor(player.y).toInt() && py <= Math.floor(player.y + 1.8).toInt()
        if (inPlayer) return
        if (player.inventory.consumeHeldOne()) {
            world.setBlock(px, py, pz, item.placesBlock)
            sound.play("block_place", 0.8f)
        }
    }

    /** What the crosshair is pointing at — drives the HUD prompt. */
    fun targetPrompt(): String? {
        val eyeY = player.y + player.eyeHeight
        val look = lookVec()
        for (zb in zombies) {
            if (zb.state == Zombie.State.DEAD) continue
            val dx = zb.x - player.x; val dz = zb.z - player.z
            val d = sqrt(dx * dx + dz * dz)
            if (d < 3.0) return "Zombie — attack!"
        }
        val hit = Raycast.cast(world, player.x, eyeY, player.z, look[0], look[1], look[2], 3.6) ?: return null
        if (Blocks.isLootable(hit.block)) {
            val key = World.posKey(hit.x, hit.y, hit.z)
            return if (key in world.looted) "${Blocks.name(hit.block)} (empty)" else "Search ${Blocks.name(hit.block)}"
        }
        return null
    }

    /** Interact button: search containers. */
    fun interact() {
        val eyeY = player.y + player.eyeHeight
        val look = lookVec()
        val hit = Raycast.cast(world, player.x, eyeY, player.z, look[0], look[1], look[2], 3.6) ?: return
        if (!Blocks.isLootable(hit.block)) return
        val key = World.posKey(hit.x, hit.y, hit.z)
        if (key in world.looted) { listener?.onToast("Already picked clean."); return }
        world.looted.add(key)
        sound.play("container_open")
        val fn = world.plan.lotAt(hit.x, hit.z)?.variant?.function ?: BuildingFunction.RESIDENTIAL
        val bonus = if (player.has("scavenger")) 1 else 0
        val loot = Loot.roll(world.seed, hit.x, hit.y, hit.z, fn, bonus)
        var overflow = false
        for (s in loot) if (player.inventory.add(s.item, s.count) > 0) overflow = true
        sound.play("pickup", 0.7f)
        if (player.addXp(8)) listener?.onLevelUp(player.level)
        listener?.onLootFound(loot, overflow)
    }

    /** Use/consume the held item (eat, drink, heal). */
    fun useHeld() {
        val s = player.inventory.held() ?: return
        val item = s.item
        when (item.kind) {
            ItemKind.FOOD -> { if (player.consume(item)) { player.inventory.consumeHeldOne(); sound.play("eat") } }
            ItemKind.DRINK -> { if (player.consume(item)) { player.inventory.consumeHeldOne(); sound.play("drink") } }
            ItemKind.MEDICAL -> {
                if (player.consume(item)) {
                    player.inventory.consumeHeldOne()
                    sound.play(if (item.id == "bandage" || item.id == "medkit") "bandage" else "eat")
                }
            }
            ItemKind.BLOCK -> tryPlace()
            else -> listener?.onToast(item.desc.ifEmpty { item.name })
        }
    }

    fun craft(recipe: Recipe): Boolean {
        if (recipe.requiredSkill != null && !player.has(recipe.requiredSkill)) return false
        for ((item, n) in recipe.inputs) if (player.inventory.count(item) < n) return false
        for ((item, n) in recipe.inputs) player.inventory.remove(item, n)
        val left = player.inventory.add(recipe.output, recipe.outCount)
        if (left > 0) listener?.onToast("Inventory full — some output was lost.")
        sound.play("craft")
        if (player.addXp(12)) listener?.onLevelUp(player.level)
        return true
    }

    // ------------------------------------------------------------ zombies

    private fun updateZombies(dt: Float) {
        val darkness = env.darkness
        val detectMul = if (player.has("silentsteps")) 0.65f else 1f
        var toRemove: MutableList<Zombie>? = null
        for (zb in zombies) {
            val res = zb.update(world, dt, player, darkness, detectMul)
            if (res > 0f) {
                player.hurt(res, 0.30f, rng.nextFloat())
                sound.play("zombie_attack", 0.9f)
                sound.play("player_hurt${1 + rng.nextInt(2)}", 0.8f)
            } else if (res < 0f) {
                val d = zb.distTo(player.x, player.z).toFloat()
                if (d < 26f) sound.play("zombie_groan${1 + rng.nextInt(3)}", (1f - d / 26f).coerceIn(0.05f, 0.9f), 0.85f + rng.nextFloat() * 0.3f)
            }
            if (zb.state == Zombie.State.DEAD && zb.deadTimer > 4f) {
                if (toRemove == null) toRemove = ArrayList()
                toRemove.add(zb)
            }
        }
        toRemove?.let { zombies.removeAll(it.toSet()) }
    }

    private fun updateSpawns(dt: Float) {
        val cap = (10 + env.darkness * 14).toInt()
        // despawn the far ones
        for (zb in zombies) if (zb.distTo(player.x, player.z) > 75.0) zombies.remove(zb)
        if (zombies.size >= cap) return
        if (rng.nextFloat() > dt * (0.35f + env.darkness * 0.6f)) return

        val ang = rng.nextFloat() * 6.283f
        val dist = 28.0 + rng.nextFloat() * 26.0
        val sx = player.x + sin(ang) * dist
        val sz = player.z + cos(ang) * dist
        val bx = Math.floor(sx).toInt(); val bz = Math.floor(sz).toInt()
        val d = sqrt((bx * bx + bz * bz).toDouble())
        if (d > CityPlan.CITY_RADIUS + 40) return       // the wasteland is empty of them
        val sy = world.surfaceY(bx, bz)
        if (sy > 80) return
        // don't drop them onto rooftops — the horde belongs in the streets
        if (sy > CityPlan.GROUND_Y + 4 && world.plan.lotAt(bx, bz) != null) return
        zombies.add(Zombie(sx, sy.toDouble() + 0.1, sz, rng.nextLong()))
    }

    // ------------------------------------------------------------ audio

    private fun updateAudio(dt: Float) {
        // footsteps
        val moving = (moveX * moveX + moveZ * moveZ) > 0.04f && player.onGround
        if (moving) {
            stepTimer -= dt * (if (player.sprinting) 1.6f else if (player.crouching) 0.55f else 1f)
            if (stepTimer <= 0f) {
                stepTimer = 0.42f
                val below = world.block(Math.floor(player.x).toInt(), Math.floor(player.y - 0.4).toInt(), Math.floor(player.z).toInt())
                val soft = Blocks.stepsSoft(below)
                val vol = if (player.crouching) 0.18f else 0.4f
                sound.play(if (soft) "step_dirt${1 + rng.nextInt(2)}" else "step_concrete${1 + rng.nextInt(2)}", vol, 0.9f + rng.nextFloat() * 0.2f)
            }
        } else stepTimer = 0.1f

        // heartbeat under threat
        val lowHealth = player.health < 30f
        val chased = zombies.any { it.state == Zombie.State.CHASE || it.state == Zombie.State.ATTACK }
        if (lowHealth || (chased && player.health < 60f)) {
            heartbeatTimer -= dt
            if (heartbeatTimer <= 0f) {
                heartbeatTimer = if (lowHealth) 0.8f else 1.1f
                sound.play("heartbeat", if (lowHealth) 0.9f else 0.5f)
            }
        }

        // ambient cross-mix from the environment
        val indoors = this.indoors
        val wind = env.windLevel * (if (indoors) 0.15f else 1f)
        val city = (0.35f + 0.3f * env.daylight) * (if (indoors) 0.3f else 1f)
        val night = env.darkness * (if (indoors) 0.4f else 0.9f)
        val interior = if (indoors) 0.8f else 0f
        sound.mixAmbient(wind * 0.8f, city * 0.6f, night * 0.7f, interior)
    }

    fun isIndoors(): Boolean {
        val bx = Math.floor(player.x).toInt(); val bz = Math.floor(player.z).toInt()
        val by = Math.floor(player.y + 1.7).toInt()
        for (y in by..(by + 30).coerceAtMost(95)) {
            val b = world.block(bx, y, bz)
            if (b != Blocks.AIR && !Blocks.isTransparent(b)) return true
        }
        return false
    }

    companion object {
        /** starting kit reflects the chosen background */
        fun newGame(seed: Long, character: Character): Pair<World, Player> {
            val world = World(seed)
            val player = Player(character)
            // spawn on a suburban street at the city's edge, facing downtown
            val spawnDist = 230.0
            player.x = 3.5; player.z = spawnDist
            player.y = (CityPlan.GROUND_Y + 1).toDouble()
            player.yaw = 0f                  // yaw 0 looks along -Z, toward downtown
            val inv = player.inventory
            inv.add(Items.WATER, 1)
            inv.add(Items.BEANS, 1)
            when (character.background) {
                0 -> inv.add(Items.HAMMER, 1)
                1 -> inv.add(Items.BANDAGE, 3)
                2 -> inv.add(Items.KNIFE, 1)
                3 -> { inv.add(Items.CANNED_SOUP, 2) }
            }
            return world to player
        }
    }
}
