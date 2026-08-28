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
import com.voxeland.game.items.Inventory
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

    private fun shell(
        ctx: Context,
        title: String,
        onClose: () -> Unit,
        content: View,
        panelWidth: Int = FrameLayout.LayoutParams.WRAP_CONTENT,
    ): FrameLayout {
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
            panelWidth, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        root.addView(panel, lp)
        return root
    }

    // ------------------------------------------------------------ inventory + crafting

    /**
     * Backpack. Sized from the actual display so it can never be wider than
     * the screen, with square thumb-sized slots and explicit actions — the
     * old build hid "use" behind a second tap and hardcoded seven rows into
     * the height, which squashed the grid into a corner.
     */
    @SuppressLint("SetTextI18n")
    fun inventory(ctx: Context, engine: GameEngine, onClose: () -> Unit): View {
        val dm = ctx.resources.displayMetrics
        val panelW = minOf(dm.widthPixels - dp(ctx, 28f), dp(ctx, 720f))
        val panelH = minOf(dm.heightPixels - dp(ctx, 20f), dp(ctx, 430f))
        val bodyH = panelH - dp(ctx, 74f)          // minus header and padding

        val body = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }

        // ---- left: the grid, the selected item, and what you can do with it
        val left = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val grid = InventoryGrid(ctx, engine)
        val detail = UiKit.label(ctx, "", 11f, UiKit.TEXT_DIM).apply { maxLines = 2 }
        val actions = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }

        lateinit var refreshAll: () -> Unit

        val useBtn = UiKit.button(ctx, "USE", accent = true, compact = true) {
            val i = grid.selectedIndex
            val st = engine.player.inventory.slots.getOrNull(i) ?: return@button
            engine.post {
                val inv = engine.player.inventory
                val keep = inv.selected
                inv.selected = i
                engine.useHeld()
                inv.selected = keep
                post(ctx) { refreshAll() }
            }
        }
        val handBtn = UiKit.button(ctx, "TO HAND", compact = true) {
            val i = grid.selectedIndex
            val inv = engine.player.inventory
            if (i < 0 || inv.slots[i] == null) return@button
            engine.post {
                // prefer an empty hotbar slot, otherwise swap with the held one
                var target = (0 until Inventory.HOTBAR).firstOrNull { inv.slots[it] == null } ?: inv.selected
                if (target == i) target = inv.selected
                val tmp = inv.slots[target]
                inv.slots[target] = inv.slots[i]
                inv.slots[i] = tmp
                inv.selected = target
                post(ctx) { refreshAll() }
            }
        }
        val dropBtn = UiKit.button(ctx, "DISCARD", compact = true) {
            val i = grid.selectedIndex
            val inv = engine.player.inventory
            if (i < 0 || inv.slots[i] == null) return@button
            engine.post {
                inv.slots[i] = null
                post(ctx) { refreshAll() }
            }
        }
        for (b in listOf(useBtn, handBtn, dropBtn)) {
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            lp.rightMargin = dp(ctx, 4f)
            actions.addView(b, lp)
        }

        // ---- right: crafting
        val craftCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 12f), 0, 0, 0)
        }
        craftCol.addView(UiKit.label(ctx, "CRAFTING", 12f, UiKit.TEXT))
        val list = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        fun refreshCrafting() {
            list.removeAllViews()
            for (r in Recipes.all) {
                val gated = r.requiredSkill != null && !engine.player.has(r.requiredSkill)
                val canCraft = !gated && r.inputs.all { (item, n) -> engine.player.inventory.count(item) >= n }
                val row = LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(0, dp(ctx, 3f), 0, dp(ctx, 3f))
                }
                val need = r.inputs.joinToString(" + ") { (i, n) ->
                    "$n ${i.name} (${engine.player.inventory.count(i)})"
                }
                val lockTxt = if (gated) "\nneeds ${Skills.byId(r.requiredSkill!!)?.name}" else ""
                val lbl = UiKit.label(ctx, "${r.outCount}x ${r.output.name}\n$need$lockTxt", 10f,
                    if (canCraft) UiKit.TEXT else UiKit.TEXT_DIM)
                row.addView(lbl, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                val btn = UiKit.button(ctx, "MAKE", accent = canCraft, compact = true) {
                    engine.post { if (engine.craft(r)) post(ctx) { refreshAll() } }
                }
                btn.isEnabled = canCraft
                row.addView(btn)
                list.addView(row)
            }
        }

        refreshAll = {
            refreshCrafting()
            grid.invalidate()
            val inv = engine.player.inventory
            val st = inv.slots.getOrNull(grid.selectedIndex)
            detail.text = if (st == null)
                "Tap a slot. Top row is your hotbar — TO HAND puts an item there."
            else
                "${st.item.name} x${st.count}\n${st.item.desc.ifEmpty { st.item.kind.name.lowercase() }}"
            val has = st != null
            useBtn.isEnabled = has && st!!.item.let {
                it.kind == ItemKind.FOOD || it.kind == ItemKind.DRINK ||
                it.kind == ItemKind.MEDICAL || it.kind == ItemKind.BLOCK
            }
            handBtn.isEnabled = has
            dropBtn.isEnabled = has
            useBtn.alpha = if (useBtn.isEnabled) 1f else 0.4f
            handBtn.alpha = if (handBtn.isEnabled) 1f else 0.4f
            dropBtn.alpha = if (dropBtn.isEnabled) 1f else 0.4f
        }
        grid.onSelect = { refreshAll() }
        refreshAll()

        val gridH = bodyH - dp(ctx, 62f)
        left.addView(grid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, gridH))
        left.addView(detail, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(ctx, 30f)))
        left.addView(actions, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val scroll = ScrollView(ctx)
        scroll.addView(list)
        craftCol.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        body.addView(left, LinearLayout.LayoutParams(0, bodyH, 52f))
        body.addView(craftCol, LinearLayout.LayoutParams(0, bodyH, 48f))

        return shell(ctx, "BACKPACK — ${engine.player.character.name}", onClose, body, panelW)
    }

    private fun post(ctx: Context, r: () -> Unit) {
        android.os.Handler(ctx.mainLooper).post(r)
    }

    /** The slot grid itself. All geometry comes from [SlotGrid]. */
    private class InventoryGrid(ctx: Context, val engine: GameEngine) : View(ctx) {
        var onSelect: (() -> Unit)? = null
        var selectedIndex = -1
            private set

        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = android.graphics.Typeface.MONOSPACE
        }
        private val rect = RectF()
        private val den = ctx.resources.displayMetrics.density

        private fun layout() = SlotGrid.layout(
            width.toFloat(), height.toFloat(), 1 + engine.player.inventory.rows, den)

        override fun onDraw(c: Canvas) {
            val inv = engine.player.inventory
            val l = layout()
            for (i in 0 until inv.capacity) {
                val cell = l.rect(i)
                rect.set(cell.left, cell.top, cell.right, cell.bottom)
                UiKit.drawSlot(
                    c, rect, inv.slots[i],
                    selected = i == selectedIndex,
                    inHand = i == inv.selected,
                    index = if (i < Inventory.HOTBAR) i else -1,
                    density = den, p = p, tp = tp,
                )
            }
        }

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: android.view.MotionEvent): Boolean {
            if (e.actionMasked != android.view.MotionEvent.ACTION_DOWN) return true
            val inv = engine.player.inventory
            val hit = layout().indexAt(e.x, e.y, inv.capacity)
            selectedIndex = hit
            if (hit >= 0) {
                engine.sound.play("ui_click", 0.4f)
                // tapping a hotbar slot also equips it, which is what people expect
                if (hit < Inventory.HOTBAR) engine.post { inv.selected = hit }
            }
            invalidate()
            onSelect?.invoke()
            return true
        }
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
