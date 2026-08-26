package com.voxeland.game.items

import com.voxeland.game.core.Blocks

enum class ItemKind { MATERIAL, FOOD, DRINK, MEDICAL, WEAPON, TOOL, BLOCK, SPECIAL }

/**
 * Item registry. `id` strings are stable — they are written into save files.
 */
data class ItemDef(
    val id: String,
    val name: String,
    val kind: ItemKind,
    val stack: Int = 20,
    val damage: Float = 0f,          // melee damage when held
    val swingSpeed: Float = 1f,      // attacks per second multiplier
    val mineSpeed: Float = 1f,       // block-breaking multiplier
    val food: Float = 0f,            // hunger restored
    val water: Float = 0f,           // thirst restored
    val heal: Float = 0f,            // health restored
    val infectionCure: Float = 0f,   // infection reduced
    val placesBlock: Byte = Blocks.AIR,
    val desc: String = "",
)

object Items {
    private val map = LinkedHashMap<String, ItemDef>()
    private fun reg(d: ItemDef): ItemDef { map[d.id] = d; return d }

    // materials
    val WOOD = reg(ItemDef("wood", "Wood Scrap", ItemKind.MATERIAL, desc = "Splintered lumber pulled from the ruins."))
    val PLANK = reg(ItemDef("plank", "Plank", ItemKind.BLOCK, placesBlock = Blocks.PLANK, desc = "Placeable. The wall between you and them."))
    val SCRAP = reg(ItemDef("scrap", "Scrap Metal", ItemKind.MATERIAL, desc = "Rusted but useful."))
    val NAILS = reg(ItemDef("nails", "Nails", ItemKind.MATERIAL, stack = 50, desc = "Hold the world together."))
    val CLOTH = reg(ItemDef("cloth", "Cloth", ItemKind.MATERIAL, desc = "Torn curtains, old shirts."))
    val TAPE = reg(ItemDef("tape", "Duct Tape", ItemKind.MATERIAL, stack = 10, desc = "Fixes everything, briefly."))
    val BRICK = reg(ItemDef("brick", "Brick", ItemKind.BLOCK, placesBlock = Blocks.BRICK_GRAY, desc = "Placeable masonry."))
    val BARRICADE = reg(ItemDef("barricade", "Barricade", ItemKind.BLOCK, stack = 10, placesBlock = Blocks.BARRICADE, desc = "Placeable. Nailed planks, fast to throw up."))
    val GLASS_SHARD = reg(ItemDef("shard", "Glass Shard", ItemKind.MATERIAL, desc = "Careful with the edges."))
    val CHEMICALS = reg(ItemDef("chem", "Chemicals", ItemKind.MATERIAL, stack = 10, desc = "Bleach, solvents, unlabeled bottles."))

    // food & drink
    val BEANS = reg(ItemDef("beans", "Canned Beans", ItemKind.FOOD, stack = 10, food = 38f, desc = "Dented can, still sealed."))
    val CHIPS = reg(ItemDef("chips", "Stale Chips", ItemKind.FOOD, stack = 10, food = 16f, desc = "Salt and regret."))
    val JERKY = reg(ItemDef("jerky", "Jerky", ItemKind.FOOD, stack = 10, food = 26f, desc = "Chewy. Don't ask what animal."))
    val CANNED_SOUP = reg(ItemDef("soup", "Canned Soup", ItemKind.FOOD, stack = 10, food = 30f, water = 10f, desc = "Cold, but it counts."))
    val WATER = reg(ItemDef("water", "Water Bottle", ItemKind.DRINK, stack = 10, water = 45f, desc = "Clear. Probably fine."))
    val SODA = reg(ItemDef("soda", "Flat Soda", ItemKind.DRINK, stack = 10, water = 25f, food = 6f, desc = "Warm and flat."))
    val MURKY_WATER = reg(ItemDef("murky", "Murky Water", ItemKind.DRINK, stack = 10, water = 30f, heal = -5f, desc = "Drink at your own risk."))

    // medical
    val BANDAGE = reg(ItemDef("bandage", "Bandage", ItemKind.MEDICAL, stack = 10, heal = 25f, desc = "Stops the bleeding."))
    val MEDKIT = reg(ItemDef("medkit", "First-Aid Kit", ItemKind.MEDICAL, stack = 3, heal = 65f, infectionCure = 20f, desc = "Real supplies, rare as mercy."))
    val ANTIBIOTICS = reg(ItemDef("antibio", "Antibiotics", ItemKind.MEDICAL, stack = 5, infectionCure = 60f, desc = "The only answer to the bite."))
    val PAINKILLERS = reg(ItemDef("painkill", "Painkillers", ItemKind.MEDICAL, stack = 5, heal = 15f, desc = "Takes the edge off."))

    // weapons & tools
    val FISTS = reg(ItemDef("fists", "Fists", ItemKind.WEAPON, stack = 1, damage = 8f, swingSpeed = 1.4f, mineSpeed = 1f))
    val CLUB = reg(ItemDef("club", "Wooden Club", ItemKind.WEAPON, stack = 1, damage = 16f, swingSpeed = 1.1f, mineSpeed = 1.3f, desc = "A table leg with history."))
    val NAILBAT = reg(ItemDef("nailbat", "Nail Bat", ItemKind.WEAPON, stack = 1, damage = 26f, swingSpeed = 1.0f, mineSpeed = 1.4f, desc = "Crafted cruelty."))
    val PIPE = reg(ItemDef("pipe", "Steel Pipe", ItemKind.WEAPON, stack = 1, damage = 20f, swingSpeed = 1.05f, mineSpeed = 1.6f, desc = "Cold and heavy."))
    val KNIFE = reg(ItemDef("knife", "Kitchen Knife", ItemKind.WEAPON, stack = 1, damage = 18f, swingSpeed = 1.5f, mineSpeed = 0.9f, desc = "Quick and quiet."))
    val FIREAXE = reg(ItemDef("fireaxe", "Fire Axe", ItemKind.WEAPON, stack = 1, damage = 34f, swingSpeed = 0.8f, mineSpeed = 2.6f, desc = "Break in. Break out. Break them."))
    val CROWBAR = reg(ItemDef("crowbar", "Crowbar", ItemKind.TOOL, stack = 1, damage = 15f, swingSpeed = 1.0f, mineSpeed = 2.2f, desc = "Opens doors, crates and skulls."))
    val HAMMER = reg(ItemDef("hammer", "Claw Hammer", ItemKind.TOOL, stack = 1, damage = 13f, swingSpeed = 1.2f, mineSpeed = 1.8f, desc = "Builds barricades faster."))

    // light — the difference between looting a dark room and leaving it
    val FLASHLIGHT = reg(ItemDef("flashlight", "Flashlight", ItemKind.SPECIAL, stack = 1, desc = "A narrow cone of certainty. Eats batteries."))
    val BATTERY = reg(ItemDef("battery", "Batteries", ItemKind.MATERIAL, stack = 8, desc = "Still holds a charge. Probably."))

    // specials (skill-gated utility)
    val COMPASS = reg(ItemDef("compass", "Compass", ItemKind.SPECIAL, stack = 1, desc = "Crafted from a watch and a needle. Unlocks bearings."))
    val WATCH = reg(ItemDef("watch", "Broken Watch", ItemKind.MATERIAL, stack = 5, desc = "Time stopped for its owner."))

    val all: List<ItemDef> get() = map.values.toList()
    fun byId(id: String): ItemDef? = map[id]
}

/** Item stack in a slot. */
data class Stack(val item: ItemDef, var count: Int)
