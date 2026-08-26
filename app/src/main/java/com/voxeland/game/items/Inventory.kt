package com.voxeland.game.items

/**
 * Slot-based inventory. 5 hotbar slots + `rows` x 5 backpack slots.
 * Row count grows with the Deep Pockets skill line.
 */
class Inventory(var rows: Int = 2) {
    companion object { const val COLS = 5; const val HOTBAR = 5 }
    val slots = arrayOfNulls<Stack>(HOTBAR + 6 * COLS)   // capacity for max rows (6)
    var selected = 0

    val capacity: Int get() = HOTBAR + rows * COLS

    fun held(): Stack? = slots[selected]

    fun add(item: ItemDef, count: Int): Int {
        var left = count
        // top up existing stacks first
        for (i in 0 until capacity) {
            val s = slots[i] ?: continue
            if (s.item == item && s.count < item.stack) {
                val take = minOf(item.stack - s.count, left)
                s.count += take; left -= take
                if (left == 0) return 0
            }
        }
        for (i in 0 until capacity) {
            if (slots[i] == null) {
                val take = minOf(item.stack, left)
                slots[i] = Stack(item, take); left -= take
                if (left == 0) return 0
            }
        }
        return left      // what didn't fit
    }

    fun count(item: ItemDef): Int {
        var n = 0
        for (i in 0 until capacity) slots[i]?.let { if (it.item == item) n += it.count }
        return n
    }

    fun remove(item: ItemDef, count: Int): Boolean {
        if (this.count(item) < count) return false
        var left = count
        for (i in capacity - 1 downTo 0) {
            val s = slots[i] ?: continue
            if (s.item != item) continue
            val take = minOf(s.count, left)
            s.count -= take; left -= take
            if (s.count == 0) slots[i] = null
            if (left == 0) return true
        }
        return true
    }

    fun consumeHeldOne(): Boolean {
        val s = slots[selected] ?: return false
        s.count--
        if (s.count <= 0) slots[selected] = null
        return true
    }

    fun isFull(): Boolean = (0 until capacity).all { slots[it] != null }
}
