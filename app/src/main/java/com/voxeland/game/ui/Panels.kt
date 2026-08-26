package com.voxeland.game.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.voxeland.game.GameEngine
import com.voxeland.game.items.ItemKind
import com.voxeland.game.items.Recipes
import com.voxeland.game.items.Stack
import com.voxeland.game.progression.SkillTree
import com.voxeland.game.progression.Skills

/**
 * In-game overlay panels. The engine pauses while any is open.
 * All widget trees are built in code.
 */
object Panels {

    private fun shell(ctx: Context, title: String, onClose: () -> Unit, content: View): FrameLayout {
        val root = FrameLayout(ctx)
        root.setBackgroundColor(0xB80C0C0B.toInt())
        root.setOnClickListener { onClose() }
        val panel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(UiKit.PANEL)
            setPadding(dp(ctx, 18f), dp(ctx, 12f), dp(ctx, 18f), dp(ctx, 12f))
            isClickable = true
        }
        val header = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        header.addView(UiKit.title(ctx, title, 18f), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(UiKit.button(ctx, "X") { onClose() })
        panel.addView(header)
        panel.addView(UiKit.vspace(ctx, 16))
        panel.addView(content)
        val lp = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        root.addView(panel, lp)
        return root
    }

    // ------------------------------------------------------------ inventory + crafting

    @SuppressLint("SetTextI18n")
    fun inventory(ctx: Context, engine: GameEngine, onClose: () -> Unit): View {
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }

        // left: slot grid
        val grid = InventoryGrid(ctx, engine)
        col.addView(grid, LinearLayout.LayoutParams(dp(ctx, 320f), dp(ctx, 250f)))

