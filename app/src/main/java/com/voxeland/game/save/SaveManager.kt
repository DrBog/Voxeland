package com.voxeland.game.save

import android.content.Context
import com.voxeland.game.core.Environment
import com.voxeland.game.core.World
import com.voxeland.game.entity.Player
import com.voxeland.game.items.Items
import com.voxeland.game.items.Stack
import com.voxeland.game.progression.Character
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

object SaveManager {
    private const val FILE = "voxeland_save.json"

    fun exists(ctx: Context): Boolean = File(ctx.filesDir, FILE).exists()
    fun delete(ctx: Context) { File(ctx.filesDir, FILE).delete() }

    fun save(ctx: Context, world: World, player: Player, env: Environment) {
        val o = JSONObject()
        o.put("version", 1)
        o.put("seed", world.seed)
        o.put("time", env.time.toDouble())
        o.put("day", env.dayCount)

        val c = player.character
        o.put("char", JSONObject().apply {
            put("name", c.name); put("body", c.body); put("skin", c.skinTone)
            put("hair", c.hair); put("bg", c.background)
        })

        o.put("player", JSONObject().apply {
            put("x", player.x); put("y", player.y); put("z", player.z)
            put("yaw", player.yaw.toDouble()); put("pitch", player.pitch.toDouble())
            put("health", player.health.toDouble()); put("hunger", player.hunger.toDouble())
            put("thirst", player.thirst.toDouble()); put("stamina", player.stamina.toDouble())
            put("infection", player.infection.toDouble())
            put("xp", player.xp); put("level", player.level); put("points", player.skillPoints)
            put("kills", player.kills); put("survived", player.timeSurvived.toDouble())
            put("rows", player.inventory.rows); put("selected", player.inventory.selected)
            put("battery", player.battery.toDouble()); put("flashOn", player.flashlightOn)
            put("skills", JSONArray(player.skills.toList()))
            val inv = JSONArray()
            for (i in player.inventory.slots.indices) {
                val s = player.inventory.slots[i] ?: continue
                inv.put(JSONObject().apply { put("slot", i); put("id", s.item.id); put("n", s.count) })
            }
            put("inv", inv)
        })

        val edits = JSONObject()
        for ((k, v) in world.edits) edits.put(k.toString(), v.toInt())
        o.put("edits", edits)
        o.put("looted", JSONArray(world.looted.map { it.toString() }))

        File(ctx.filesDir, FILE).writeText(o.toString())
    }

    class Loaded(val world: World, val player: Player, val env: Environment)

    fun load(ctx: Context): Loaded? {
        val f = File(ctx.filesDir, FILE)
        if (!f.exists()) return null
        return try {
            val o = JSONObject(f.readText())
            val world = World(o.getLong("seed"))
            val env = Environment()
            env.time = o.getDouble("time").toFloat()
            env.dayCount = o.getInt("day")

            val cj = o.getJSONObject("char")
            val character = Character(
                cj.getString("name"), cj.getInt("body"), cj.getInt("skin"),
                cj.getInt("hair"), cj.getInt("bg")
            )
            val player = Player(character)
            val p = o.getJSONObject("player")
            player.x = p.getDouble("x"); player.y = p.getDouble("y"); player.z = p.getDouble("z")
            player.yaw = p.getDouble("yaw").toFloat(); player.pitch = p.getDouble("pitch").toFloat()
            player.health = p.getDouble("health").toFloat(); player.hunger = p.getDouble("hunger").toFloat()
            player.thirst = p.getDouble("thirst").toFloat(); player.stamina = p.getDouble("stamina").toFloat()
            player.infection = p.getDouble("infection").toFloat()
            player.xp = p.getInt("xp"); player.level = p.getInt("level"); player.skillPoints = p.getInt("points")
            player.kills = p.getInt("kills"); player.timeSurvived = p.getDouble("survived").toFloat()
            player.inventory.rows = p.getInt("rows"); player.inventory.selected = p.getInt("selected")
            player.battery = p.optDouble("battery", 0.0).toFloat()
            player.flashlightOn = p.optBoolean("flashOn", false)
            val sk = p.getJSONArray("skills")
            for (i in 0 until sk.length()) player.skills.add(sk.getString(i))
            val inv = p.getJSONArray("inv")
            for (i in 0 until inv.length()) {
                val e = inv.getJSONObject(i)
                val item = Items.byId(e.getString("id")) ?: continue
                player.inventory.slots[e.getInt("slot")] = Stack(item, e.getInt("n"))
            }

            val edits = o.getJSONObject("edits")
            for (k in edits.keys()) world.edits[k.toLong()] = edits.getInt(k).toByte()
            world.rebuildEditTops()
            val looted = o.getJSONArray("looted")
            for (i in 0 until looted.length()) world.looted.add(looted.getString(i).toLong())

            Loaded(world, player, env)
        } catch (e: Exception) {
            null
        }
    }
}
