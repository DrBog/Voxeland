package com.voxeland.game

import com.voxeland.game.ui.SlotGrid
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Slot geometry. The previous grid divided the available height by a
 * hardcoded seven rows whatever the real row count was, so a two-row
 * backpack drew squashed cells in the top third of an otherwise empty box.
 */
class SlotGridTest {

    private val densities = listOf(1f, 2f, 2.75f, 3f, 3.5f)

    @Test
    fun cellsAreSquareAndInsideTheBox() {
        for (den in densities) for (rows in 1..7) {
            val w = 340f * den; val h = 230f * den
            val l = SlotGrid.layout(w, h, rows, den)
            for (i in 0 until rows * SlotGrid.COLS) {
                val c = l.rect(i)
                assertEquals("cell not square at den=$den rows=$rows", c.width, c.height, 0.51f)
                assertTrue("cell $i escapes the box at den=$den rows=$rows: " +
                    "[${c.left},${c.top},${c.right},${c.bottom}] box=${w}x$h",
                    c.left >= -0.5f && c.top >= -0.5f && c.right <= w + 0.5f && c.bottom <= h + 0.5f)
            }
        }
    }

    @Test
    fun theGridFillsTheBoxRatherThanACorner() {
        // the specific regression: rows fewer than seven must still fill the height
        val den = 2.75f
        val w = 340f * den; val h = 230f * den
        for (rows in listOf(2, 3, 4)) {
            val l = SlotGrid.layout(w, h, rows, den)
            val used = l.gridHeight / h
            assertTrue("rows=$rows only used ${(used * 100).toInt()}% of the height", used > 0.55f)
            // and cells must not be tiny just because the row count is small
            assertTrue("cells too small at rows=$rows: ${l.cell / den}dp",
                l.cell / den >= SlotGrid.MIN_CELL_DP)
        }
    }

    @Test
    fun cellsNeverOverlap() {
        val den = 2.75f
        val l = SlotGrid.layout(340f * den, 230f * den, 3, den)
        val n = 3 * SlotGrid.COLS
        for (i in 0 until n) for (j in i + 1 until n) {
            val a = l.rect(i); val b = l.rect(j)
            val overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
            assertTrue("slots $i and $j overlap", !overlap)
        }
    }

    @Test
    fun tappingWhereASlotIsDrawnSelectsThatSlot() {
        // draw and hit test must agree — they share rect(), this proves it
        val den = 3f
        for (rows in 1..6) {
            val l = SlotGrid.layout(320f * den, 240f * den, rows, den)
            val capacity = rows * SlotGrid.COLS
            for (i in 0 until capacity) {
                val c = l.rect(i)
                val cx = (c.left + c.right) / 2f
                val cy = (c.top + c.bottom) / 2f
                assertEquals("centre of slot $i did not hit slot $i", i, l.indexAt(cx, cy, capacity))
            }
        }
    }

    @Test
    fun tapsInTheGuttersHitNothing() {
        val den = 2f
        val l = SlotGrid.layout(300f * den, 200f * den, 3, den)
        val capacity = 3 * SlotGrid.COLS
        // the gap between slot 0 and slot 1
        val a = l.rect(0); val b = l.rect(1)
        val gutterX = (a.right + b.left) / 2f
        val gutterY = (a.top + a.bottom) / 2f
        assertEquals(-1, l.indexAt(gutterX, gutterY, capacity))
        assertEquals(-1, l.indexAt(-5f, -5f, capacity))
    }

    @Test
    fun theHotbarRowIsSetApartFromThePack() {
        val den = 2.75f
        val l = SlotGrid.layout(340f * den, 230f * den, 3, den)
        val hotbarBottom = l.rect(0).bottom
        val firstPackTop = l.rect(SlotGrid.COLS).top
        val packRowGap = l.rect(SlotGrid.COLS * 2).top - l.rect(SlotGrid.COLS).bottom
        assertTrue("the hotbar row should be visually separated from the pack",
            firstPackTop - hotbarBottom > packRowGap + 1f)
    }

    @Test
    fun slotsStayThumbSizedAtEveryDensity() {
        for (den in densities) {
            val l = SlotGrid.layout(340f * den, 230f * den, 3, den)
            val dpSize = l.cell / den
            assertTrue("slot is ${dpSize}dp at density $den — too small to tap",
                dpSize >= SlotGrid.MIN_CELL_DP)
            assertTrue("slot is ${dpSize}dp — unnecessarily huge", dpSize <= SlotGrid.MAX_CELL_DP + 0.5f)
        }
    }

    @Test
    fun aFullSixRowBackpackStillFits() {
        val den = 2.75f
        val w = 340f * den; val h = 230f * den
        val l = SlotGrid.layout(w, h, 7, den)      // hotbar + six pack rows = 35 slots
        val last = l.rect(34)
        assertTrue("the last slot of a maxed backpack is off the grid: ${last.bottom} > $h",
            last.bottom <= h + 0.5f)
        assertTrue(l.cell > 0f)
    }
}
