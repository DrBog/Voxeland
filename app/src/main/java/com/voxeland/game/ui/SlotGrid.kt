package com.voxeland.game.ui

import kotlin.math.max
import kotlin.math.min

/**
 * Geometry for a slot grid — the hotbar row on top, backpack rows beneath.
 *
 * Pure arithmetic with no Android types so it can be tested directly. Both
 * the drawing and the hit testing go through [Layout.rect], which is what
 * keeps what you see and what you can tap from drifting apart.
 */
object SlotGrid {
    const val COLS = 5

    /** smallest comfortable touch target */
    const val MIN_CELL_DP = 38f
    const val MAX_CELL_DP = 62f

    class Cell(val left: Float, val top: Float, val right: Float, val bottom: Float) {
        val width: Float get() = right - left
        val height: Float get() = bottom - top
        fun contains(x: Float, y: Float) = x >= left && x <= right && y >= top && y <= bottom
    }

    class Layout(
        val cell: Float,
        val gap: Float,
        val bandGap: Float,
        val originX: Float,
        val originY: Float,
        val rows: Int,
    ) {
        val gridWidth: Float get() = COLS * cell + gap * (COLS - 1)
        val gridHeight: Float get() = rows * cell + gap * (rows - 1) + bandGap

        fun rect(index: Int): Cell {
            val row = index / COLS
            val col = index % COLS
            val x = originX + col * (cell + gap)
            // the hotbar row is set apart from the pack by a wider gutter
            val y = originY + row * (cell + gap) + if (row > 0) bandGap else 0f
            return Cell(x, y, x + cell, y + cell)
        }

        fun indexAt(x: Float, y: Float, capacity: Int): Int {
            for (i in 0 until capacity) if (rect(i).contains(x, y)) return i
            return -1
        }
    }

    /**
     * Fit [rows] rows of square cells inside the given box. Cells are square
     * and the whole block is centred, so the grid never squashes into a
     * corner the way a fixed row count does.
     */
    fun layout(widthPx: Float, heightPx: Float, rows: Int, density: Float): Layout {
        val safeRows = max(1, rows)
        val gap = 5f * density
        val bandGap = 10f * density
        val availW = widthPx - gap * (COLS - 1)
        val availH = heightPx - gap * (safeRows - 1) - bandGap
        var cell = min(availW / COLS, availH / safeRows)
        cell = min(cell, MAX_CELL_DP * density)
        cell = max(cell, 0f)
        val l = Layout(cell, gap, bandGap, 0f, 0f, safeRows)
        val ox = max(0f, (widthPx - l.gridWidth) / 2f)
        val oy = max(0f, (heightPx - l.gridHeight) / 2f)
        return Layout(cell, gap, bandGap, ox, oy, safeRows)
    }

    /** height a grid of this many rows wants, given a cell size in px */
    fun preferredHeight(rows: Int, density: Float): Float {
        val cell = MAX_CELL_DP * density
        return rows * cell + 5f * density * (rows - 1) + 10f * density
    }
}
