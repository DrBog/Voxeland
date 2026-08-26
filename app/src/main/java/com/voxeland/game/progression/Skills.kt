package com.voxeland.game.progression

import kotlin.math.pow

enum class SkillTree(val title: String) { SURVIVAL("Survival"), CAPACITY("Scavenging"), ENDURANCE("Endurance") }

data class Skill(
    val id: String,
    val name: String,
    val desc: String,
    val tree: SkillTree,
    val cost: Int,
    val prereq: String? = null,
)

object Skills {
    val all: List<Skill> = listOf(
        // Survival — the fundamentals of staying alive
        Skill("navigator", "Navigator", "Learn to craft a Compass. The HUD gains a bearing ribbon.", SkillTree.SURVIVAL, 1),
        Skill("purify", "Purifier", "Craft clean water from murky water and chemicals.", SkillTree.SURVIVAL, 1),
        Skill("medic", "Field Medic", "Craft first-aid kits. Bandages heal +50%.", SkillTree.SURVIVAL, 2, prereq = "purify"),
        Skill("ironstomach", "Iron Stomach", "Questionable food and water no longer hurt you.", SkillTree.SURVIVAL, 2, prereq = "purify"),

        // Scavenging — carry more, find more, make more
        Skill("pockets1", "Deep Pockets I", "+1 backpack row.", SkillTree.CAPACITY, 1),
        Skill("pockets2", "Deep Pockets II", "+1 backpack row.", SkillTree.CAPACITY, 2, prereq = "pockets1"),
        Skill("pockets3", "Deep Pockets III", "+1 backpack row.", SkillTree.CAPACITY, 3, prereq = "pockets2"),
        Skill("pockets4", "Pack Mule", "+1 backpack row.", SkillTree.CAPACITY, 4, prereq = "pockets3"),
        Skill("scavenger", "Scavenger", "Containers yield an extra find.", SkillTree.CAPACITY, 2),
        Skill("mason", "Mason", "Craft bricks for serious barricading.", SkillTree.CAPACITY, 2, prereq = "scavenger"),
        Skill("quickhands", "Quick Hands", "Craft twice as fast.", SkillTree.CAPACITY, 1),

        // Endurance — the body keeps the score
        Skill("sprinter", "Sprinter", "Stamina drains 35% slower while sprinting.", SkillTree.ENDURANCE, 1),
        Skill("toughness", "Toughness", "+20 max health.", SkillTree.ENDURANCE, 2),
        Skill("silentsteps", "Silent Steps", "Zombies notice you from 35% closer only.", SkillTree.ENDURANCE, 2, prereq = "sprinter"),
        Skill("adrenaline", "Adrenaline", "Below 30 health you move 15% faster.", SkillTree.ENDURANCE, 3, prereq = "toughness"),
    )

    fun byId(id: String) = all.find { it.id == id }

    /** total XP required to reach a level (level 1 = 0 XP) */
    fun xpForLevel(level: Int): Int = if (level <= 1) 0 else (80.0 * (level - 1).toDouble().pow(1.35)).toInt()

    fun levelForXp(xp: Int): Int {
        var l = 1
        while (xpForLevel(l + 1) <= xp) l++
        return l
    }
}

/** Character created at the start of every fresh save. */
data class Character(
    val name: String,
    val body: Int,          // 0 lean, 1 average, 2 heavy
    val skinTone: Int,      // 0..3, cosmetic
    val hair: Int,          // 0..3, cosmetic
    val background: Int,    // 0 mechanic, 1 paramedic, 2 scout, 3 cook
) {
    companion object {
        val BODIES = listOf("Lean", "Average", "Heavy")
        val BODY_DESC = listOf("+8% speed, -10 max health", "No modifiers", "+15 max health, -6% speed")
        val TONES = listOf("Pale", "Tan", "Brown", "Deep")
        val HAIR = listOf("Buzzed", "Short", "Long", "Hood")
        val BACKGROUNDS = listOf("Mechanic", "Paramedic", "Scout", "Cook")
        val BACKGROUND_DESC = listOf(
            "Breaks blocks 30% faster. Starts with a hammer.",
            "Healing items 25% stronger. Starts with bandages.",
            "Sees zombies on the edge of dark. Starts with a knife.",
            "Food restores 25% more. Starts with canned soup.",
        )
    }
    val speedMul: Float get() = (if (body == 0) 1.08f else if (body == 2) 0.94f else 1f) * (if (background == 2) 1.03f else 1f)
    val maxHealthBonus: Float get() = if (body == 0) -10f else if (body == 2) 15f else 0f
    val mineMul: Float get() = if (background == 0) 1.3f else 1f
    val healMul: Float get() = if (background == 1) 1.25f else 1f
    val foodMul: Float get() = if (background == 3) 1.25f else 1f
}