        // right: crafting list
        val craftCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 14f), 0, 0, 0)
        }
        craftCol.addView(UiKit.label(ctx, "CRAFTING", 14f, UiKit.TEXT))
        craftCol.addView(UiKit.vspace(ctx, 8))
        val list = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        fun refresh() {
            list.removeAllViews()
            for (r in Recipes.all) {
                val gated = r.requiredSkill != null && !engine.player.has(r.requiredSkill)
                val canCraft = !gated && r.inputs.all { (item, n) -> engine.player.inventory.count(item) >= n }
                val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(ctx, 3f), 0, dp(ctx, 3f)) }
                val need = r.inputs.joinToString(" + ") { (i, n) -> "$n ${i.name}" }
                val lockTxt = if (gated) "  [needs ${Skills.byId(r.requiredSkill!!)?.name}]" else ""
                val lbl = UiKit.label(ctx, "${r.outCount}x ${r.output.name}\n$need$lockTxt", 11f,
                    if (canCraft) UiKit.TEXT else UiKit.TEXT_DIM)
                row.addView(lbl, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                val btn = UiKit.button(ctx, "MAKE", accent = canCraft) {
                    engine.post {
                        if (engine.craft(r)) post(ctx) { refresh(); grid.invalidate() }
                    }
                }
                btn.isEnabled = canCraft
                row.addView(btn)
                list.addView(row)
            }
        }
        refresh()
        val scroll = ScrollView(ctx)
        scroll.addView(list)
        craftCol.addView(scroll, LinearLayout.LayoutParams(dp(ctx, 330f), dp(ctx, 210f)))
        col.addView(craftCol)

        grid.onChanged = { refresh() }
        return shell(ctx, "BACKPACK — ${engine.player.character.name}", onClose, col)
    }

    private fun post(ctx: Context, r: () -> Unit) {
        android.os.Handler(ctx.mainLooper).post(r)
    }

    /** tap a slot to select/act: consumables are used, gear is equipped to the tapped hotbar slot */
    private class InventoryGrid(ctx: Context, val engine: GameEngine) : View(ctx) {
        var onChanged: (() -> Unit)? = null
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = android.graphics.Typeface.MONOSPACE
        }

        private var sel = -1

        override fun onDraw(c: Canvas) {
            val inv = engine.player.inventory
            val cols = 5
            val cell = width / cols.toFloat()
            val rows = 1 + inv.rows
            val ch = (height - dp(context, 40f)) / (1 + 6).toFloat()
            for (i in 0 until inv.capacity) {
                val r = slotRect(i, cell, ch)
                p.style = Paint.Style.FILL
                p.color = if (i == sel) 0xFF33332E.toInt() else if (i < 5) 0xFF232320.toInt() else 0xFF1D1D1A.toInt()
                c.drawRect(r, p)
                p.style = Paint.Style.STROKE; p.strokeWidth = 2f
                p.color = if (i == inv.selected) 0xFF8A8578.toInt() else UiKit.EDGE
                c.drawRect(r, p)
                p.style = Paint.Style.FILL
                val s = inv.slots[i]
                if (s != null) {
                    UiKit.drawItemIcon(c, r, s.item, p)
                    if (s.count > 1) {
                        tp.textSize = dp(context, 10f).toFloat(); tp.color = UiKit.TEXT
                        tp.textAlign = Paint.Align.RIGHT
                        c.drawText("${s.count}", r.right - 4f, r.bottom - 5f, tp)
                    }
                }
            }
            // selected item info line
            tp.textAlign = Paint.Align.LEFT
            tp.textSize = dp(context, 11f).toFloat(); tp.color = UiKit.TEXT_DIM
            val info = sel.takeIf { it in 0 until inv.capacity }?.let { inv.slots[it] }?.let {
                "${it.item.name} — ${it.item.desc.ifEmpty { it.item.kind.name.lowercase() }}  (tap again: use / move to hand)"
            } ?: "Tap an item, tap again to use or equip. Top row = hotbar."
            c.drawText(info, 4f, height - 8f, tp)
        }

        private fun slotRect(i: Int, cell: Float, ch: Float): RectF {
            val row = i / 5; val colI = i % 5
            val gap = 4f
            val y0 = row * (ch + gap) + if (row > 0) 10f else 0f
            return RectF(colI * cell + gap, y0 + gap, (colI + 1) * cell - gap, y0 + ch - gap)
        }

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: android.view.MotionEvent): Boolean {
            if (e.actionMasked != android.view.MotionEvent.ACTION_DOWN) return true
            val inv = engine.player.inventory
            val cell = width / 5f
            val ch = (height - dp(context, 40f)) / 7f
            for (i in 0 until inv.capacity) {
                if (slotRect(i, cell, ch).contains(e.x, e.y)) {
                    engine.sound.play("ui_click", 0.4f)
                    if (sel == i) {
                        // second tap: act on the item
                        val s = inv.slots[i]
                        if (s != null) {
                            when (s.item.kind) {
                                ItemKind.FOOD, ItemKind.DRINK, ItemKind.MEDICAL -> engine.post {
                                    val keep = inv.selected
                                    inv.selected = i
                                    engine.useHeld()
                                    inv.selected = keep
                                    post(context) { invalidate(); onChanged?.invoke() }
                                }
                                else -> {
                                    // swap into first hotbar slot
                                    val tmp = inv.slots[inv.selected]
                                    inv.slots[inv.selected] = s
                                    inv.slots[i] = tmp
                                }
                            }
                        }
                        sel = -1
                    } else sel = i
                    invalidate()
                    return true
                }
            }
            sel = -1; invalidate()
            return true
        }
        private fun post(ctx: Context, r: () -> Unit) { android.os.Handler(ctx.mainLooper).post(r) }
    }

    // ------------------------------------------------------------ skills

    @SuppressLint("SetTextI18n")
    fun skills(ctx: Context, engine: GameEngine, onClose: () -> Unit): View {
        val wrap = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val ptsLabel = UiKit.label(ctx, "", 13f, UiKit.TEXT)
        wrap.addView(ptsLabel)
        wrap.addView(UiKit.vspace(ctx, 10))
        val cols = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }

        fun refresh() {
            ptsLabel.text = "SKILL POINTS: ${engine.player.skillPoints}   (earn XP by surviving, scavenging, and killing)"
            cols.removeAllViews()
            for (tree in SkillTree.entries) {
                val colV = LinearLayout(ctx).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(ctx, 6f), 0, dp(ctx, 6f), 0)
                }
                colV.addView(UiKit.label(ctx, tree.title.uppercase(), 13f, UiKit.TEXT))
                colV.addView(UiKit.vspace(ctx, 6))
                for (s in Skills.all.filter { it.tree == tree }) {
                    val owned = engine.player.has(s.id)
                    val prereqOk = s.prereq == null || engine.player.has(s.prereq)
                    val afford = engine.player.skillPoints >= s.cost
                    val state = when {
                        owned -> "✔"
                        !prereqOk -> "LOCKED (needs ${Skills.byId(s.prereq!!)?.name})"
                        else -> "${s.cost} pt"
                    }
                    val b = UiKit.button(ctx, "", accent = !owned && prereqOk && afford) {
                        engine.post {
                            if (engine.player.unlock(s.id)) {
                                engine.sound.play("skill_unlock")
                                post(ctx) { refresh() }
                            }
                        }
                    }
                    b.isAllCaps = false
                    b.text = "${s.name} [$state]\n${s.desc}"
                    b.textSize = 11f
                    b.isEnabled = !owned && prereqOk && afford
                    if (owned) b.setBackgroundColor(0xFF2E3A2A.toInt())
                    val lp = LinearLayout.LayoutParams(dp(ctx, 210f), LinearLayout.LayoutParams.WRAP_CONTENT)
                    lp.bottomMargin = dp(ctx, 4f)
                    colV.addView(b, lp)
                }
                cols.addView(colV)
            }
        }
        refresh()
        val hs = HorizontalScrollView(ctx)
        val vs = ScrollView(ctx)
        vs.addView(cols)
        hs.addView(vs)
        wrap.addView(hs, LinearLayout.LayoutParams(dp(ctx, 700f), dp(ctx, 240f)))
        return shell(ctx, "SURVIVAL TRAINING", onClose, wrap)
    }

    // ------------------------------------------------------------ pause / death / loot

    fun pause(ctx: Context, engine: GameEngine, onResume: () -> Unit, onSaveQuit: () -> Unit): View {
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val p = engine.player
        val stats = "Day ${engine.env.dayCount + 1} · ${engine.env.clockString()}\n" +
                "Level ${p.level} · ${p.kills} kills · ${(p.timeSurvived / 60).toInt()} min survived"
        col.addView(UiKit.label(ctx, stats, 13f, UiKit.TEXT))
        col.addView(UiKit.vspace(ctx, 20))
        col.addView(UiKit.button(ctx, "RESUME", accent = true) { onResume() })
        col.addView(UiKit.vspace(ctx, 10))
        col.addView(UiKit.button(ctx, "SAVE & QUIT") { onSaveQuit() })
        return shell(ctx, "PAUSED", onResume, col)
    }

    fun death(ctx: Context, cause: String, stats: String, onMainMenu: () -> Unit): View {
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        col.addView(UiKit.label(ctx, cause, 15f, UiKit.ACCENT))
        col.addView(UiKit.vspace(ctx, 8))
        col.addView(UiKit.label(ctx, stats, 12f, UiKit.TEXT_DIM))
        col.addView(UiKit.vspace(ctx, 20))
        col.addView(UiKit.button(ctx, "THE CITY REMAINS", accent = true) { onMainMenu() })
        val v = shell(ctx, "YOU DIED", {}, col)
        v.setBackgroundColor(0xD8180A08.toInt())
        return v
    }

    @SuppressLint("SetTextI18n")
    fun lootToast(ctx: Context, items: List<Stack>, overflow: Boolean): View {
        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(UiKit.PANEL)
            setPadding(dp(ctx, 14f), dp(ctx, 9f), dp(ctx, 14f), dp(ctx, 9f))
        }
        col.addView(UiKit.label(ctx, "FOUND:", 12f, UiKit.TEXT))
        for (s in items) col.addView(UiKit.label(ctx, "  ${s.count}x ${s.item.name}", 12f, UiKit.GOOD))
        if (overflow) col.addView(UiKit.label(ctx, "  ...but your pack is full.", 12f, UiKit.WARN))
        return col
    }

    private fun dp(ctx: Context, v: Float) = (v * ctx.resources.displayMetrics.density).toInt()
}
