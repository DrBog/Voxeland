package com.voxeland.game.items

data class Recipe(
    val output: ItemDef,
    val outCount: Int,
    val inputs: List<Pair<ItemDef, Int>>,
    val requiredSkill: String? = null,     // skill id gate, null = always available
    val craftTime: Float = 1.2f,
)

object Recipes {
    val all: List<Recipe> = listOf(
        Recipe(Items.PLANK, 2, listOf(Items.WOOD to 1)),
        Recipe(Items.CLUB, 1, listOf(Items.WOOD to 3, Items.CLOTH to 1)),
        Recipe(Items.BARRICADE, 2, listOf(Items.PLANK to 2, Items.NAILS to 4)),
        Recipe(Items.BANDAGE, 2, listOf(Items.CLOTH to 2)),
        Recipe(Items.NAILBAT, 1, listOf(Items.CLUB to 1, Items.NAILS to 8, Items.TAPE to 1)),
        Recipe(Items.HAMMER, 1, listOf(Items.WOOD to 2, Items.SCRAP to 2, Items.TAPE to 1)),
        Recipe(Items.KNIFE, 1, listOf(Items.GLASS_SHARD to 2, Items.WOOD to 1, Items.CLOTH to 1)),
        Recipe(Items.BRICK, 2, listOf(Items.SCRAP to 1, Items.CHEMICALS to 1), requiredSkill = "mason"),
        Recipe(Items.WATER, 1, listOf(Items.MURKY_WATER to 1, Items.CHEMICALS to 1), requiredSkill = "purify"),
        Recipe(Items.MEDKIT, 1, listOf(Items.BANDAGE to 3, Items.CHEMICALS to 1, Items.TAPE to 1), requiredSkill = "medic"),
        Recipe(Items.COMPASS, 1, listOf(Items.WATCH to 1, Items.SCRAP to 1, Items.GLASS_SHARD to 1), requiredSkill = "navigator"),
        Recipe(Items.PIPE, 1, listOf(Items.SCRAP to 4, Items.TAPE to 1)),
    )
}
